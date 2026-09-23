import express from 'express';
import crypto from 'crypto';
import { getDb } from '../config/database.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticateToken);

// Start a view/listen/read/watch session — called when a reader or player opens an item.
// Snapshots the item's title/media_type at open time so the activity feed still reads
// sensibly even if the item is later deleted or its library re-scanned.
router.post('/start', async (req, res) => {
  const { itemId } = req.body;
  if (!itemId) {
    return res.status(400).json({ error: 'itemId is required' });
  }

  try {
    const db = await getDb();
    const item = await db.get('SELECT title, media_type FROM items WHERE id = ?', [itemId]);

    const id = crypto.randomUUID();
    await db.run(
      `INSERT INTO view_sessions (id, user_id, item_id, item_title, media_type, started_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [id, req.user.id, itemId, item?.title || null, item?.media_type || null]
    );

    res.json({ sessionId: id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Close a view/listen/read/watch session, stamping how long it was open.
router.post('/end', async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required' });
  }

  try {
    const db = await getDb();
    const session = await db.get(
      'SELECT id, started_at FROM view_sessions WHERE id = ? AND user_id = ? AND ended_at IS NULL',
      [sessionId, req.user.id]
    );
    // Already closed, or never existed (e.g. duplicate unmount events) — not an error, just
    // nothing left to do.
    if (!session) {
      return res.json({ message: 'Session already closed' });
    }

    const durationSeconds = Math.max(0, Math.round((Date.now() - new Date(session.started_at + 'Z').getTime()) / 1000));
    await db.run(
      'UPDATE view_sessions SET ended_at = CURRENT_TIMESTAMP, duration_seconds = ? WHERE id = ?',
      [durationSeconds, sessionId]
    );

    res.json({ message: 'Session closed', durationSeconds });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Current user's own recent activity: sign-ins and view sessions, merged and time-sorted.
router.get('/me', async (req, res) => {
  const userId = req.user.id;
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);

  try {
    const db = await getDb();
    const logins = await db.all(
      `SELECT 'login' as type, id, success, ip_address, created_at
       FROM login_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
      [userId, limit]
    );
    const views = await db.all(
      `SELECT 'view' as type, id, item_id, item_title, media_type, started_at, ended_at, duration_seconds
       FROM view_sessions WHERE user_id = ? ORDER BY started_at DESC LIMIT ?`,
      [userId, limit]
    );

    const merged = [
      ...logins.map(l => ({ ...l, timestamp: l.created_at })),
      ...views.map(v => ({ ...v, timestamp: v.started_at }))
    ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, limit);

    res.json({ activity: merged });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: combined sign-in + viewing activity feed across every user.
router.get('/admin', requireAdmin, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const userId = req.query.userId || null;

  try {
    const db = await getDb();

    const loginParams = userId ? [userId, limit] : [limit];
    const logins = await db.all(
      `SELECT 'login' as type, lh.id, lh.username, lh.success, lh.ip_address, lh.user_agent, lh.created_at
       FROM login_history lh
       ${userId ? 'WHERE lh.user_id = ?' : ''}
       ORDER BY lh.created_at DESC LIMIT ?`,
      loginParams
    );

    const viewParams = userId ? [userId, limit] : [limit];
    const views = await db.all(
      `SELECT 'view' as type, vs.id, u.username, vs.item_id, vs.item_title, vs.media_type,
              vs.started_at, vs.ended_at, vs.duration_seconds
       FROM view_sessions vs
       JOIN users u ON vs.user_id = u.id
       ${userId ? 'WHERE vs.user_id = ?' : ''}
       ORDER BY vs.started_at DESC LIMIT ?`,
      viewParams
    );

    const merged = [
      ...logins.map(l => ({ ...l, timestamp: l.created_at })),
      ...views.map(v => ({ ...v, timestamp: v.started_at }))
    ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, limit);

    res.json({ activity: merged });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
