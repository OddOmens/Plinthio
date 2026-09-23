import express from 'express';
import crypto from 'crypto';
import { getDb } from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticateToken);

// List current user's API keys
router.get('/', async (req, res) => {
  const userId = req.user.id;
  try {
    const db = await getDb();
    const keys = await db.all(
      'SELECT id, name, created_at, key_last4 as last4 FROM api_keys WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    );
    res.json({ keys });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create new API key. Only the raw key is ever returned to the client (once, here) —
// the database stores a SHA-256 hash of it so a DB leak can't be used as live credentials.
router.post('/', async (req, res) => {
  const userId = req.user.id;
  const { name } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Key name is required' });
  }

  try {
    const db = await getDb();
    const id = crypto.randomUUID();
    const rawKey = `plinthio_${crypto.randomBytes(24).toString('hex')}`;
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    await db.run(
      'INSERT INTO api_keys (id, user_id, name, key, key_last4) VALUES (?, ?, ?, ?, ?)',
      [id, userId, name.trim(), keyHash, rawKey.slice(-4)]
    );

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
    res.status(500).json({ error: err.message });
  }
});

// Delete API key
router.delete('/:id', async (req, res) => {
  const userId = req.user.id;
  try {
    const db = await getDb();
    await db.run('DELETE FROM api_keys WHERE id = ? AND user_id = ?', [req.params.id, userId]);
    res.json({ message: 'API key revoked' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
