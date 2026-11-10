import express from 'express';
import crypto from 'crypto';
import { getDb } from '../config/database.js';
import { authenticateToken, requireSession, checkOwnPassword, sendConfirmProblem } from '../middleware/auth.js';
import { handle, serverError } from '../utils/http.js';
import { logger } from '../services/logger.js';

const router = express.Router();

router.use(authenticateToken, requireSession);

router.get('/', handle(async (req, res) => {
  const userId = req.user.id;
  const db = await getDb();
  const keys = await db.all(
    'SELECT id, name, created_at, key_last4 as last4 FROM api_keys WHERE user_id = ? ORDER BY created_at DESC',
    [userId]
  );
  res.json({ keys });
}));

// Create new API key. Only the raw key is ever returned to the client (once, here) —
// the database stores a SHA-256 hash of it so a DB leak can't be used as live credentials.
// Needs the account's password (body: { name, password }): a key is a way into the account
// that outlives the session, skips two-factor and survives a password change, so a browser
// left signed in, or a stolen session, must not be enough to make one. Each one is logged
// (who and the key's name, never the key).
const MAX_KEY_NAME = 100;
const MAX_KEYS_PER_USER = 50;

router.post('/', async (req, res) => {
  const userId = req.user.id;
  const { name, password } = req.body;

  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Key name is required' });
  }
  if (name.trim().length > MAX_KEY_NAME) {
    return res.status(400).json({ error: `Key name must be ${MAX_KEY_NAME} characters or fewer` });
  }

  try {
    const db = await getDb();
    const problem = await checkOwnPassword(db, req, password, 'making an API key');
    if (problem) {
      return sendConfirmProblem(req, res, problem, typeof password === 'string' && password ? 'That password is not right' : 'Enter your password to make an API key');
    }
    const existing = await db.get('SELECT COUNT(*) AS count FROM api_keys WHERE user_id = ?', [userId]);
    if (existing.count >= MAX_KEYS_PER_USER) {
      return res.status(400).json({ error: `An account can have ${MAX_KEYS_PER_USER} API keys. Revoke one you no longer use first` });
    }
    const id = crypto.randomUUID();
    const rawKey = `plinthio_${crypto.randomBytes(24).toString('hex')}`;
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    // The MD5 is only for KOReader's sync plugin, which hashes the password that way
    // before sending it (routes/kosync.js). The key is 192 random bits, so MD5 is no weaker
    // here than SHA-256 in practice.
    const keyMd5 = crypto.createHash('md5').update(rawKey).digest('hex');

    await db.run(
      'INSERT INTO api_keys (id, user_id, name, key, key_last4, key_md5) VALUES (?, ?, ?, ?, ?, ?)',
      [id, userId, name.trim(), keyHash, rawKey.slice(-4), keyMd5]
    );
    logger.info('auth', `"${req.user.username}" made an API key named "${name.trim()}"`, { ip: req.ip });

    res.json({
      message: 'API Key generated successfully',
      key: {
        id,
        name: name.trim(),
        key: rawKey, // Shown only once upon creation
        created_at: new Date().toISOString()
      }
    });
  } catch (err) {
    serverError(req, res, err);
  }
});

router.delete('/:id', handle(async (req, res) => {
  const userId = req.user.id;
  const db = await getDb();
  const gone = await db.get('SELECT name FROM api_keys WHERE id = ? AND user_id = ?', [req.params.id, userId]);
  await db.run('DELETE FROM api_keys WHERE id = ? AND user_id = ?', [req.params.id, userId]);
  if (gone) logger.info('auth', `"${req.user.username}" revoked the API key named "${gone.name}"`, { ip: req.ip });
  res.json({ message: 'API key revoked' });
}));

export default router;
