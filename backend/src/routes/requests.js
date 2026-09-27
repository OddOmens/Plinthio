import express from 'express';
import crypto from 'crypto';
import { getDb } from '../config/database.js';
import { authenticateToken, requireEditor } from '../middleware/auth.js';
import { ALL_MEDIA_TYPES } from '../config/mediaTypes.js';
import { serverError } from '../utils/http.js';
import { sendError } from '../errors.js';
import { logger } from '../services/logger.js';

const router = express.Router();

router.use(authenticateToken);

const STATUSES = ['pending', 'accepted_pending', 'accepted_added', 'rejected'];

function isStaff(user) {
  return user.role === 'admin' || user.role === 'editor';
}

function clip(value, max) {
  if (value === undefined || value === null || value === '') return null;
  return String(value).slice(0, max);
}

// Requests are listed newest-first. Everyone sees their own; admins and editors can pass
// scope=all to see every user's requests (the review queue).
router.get('/', async (req, res) => {
  const { status, scope } = req.query;
  const all = scope === 'all';
  if (all && !isStaff(req.user)) {
    return sendError(req, res, 'P106');
  }
  if (status && !STATUSES.includes(status)) {
    return res.status(400).json({ error: `Status must be one of: ${STATUSES.join(', ')}` });
  }

  try {
    const db = await getDb();
    const conditions = [];
    const params = [];
    if (!all) {
      conditions.push('r.user_id = ?');
      params.push(req.user.id);
    }
    if (status) {
      conditions.push('r.status = ?');
      params.push(status);
    }

    const requests = await db.all(`
      SELECT r.*, u.username AS requested_by, h.username AS handled_by_username
      FROM media_requests r
      LEFT JOIN users u ON u.id = r.user_id
      LEFT JOIN users h ON h.id = r.handled_by
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY r.created_at DESC
      LIMIT 500
    `, params);

    res.json({ requests });
  } catch (err) {
    serverError(req, res, err);
  }
});

// How many requests are waiting on an admin/editor — drives the badge in the user menu.
router.get('/pending-count', requireEditor, async (req, res) => {
  try {
    const db = await getDb();
    const row = await db.get("SELECT COUNT(*) AS count FROM media_requests WHERE status = 'pending'");
    res.json({ count: row.count });
  } catch (err) {
    serverError(req, res, err);
  }
});

router.post('/', async (req, res) => {
  const { mediaType, source, externalId, title } = req.body;

  if (!mediaType || !source || !externalId || !title) {
    return res.status(400).json({ error: 'mediaType, source, externalId and title are required' });
  }
  if (!ALL_MEDIA_TYPES.includes(mediaType)) {
    return res.status(400).json({ error: 'Unknown media type' });
  }
  // Cover art is rendered straight from the provider, so only accept https URLs.
  const coverUrl = typeof req.body.coverUrl === 'string' && /^https:\/\//.test(req.body.coverUrl)
    ? req.body.coverUrl
    : null;

  try {
    const db = await getDb();

    // One open request per title across all users — a second person asking for the same
    // thing gets told it's already on the queue rather than piling up duplicates. A
    // rejected title can be asked for again.
    const existing = await db.get(`
      SELECT id, status, user_id FROM media_requests
      WHERE source = ? AND external_id = ? AND status != 'rejected'
      ORDER BY created_at DESC LIMIT 1
    `, [source, String(externalId)]);
    if (existing) {
      return sendError(req, res, existing.status === 'accepted_added' ? 'P504' : 'P503', {
        extra: { status: existing.status }
      });
    }

    const id = crypto.randomUUID();
    await db.run(`
      INSERT INTO media_requests
        (id, user_id, media_type, source, external_id, title, subtitle, author, release_date, overview, cover_url, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id, req.user.id, mediaType, clip(source, 40), clip(externalId, 200),
      clip(title, 300), clip(req.body.subtitle, 300), clip(req.body.author, 300),
      clip(req.body.releaseDate, 40), clip(req.body.overview, 4000), clip(coverUrl, 1000),
      clip(req.body.note?.trim(), 1000)
    ]);

    logger.info('media', `${req.user.username} requested "${clip(title, 300)}" (${mediaType})`);
    const request = await db.get('SELECT * FROM media_requests WHERE id = ?', [id]);
    res.status(201).json({ message: 'Request sent', request });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Admins and editors move a request through its states and can leave a note for the
// requester (e.g. why it was rejected).
router.patch('/:id', requireEditor, async (req, res) => {
  const { status } = req.body;
  if (!STATUSES.includes(status)) {
    return res.status(400).json({ error: `Status must be one of: ${STATUSES.join(', ')}` });
  }

  try {
    const db = await getDb();
    const request = await db.get('SELECT id, title FROM media_requests WHERE id = ?', [req.params.id]);
    if (!request) return sendError(req, res, 'P506');

    // Moving a request back to pending un-handles it.
    const handled = status !== 'pending';
    await db.run(`
      UPDATE media_requests
      SET status = ?, response_note = ?, handled_by = ?, handled_at = ${handled ? 'CURRENT_TIMESTAMP' : 'NULL'},
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [status, clip(req.body.responseNote?.trim(), 1000), handled ? req.user.id : null, request.id]);

    logger.info('media', `${req.user.username} set request "${request.title}" to ${status}`);
    const updated = await db.get(`
      SELECT r.*, u.username AS requested_by, h.username AS handled_by_username
      FROM media_requests r
      LEFT JOIN users u ON u.id = r.user_id
      LEFT JOIN users h ON h.id = r.handled_by
      WHERE r.id = ?
    `, [request.id]);
    res.json({ message: 'Request updated', request: updated });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Requesters can withdraw their own request while it's still pending; admins and editors
// can delete any request.
router.delete('/:id', async (req, res) => {
  try {
    const db = await getDb();
    const request = await db.get('SELECT id, user_id, status FROM media_requests WHERE id = ?', [req.params.id]);
    if (!request) return sendError(req, res, 'P506');

    const ownPending = request.user_id === req.user.id && request.status === 'pending';
    if (!ownPending && !isStaff(req.user)) {
      return sendError(req, res, 'P505');
    }

    await db.run('DELETE FROM media_requests WHERE id = ?', [request.id]);
    res.json({ message: 'Request removed' });
  } catch (err) {
    serverError(req, res, err);
  }
});

export default router;
