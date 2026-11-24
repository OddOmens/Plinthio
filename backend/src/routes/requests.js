import express from 'express';
import crypto from 'crypto';
import { getDb } from '../config/database.js';
import { authenticateToken, requireEditor } from '../middleware/auth.js';
import { ALL_MEDIA_TYPES } from '../config/mediaTypes.js';
import { handle } from '../utils/http.js';
import { sendError } from '../errors.js';
import { logger } from '../services/logger.js';
import { getSeerrConfig, canSendToSeerr, forwardRequest } from '../services/seerr.js';
import { acceptsAutomatically, markIfArrived } from '../services/requestAutomation.js';

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

// One-line fields: control characters would reach the server log and review queue as is.
function clipLine(value, max) {
  const text = clip(value, max);
  if (text === null) return null;
  return text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').trim() || null;
}

// Where a request was passed on to is the reviewers' business; requesters see its status.
const FORWARD_FIELDS = ['forward_target', 'forward_state', 'forward_reason', 'forward_detail', 'forward_ref', 'forwarded_at'];

// `can_forward`: accepted, a kind the other side takes, and not already there.
function forReviewer(request, forwarding) {
  return {
    ...request,
    can_forward: forwarding && request.status === 'accepted_pending' && canSendToSeerr(request) &&
      !['sent', 'exists'].includes(request.forward_state)
  };
}

function forRequester(request) {
  const out = { ...request };
  for (const field of FORWARD_FIELDS) delete out[field];
  return out;
}

const REVIEW_ROW = `
  SELECT r.*, u.username AS requested_by, h.username AS handled_by_username
  FROM media_requests r
  LEFT JOIN users u ON u.id = r.user_id
  LEFT JOIN users h ON h.id = r.handled_by
  WHERE r.id = ?`;

// Newest first. Own requests; admins and editors can pass scope=all for the review queue.
router.get('/', handle(async (req, res) => {
  const { status, scope } = req.query;
  const all = scope === 'all';
  if (all && !isStaff(req.user)) {
    return sendError(req, res, 'P106');
  }
  if (status && !STATUSES.includes(status)) {
    return res.status(400).json({ error: `Status must be one of: ${STATUSES.join(', ')}` });
  }

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

  if (!isStaff(req.user)) return res.json({ requests: requests.map(forRequester) });
  const forwarding = (await getSeerrConfig(db)).enabled;
  res.json({ requests: requests.map((r) => forReviewer(r, forwarding)), forwarding: forwarding ? 'seerr' : null });
}));

// Pending count for the user menu badge.
router.get('/pending-count', requireEditor, handle(async (req, res) => {
  const db = await getDb();
  const row = await db.get("SELECT COUNT(*) AS count FROM media_requests WHERE status = 'pending'");
  res.json({ count: row.count });
}));

router.post('/', handle(async (req, res) => {
  const { mediaType, source, externalId } = req.body;
  const title = clipLine(req.body.title, 300);

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

  const db = await getDb();

  // One open request per title across all users; a rejected title can be asked for again.
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

  // Accepted on the spot when the admin set requests up that way; otherwise it waits for review.
  const accepted = await acceptsAutomatically(db, req.user);
  const id = crypto.randomUUID();
  await db.run(`
      INSERT INTO media_requests
        (id, user_id, media_type, source, external_id, title, subtitle, author, release_date, overview, cover_url, note,
         status, auto_accepted, handled_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${accepted ? 'CURRENT_TIMESTAMP' : 'NULL'})
    `, [
    id, req.user.id, mediaType, clip(source, 40), clip(externalId, 200),
    title, clipLine(req.body.subtitle, 300), clipLine(req.body.author, 300),
    clipLine(req.body.releaseDate, 40), clip(req.body.overview, 4000), clip(coverUrl, 1000),
    clip(req.body.note?.trim(), 1000), accepted ? 'accepted_pending' : 'pending', accepted ? 1 : 0
  ]);

  logger.info('media', `${req.user.username} requested "${title}" (${mediaType})${accepted ? ', accepted automatically' : ''}`);
  let request = await db.get('SELECT * FROM media_requests WHERE id = ?', [id]);
  if (accepted) {
    // Already in the library (the search just didn't know): done, with nothing to pass on.
    if (!(await markIfArrived(db, request))) await forwardRequest(db, request);
    request = await db.get('SELECT * FROM media_requests WHERE id = ?', [id]);
  }
  res.status(201).json({ message: 'Request sent', request: isStaff(req.user) ? request : forRequester(request) });
}));

// Admins and editors change a request's state and can leave the requester a note.
router.patch('/:id', requireEditor, handle(async (req, res) => {
  const { status } = req.body;
  if (!STATUSES.includes(status)) {
    return res.status(400).json({ error: `Status must be one of: ${STATUSES.join(', ')}` });
  }

  const db = await getDb();
  const request = await db.get('SELECT * FROM media_requests WHERE id = ?', [req.params.id]);
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
  // "Accepted, still to be added" is the moment to pass it on (when a Seerr server is set up).
  // The status is already saved: a failure to send shows on the request, with a way to retry.
  if (status === 'accepted_pending') await forwardRequest(db, request);

  const forwarding = (await getSeerrConfig(db)).enabled;
  const updated = await db.get(REVIEW_ROW, [request.id]);
  res.json({ message: 'Request updated', request: forReviewer(updated, forwarding) });
}));

// Send an accepted request on again, after a failure or for one accepted before Seerr was set up.
router.post('/:id/forward', requireEditor, handle(async (req, res) => {
  const db = await getDb();
  const request = await db.get('SELECT * FROM media_requests WHERE id = ?', [req.params.id]);
  if (!request) return sendError(req, res, 'P506');
  if (request.status !== 'accepted_pending' || !canSendToSeerr(request)) {
    return res.status(400).json({ error: 'Only an accepted film or show found on TMDB can be sent on' });
  }
  if (!(await getSeerrConfig(db)).enabled) return sendError(req, res, 'P507', { status: 400, extra: { reason: 'off' } });

  await forwardRequest(db, request, { again: true });
  const updated = await db.get(REVIEW_ROW, [request.id]);
  res.json({ message: 'Request sent on', request: forReviewer(updated, true) });
}));

// Requesters withdraw their own pending request; admins and editors can delete any.
router.delete('/:id', handle(async (req, res) => {
  const db = await getDb();
  const request = await db.get('SELECT id, user_id, status FROM media_requests WHERE id = ?', [req.params.id]);
  if (!request) return sendError(req, res, 'P506');

  const ownPending = request.user_id === req.user.id && request.status === 'pending';
  if (!ownPending && !isStaff(req.user)) {
    return sendError(req, res, 'P505');
  }

  await db.run('DELETE FROM media_requests WHERE id = ?', [request.id]);
  res.json({ message: 'Request removed' });
}));

export default router;
