import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import sharp from 'sharp';
import { getDb } from '../config/database.js';
import { config } from '../config/env.js';
import { authenticateToken, requireAdmin, invalidateUserCache } from '../middleware/auth.js';
import { serverError } from '../utils/http.js';
import { normalizeUsername, USERNAME_RULE } from '../utils/username.js';
import { AGE_RATINGS } from '../services/visibility.js';

const router = express.Router();
const VALID_ROLES = ['admin', 'editor', 'viewer'];

// Multer in-memory storage for avatar upload
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (!/^image\//.test(file.mimetype)) {
      return cb(new Error('Only image files can be used as an avatar'));
    }
    cb(null, true);
  }
});

// Public avatar read endpoint — placed before router.use(authenticateToken)
// so <img> tags can render avatars directly without Authorization headers.
router.get('/:id/avatar', async (req, res) => {
  const { id } = req.params;
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    return res.status(400).json({ error: 'Invalid user id' });
  }

  const filename = `${id}.webp`;
  const filePath = path.join(config.avatarsDir, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Avatar not found' });
  }

  try {
    const stat = fs.statSync(filePath);
    const etag = `"${id}-${stat.mtimeMs}-${stat.size}"`;

    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('ETag', etag);

    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read avatar' });
  }
});

router.use(authenticateToken);

// Upload current user's avatar
router.post('/avatar', (req, res, next) => {
  avatarUpload.single('avatar')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Avatar image must be smaller than 5MB' });
      }
      return res.status(400).json({ error: err.message });
    } else if (err) {
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No avatar image file provided' });
  }

  const userId = req.user.id;
  try {
    const filename = `${userId}.webp`;
    const fullPath = path.join(config.avatarsDir, filename);

    // Normalize with Sharp: auto-orient, square crop to 256x256, convert to WebP
    await sharp(req.file.buffer)
      .rotate()
      .resize(256, 256, { fit: 'cover', position: 'center' })
      .webp({ quality: 85 })
      .toFile(fullPath);

    const avatarUrl = `/api/users/${userId}/avatar?v=${Date.now()}`;
    const db = await getDb();
    await db.run(
      'UPDATE users SET avatar = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [avatarUrl, userId]
    );
    invalidateUserCache(userId);

    const updatedUser = await db.get('SELECT id, username, role, avatar, preferences FROM users WHERE id = ?', [userId]);
    if (updatedUser) {
      updatedUser.preferences = updatedUser.preferences ? JSON.parse(updatedUser.preferences) : {};
    }

    res.json({
      message: 'Avatar uploaded successfully',
      avatar: avatarUrl,
      user: updatedUser
    });
  } catch (err) {
    console.error('Avatar upload failed:', err);
    res.status(500).json({ error: 'Failed to process and save avatar image' });
  }
});

// Remove current user's avatar
router.delete('/avatar', async (req, res) => {
  const userId = req.user.id;
  try {
    const filename = `${userId}.webp`;
    const fullPath = path.join(config.avatarsDir, filename);
    if (fs.existsSync(fullPath)) {
      try { fs.unlinkSync(fullPath); } catch (e) { /* ignore */ }
    }

    const db = await getDb();
    await db.run(
      'UPDATE users SET avatar = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [userId]
    );
    invalidateUserCache(userId);

    const updatedUser = await db.get('SELECT id, username, role, avatar, preferences FROM users WHERE id = ?', [userId]);
    if (updatedUser) {
      updatedUser.preferences = updatedUser.preferences ? JSON.parse(updatedUser.preferences) : {};
    }

    res.json({
      message: 'Avatar removed successfully',
      user: updatedUser
    });
  } catch (err) {
    console.error('Avatar deletion failed:', err);
    serverError(req, res, err);
  }
});

// Update current user's preferences (accessible by all users).
// Merges into the stored object rather than replacing it: callers send only the keys their
// screen owns (the Settings page sends three), and a replace silently dropped every other
// key — including `onboardingComplete`, which made saving Settings replay the onboarding
// flow on the next render.
router.patch('/preferences', async (req, res) => {
  const userId = req.user.id;
  const patch = req.body;

  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return res.status(400).json({ error: 'Preferences must be an object' });
  }

  try {
    const db = await getDb();
    const row = await db.get('SELECT preferences FROM users WHERE id = ?', [userId]);

    let stored = {};
    try {
      const parsed = row?.preferences ? JSON.parse(row.preferences) : {};
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) stored = parsed;
    } catch (e) {
      // Malformed stored JSON — start clean rather than failing the save.
    }

    const preferences = { ...stored, ...patch };

    await db.run(
      'UPDATE users SET preferences = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [JSON.stringify(preferences), userId]
    );
    // authenticateToken caches the user row (preferences included) for a minute, so without
    // this every request for the next 60s — /auth/me among them — keeps answering with the
    // preferences the user just changed away from.
    invalidateUserCache(userId);

    res.json({ message: 'Preferences updated', preferences });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Change current user's password
router.patch('/password', async (req, res) => {
  const userId = req.user.id;
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword) {
    return res.status(400).json({ error: 'Current password is required' });
  }
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }

  try {
    const db = await getDb();
    const user = await db.get('SELECT password_hash FROM users WHERE id = ?', [userId]);

    const isValid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Current password incorrect' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    // Bump token_version so every previously-issued token (e.g. one that may have leaked)
    // is invalidated immediately instead of remaining valid until it naturally expires.
    await db.run(
      'UPDATE users SET password_hash = ?, token_version = token_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [newHash, userId]
    );
    invalidateUserCache(userId);

    res.json({ message: 'Password updated successfully. You will need to log in again.' });
  } catch (err) {
    serverError(req, res, err);
  }
});

// ==========================================
// Admin Only Endpoints Below
// ==========================================

export function parseExpiration(durationOrDate, fromDate = new Date()) {
  if (!durationOrDate || durationOrDate === 'forever') return null;

  const baseMs = fromDate instanceof Date && !isNaN(fromDate.getTime()) ? fromDate.getTime() : Date.now();
  const durations = {
    '1d': 1 * 24 * 60 * 60 * 1000,
    '3d': 3 * 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '14d': 14 * 24 * 60 * 60 * 1000,
    '1m': 30 * 24 * 60 * 60 * 1000,
    '3m': 90 * 24 * 60 * 60 * 1000,
    '6m': 180 * 24 * 60 * 60 * 1000,
    '1y': 365 * 24 * 60 * 60 * 1000
  };

  if (durations[durationOrDate]) {
    return new Date(baseMs + durations[durationOrDate]).toISOString();
  }

  const parsed = new Date(durationOrDate);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }
  return null;
}

// List all users
router.get('/', requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const users = await db.all('SELECT id, username, role, avatar, preferences, expires_at, created_at, last_login_at, max_age_rating, allow_unrated FROM users ORDER BY created_at ASC');
    const parsed = users.map(u => ({
      ...u,
      preferences: u.preferences ? JSON.parse(u.preferences) : {}
    }));
    res.json({ users: parsed });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Create a new user (Admin only)
router.post('/', requireAdmin, async (req, res) => {
  const { username, password, role = 'viewer', preferences = {}, expires_at, duration } = req.body;

  if (!username || !password || password.length < 8) {
    return res.status(400).json({ error: 'Username and password (min 8 characters) are required' });
  }

  if (!normalizeUsername(username)) {
    return res.status(400).json({ error: USERNAME_RULE });
  }
  const safeRole = VALID_ROLES.includes(role) ? role : 'viewer';
  const calculatedExpiry = parseExpiration(expires_at !== undefined ? expires_at : duration);

  try {
    const db = await getDb();
    const existing = await db.get('SELECT id FROM users WHERE username = ?', [username.trim()]);
    if (existing) {
      return res.status(400).json({ error: 'Username already taken' });
    }

    const id = crypto.randomUUID();
    const passwordHash = await bcrypt.hash(password, 10);

    await db.run(
      'INSERT INTO users (id, username, password_hash, role, expires_at, preferences) VALUES (?, ?, ?, ?, ?, ?)',
      [id, username.trim(), passwordHash, safeRole, calculatedExpiry, JSON.stringify(preferences)]
    );

    res.json({
      message: 'User created successfully',
      user: { id, username: username.trim(), role: safeRole, expires_at: calculatedExpiry, preferences }
    });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Edit another user's account info (Admin only) — username, role, or expiration.
router.patch('/:id', requireAdmin, async (req, res) => {
  const { username, role, expires_at, duration, maxAgeRating, allowUnrated } = req.body;

  try {
    const db = await getDb();
    const target = await db.get('SELECT id, role, expires_at FROM users WHERE id = ?', [req.params.id]);
    if (!target) {
      return res.status(404).json({ error: 'User not found' });
    }

    const updates = [];
    const params = [];

    if (username !== undefined) {
      const trimmed = normalizeUsername(username);
      if (!trimmed) {
        return res.status(400).json({ error: USERNAME_RULE });
      }
      const existing = await db.get('SELECT id FROM users WHERE username = ? AND id != ?', [trimmed, req.params.id]);
      if (existing) {
        return res.status(400).json({ error: 'Username already taken' });
      }
      updates.push('username = ?');
      params.push(trimmed);
    }

    if (role !== undefined) {
      if (req.user.id === req.params.id) {
        return res.status(400).json({ error: 'Cannot change your own role' });
      }
      if (!VALID_ROLES.includes(role)) {
        return res.status(400).json({ error: `Role must be one of: ${VALID_ROLES.join(', ')}` });
      }
      updates.push('role = ?');
      params.push(role);
    }

    if (expires_at !== undefined || duration !== undefined) {
      if (req.user.id === req.params.id && (expires_at || duration) && expires_at !== 'forever' && duration !== 'forever') {
        return res.status(400).json({ error: 'Cannot set an expiration date on your own account' });
      }
      const calculatedExpiry = expires_at !== undefined ? parseExpiration(expires_at) : parseExpiration(duration);
      updates.push('expires_at = ?');
      params.push(calculatedExpiry);
    }

    // Parental controls. null/'' clears the limit. An admin can't restrict themselves —
    // the same guard as role changes, so nobody locks themselves out of their own library.
    if (maxAgeRating !== undefined) {
      if (req.user.id === req.params.id && maxAgeRating) {
        return res.status(400).json({ error: 'Cannot restrict your own account' });
      }
      if (maxAgeRating && !AGE_RATINGS.includes(maxAgeRating)) {
        return res.status(400).json({ error: `Age rating must be one of: ${AGE_RATINGS.join(', ')}` });
      }
      updates.push('max_age_rating = ?');
      params.push(maxAgeRating || null);
    }
    if (allowUnrated !== undefined) {
      updates.push('allow_unrated = ?');
      params.push(allowUnrated ? 1 : 0);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    params.push(req.params.id);
    await db.run(`UPDATE users SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, params);
    invalidateUserCache(req.params.id);

    const updated = await db.get('SELECT id, username, role, avatar, preferences, expires_at, created_at, last_login_at, max_age_rating, allow_unrated FROM users WHERE id = ?', [req.params.id]);
    updated.preferences = updated.preferences ? JSON.parse(updated.preferences) : {};

    res.json({ message: 'User updated successfully', user: updated });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Extend user account access (Admin only)
router.post('/:id/extend', requireAdmin, async (req, res) => {
  const { duration = '7d' } = req.body;
  try {
    const db = await getDb();
    const target = await db.get('SELECT id, expires_at FROM users WHERE id = ?', [req.params.id]);
    if (!target) {
      return res.status(404).json({ error: 'User not found' });
    }

    let baseTime = new Date();
    if (target.expires_at && new Date(target.expires_at).getTime() > Date.now()) {
      baseTime = new Date(target.expires_at);
    }

    const newExpiry = parseExpiration(duration, baseTime);
    await db.run('UPDATE users SET expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [newExpiry, req.params.id]);
    invalidateUserCache(req.params.id);

    const updated = await db.get('SELECT id, username, role, avatar, preferences, expires_at, created_at, last_login_at, max_age_rating, allow_unrated FROM users WHERE id = ?', [req.params.id]);
    if (updated) {
      updated.preferences = updated.preferences ? JSON.parse(updated.preferences) : {};
    }

    res.json({
      message: newExpiry ? `Access extended until ${newExpiry}` : 'Access set to unlimited',
      user: updated
    });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Reset another user's password (Admin only) — no current-password check, since the admin is
// acting on someone else's account (e.g. they forgot it). Bumps token_version like the
// self-service change so any existing sessions for that user are invalidated immediately.
router.patch('/:id/password', requireAdmin, async (req, res) => {
  const { newPassword } = req.body;

  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }

  try {
    const db = await getDb();
    const target = await db.get('SELECT id FROM users WHERE id = ?', [req.params.id]);
    if (!target) {
      return res.status(404).json({ error: 'User not found' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await db.run(
      'UPDATE users SET password_hash = ?, token_version = token_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [newHash, req.params.id]
    );
    invalidateUserCache(req.params.id);

    res.json({ message: 'Password reset successfully' });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Change another user's role (Admin only) — never your own, so an admin can't accidentally
// lock themselves out or leave the server with zero admins.
router.patch('/:id/role', requireAdmin, async (req, res) => {
  const { role } = req.body;

  if (req.user.id === req.params.id) {
    return res.status(400).json({ error: 'Cannot change your own role' });
  }
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: `Role must be one of: ${VALID_ROLES.join(', ')}` });
  }

  try {
    const db = await getDb();
    const target = await db.get('SELECT id FROM users WHERE id = ?', [req.params.id]);
    if (!target) {
      return res.status(404).json({ error: 'User not found' });
    }

    await db.run('UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [role, req.params.id]);
    invalidateUserCache(req.params.id);

    res.json({ message: 'Role updated successfully', role });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Delete user (Admin only)
router.delete('/:id', requireAdmin, async (req, res) => {
  if (req.user.id === req.params.id) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }

  try {
    const db = await getDb();
    await db.run('DELETE FROM users WHERE id = ?', [req.params.id]);
    invalidateUserCache(req.params.id);
    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    serverError(req, res, err);
  }
});

export default router;
