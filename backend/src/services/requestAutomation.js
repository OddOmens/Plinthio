import { getSetting, setSetting } from './settings.js';
import { isLimitedAccount } from './visibility.js';
import path from 'path';
import { parseMediaTitle } from './titleCleaner.js';
import { logger } from './logger.js';

// The two steps of a request that need no person: accepting it, and noticing that the title
// has arrived in the library.

const AUTO_ACCEPT_KEY = 'requests_auto_accept';
// off: every request waits for a reviewer. staff: admins' and editors' own requests are
// accepted as they are made. all: everyone's are.
export const AUTO_ACCEPT_MODES = ['off', 'staff', 'all'];

export async function getAutoAccept(db) {
  const stored = await getSetting(db, AUTO_ACCEPT_KEY);
  return AUTO_ACCEPT_MODES.includes(stored) ? stored : 'off';
}

export async function setAutoAccept(db, mode) {
  await setSetting(db, AUTO_ACCEPT_KEY, mode);
}

/**
 * Whether this person's new request skips the review queue. An account with Kids Mode or an
 * age rating limit never does: someone still looks at what it asks for.
 */
export async function acceptsAutomatically(db, user) {
  if (!user || isLimitedAccount(user)) return false;
  const mode = await getAutoAccept(db);
  if (mode === 'all') return true;
  return mode === 'staff' && (user.role === 'admin' || user.role === 'editor');
}

const TMDB_KIND = { movie: 'movie', show: 'tv', anime: 'tv' };
const VIDEO_TYPES = Object.keys(TMDB_KIND);
// A title counts as in the library while its file is there (or was deliberately offloaded).
const PRESENT = '(i.missing_since IS NULL OR i.offloaded_at IS NOT NULL) AND i.extra_type IS NULL';

const year = (date) => {
  const match = /^(\d{4})/.exec(String(date || ''));
  return match ? Number(match[1]) : null;
};

// Library types a request's own type may be found under: a show can sit in an anime library.
function libraryTypes(mediaType) {
  if (mediaType === 'show' || mediaType === 'anime') return ['show', 'anime'];
  return [mediaType];
}

async function findInLibrary(db, request) {
  const types = libraryTypes(request.media_type);
  const typeMarks = types.map(() => '?').join(', ');

  if (request.source === 'tmdb' && TMDB_KIND[request.media_type]) {
    const byId = await db.get(
      `SELECT i.id FROM items i WHERE i.tmdb_id = ? AND i.media_type IN (${typeMarks}) AND ${PRESENT} LIMIT 1`,
      [String(request.external_id), ...types]
    );
    if (byId) return byId;
  }

  const title = String(request.title || '').trim().toLowerCase();
  if (!title) return null;
  const found = await db.all(
    `SELECT i.id, i.title, i.series, i.release_date, i.tmdb_id, i.path FROM items i
     WHERE i.media_type IN (${typeMarks}) AND (LOWER(i.title) = ? OR LOWER(i.series) = ?) AND ${PRESENT}
     LIMIT 50`,
    [...types, title, title]
  );
  const wantedYear = year(request.release_date);
  return found.find((item) => {
    if (!VIDEO_TYPES.includes(request.media_type)) return true;
    // Same name, but the library knows it as a different title.
    if (request.source === 'tmdb' && item.tmdb_id && item.tmdb_id !== String(request.external_id)) return false;
    // Films share names across remakes; a year apart allows for differing release dates.
    if (request.media_type === 'movie' && !item.series) {
      // The library's year: from its metadata, else the one in the file's name.
      const itemYear = year(item.release_date) || year(parseMediaTitle(path.basename(item.path || '')).year);
      if (wantedYear && itemYear && Math.abs(wantedYear - itemYear) > 1) return false;
    }
    return true;
  }) || null;
}

/**
 * Marks one open request as added if its title is in the library; resolves whether it did.
 * A request is only ever marked this way once (`auto_added_at`), so a reviewer who moves it
 * back isn't overruled by the next scan.
 */
export async function markIfArrived(db, request) {
  if (!(await findInLibrary(db, request))) return false;
  // Guarded on the status it was read with, in case a reviewer handled it meanwhile.
  const result = await db.run(
    `UPDATE media_requests
     SET status = 'accepted_added', auto_added_at = CURRENT_TIMESTAMP,
         handled_at = COALESCE(handled_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status = ? AND auto_added_at IS NULL`,
    [request.id, request.status]
  );
  if (!result.changes) return false;
  logger.info('media', `Request "${request.title}" marked as added: it is in the library now`);
  return true;
}

/** Checks every open request against the library, after a scan. Returns how many were marked. */
export async function markArrivedRequests(db) {
  const open = await db.all(
    `SELECT id, media_type, source, external_id, title, release_date, status FROM media_requests
     WHERE status IN ('pending', 'accepted_pending') AND auto_added_at IS NULL
     ORDER BY created_at ASC LIMIT 1000`
  );
  let marked = 0;
  for (const request of open) {
    if (await markIfArrived(db, request)) marked++;
  }
  return marked;
}
