import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { getDb } from '../config/database.js';
import { authenticateToken, requireAdmin, invalidateUserCache } from '../middleware/auth.js';

const router = express.Router();
const VALID_ROLES = ['admin', 'editor', 'viewer'];

router.use(authenticateToken);

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
    res.status(500).json({ error: err.message });
  }
});

// Change current user's password
router.patch('/password', async (req, res) => {
  const userId = req.user.id;
  const { currentPassword, newPassword } = req.body;

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
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// Admin Only Endpoints Below
// ==========================================

// List all users
router.get('/', requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const users = await db.all('SELECT id, username, role, preferences, created_at, last_login_at FROM users ORDER BY created_at ASC');
    const parsed = users.map(u => ({
      ...u,
      preferences: u.preferences ? JSON.parse(u.preferences) : {}
    }));
    res.json({ users: parsed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a new user (Admin only)
router.post('/', requireAdmin, async (req, res) => {
  const { username, password, role = 'viewer', preferences = {} } = req.body;

  if (!username || !password || password.length < 8) {
    return res.status(400).json({ error: 'Username and password (min 8 characters) are required' });
  }

  const safeRole = VALID_ROLES.includes(role) ? role : 'viewer';

  try {
    const db = await getDb();
    const existing = await db.get('SELECT id FROM users WHERE username = ?', [username.trim()]);
    if (existing) {
      return res.status(400).json({ error: 'Username already taken' });
    }

    const id = crypto.randomUUID();
    const passwordHash = await bcrypt.hash(password, 10);

    await db.run(
      'INSERT INTO users (id, username, password_hash, role, preferences) VALUES (?, ?, ?, ?, ?)',
      [id, username.trim(), passwordHash, safeRole, JSON.stringify(preferences)]
    );

    res.json({
      message: 'User created successfully',
      user: { id, username: username.trim(), role: safeRole, preferences }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Edit another user's account info (Admin only) — username and/or role. Password is handled
// by its own endpoint below since it needs different validation (no minlength conflicts with
// leaving it blank to mean "unchanged").
router.patch('/:id', requireAdmin, async (req, res) => {
  const { username, role } = req.body;

  try {
    const db = await getDb();
    const target = await db.get('SELECT id, role FROM users WHERE id = ?', [req.params.id]);
    if (!target) {
      return res.status(404).json({ error: 'User not found' });
    }

    const updates = [];
    const params = [];

    if (username !== undefined) {
      const trimmed = username.trim();
      if (!trimmed) {
        return res.status(400).json({ error: 'Username cannot be empty' });
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

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    params.push(req.params.id);
    await db.run(`UPDATE users SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, params);
    invalidateUserCache(req.params.id);

    const updated = await db.get('SELECT id, username, role, preferences, created_at FROM users WHERE id = ?', [req.params.id]);
    updated.preferences = updated.preferences ? JSON.parse(updated.preferences) : {};

    res.json({ message: 'User updated successfully', user: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

export default router;
