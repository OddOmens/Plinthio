import express from 'express';
import { getDb } from '../config/database.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { serverError } from '../utils/http.js';

const router = express.Router();

router.use(authenticateToken);
router.use(requireAdmin);

// Get server logs
router.get('/', async (req, res) => {
  const { level, search, limit = 100 } = req.query;

  try {
    const db = await getDb();
    let query = 'SELECT * FROM system_logs WHERE 1=1';
    const params = [];

    if (level && level !== 'all') {
      query += ' AND level = ?';
      params.push(level.toLowerCase());
    }

    if (search) {
      query += ' AND (message LIKE ? OR category LIKE ? OR details LIKE ?)';
      const s = `%${search.trim()}%`;
      params.push(s, s, s);
    }

    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 1000);
    query += ' ORDER BY timestamp DESC, id DESC LIMIT ?';
    params.push(safeLimit);

    const logs = await db.all(query, params);
    res.json({ logs });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Clear all system logs
router.delete('/', async (req, res) => {
  try {
    const db = await getDb();
    await db.run('DELETE FROM system_logs');
    res.json({ message: 'Logs cleared successfully' });
  } catch (err) {
    serverError(req, res, err);
  }
});

export default router;
