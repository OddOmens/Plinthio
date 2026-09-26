// Plinthio error codes. Every error response from the API carries one:
//
//   { "error": "<message for the user>", "code": "P101" }
//
// (plus "detail" with the underlying cause, for admins only — see sendError).
//
// Codes are grouped by area:
//   P0xx  general         P1xx  sign-in & permissions   P2xx  libraries & scanning
//   P3xx  playback        P4xx  metadata providers      P5xx  lists & requests
//
// Codes marked side: 'client' are raised by the web app itself (e.g. the video player
// noticing the browser can't decode a stream) rather than returned by the server.
//
// Codes are permanent: once published, a code keeps its meaning. Retire one by leaving it
// out, never by reusing it. docs/error-codes.md is generated from this file
// (`npm run docs:errors`), and a test fails if the two drift apart.

export const ERROR_CODES = {
  // ── General ──────────────────────────────────────────────────────────────────────────
  P000: {
    status: 500,
    title: 'Unexpected server error',
    message: 'Something went wrong on the server',
    meaning: 'The server hit an error it has no specific code for.',
    fix: 'Check Admin → Logs (or `docker logs plinthio`) for the full error. Admins also see the cause in the error message itself.'
  },
  P001: {
    status: 400,
    title: 'Invalid request',
    message: 'The request was not valid',
    meaning: 'A required field was missing or a value was out of range.',
    fix: 'The message says which field. If the web app sent it, reload the page. An old cached version can send outdated requests.'
  },
  P002: {
    status: 404,
    title: 'Not found',
    message: 'Not found',
    meaning: 'The thing asked for does not exist, or is hidden from this account.',
    fix: 'It may have been deleted or moved by a rescan. Refresh the page.'
  },
  P003: {
    status: 403,
    title: 'Not allowed',
    message: 'You do not have permission to do that',
    meaning: 'The account is signed in but not permitted to perform this action.',
    fix: 'Ask an admin to change your role or access if you need this.'
  },
  P004: {
    status: 409,
    title: 'Conflict',
    message: 'That conflicts with something that already exists',
    meaning: 'The action clashes with existing data, such as a duplicate name.',
    fix: 'The message says what clashed. Rename or remove the existing item first.'
  },
  P005: {
    status: 429,
    title: 'Too many requests',
    message: 'Too many requests, slow down and try again shortly',
    meaning: 'A rate limit was hit.',
    fix: 'Wait a minute and try again. If many people share one IP behind a reverse proxy, set TRUST_PROXY=1 so they are limited separately.'
  },
  P006: {
    status: 503,
    title: 'Temporarily unavailable',
    message: 'The server is busy, try again shortly',
    meaning: 'The server could not handle the request right now.',
    fix: 'Try again in a few seconds.'
  },
  P007: {
    status: 400,
    title: 'Upload rejected',
    message: 'That file could not be uploaded',
    meaning: 'An uploaded file was too large or of the wrong type.',
    fix: 'Images must be under 15 MB. Backups must be Plinthio backup files.'
  },

  // ── Sign-in & permissions ────────────────────────────────────────────────────────────
  P100: {
    status: 401,
    title: 'Sign-in required',
    message: 'Authentication required',
    meaning: 'The request carried no session, media token or API key.',
    fix: 'Sign in again. For scripts, send an X-API-Key header.'
  },
  P101: {
    status: 401,
    title: 'Session expired',
    message: 'Session expired, please log in again',
    meaning: 'The session token is expired, malformed, or was revoked by a password change or "sign out everywhere".',
    fix: 'Sign in again.'
  },
  P102: {
    status: 401,
    title: 'Token used in the wrong place',
    message: 'This token is not valid here',
    meaning: 'A media token was sent as an Authorization header, or used outside /api/media. Or a session token was put in a URL. Media tokens only work as ?token= on media URLs, and session tokens only work in the Authorization header.',
    fix: 'This is a bug in the client that made the request. In the web app, reload the page. If it persists, report it with this code.'
  },
  P103: {
    status: 403,
    title: 'Account expired',
    message: 'Your account access has expired. Please contact your administrator.',
    meaning: 'The account has an expiry date that has passed.',
    fix: 'An admin can extend or clear the expiry in Admin → Users.'
  },
  P104: {
    status: 401,
    title: 'Invalid API key',
    message: 'Invalid API key',
    meaning: 'The X-API-Key (or HTTP Basic password) does not match any key.',
    fix: 'Create a new key in Settings → API Keys. Keys are shown only once, when created.'
  },
  P105: {
    status: 403,
    title: 'Admin only',
    message: 'Admin privileges required',
    meaning: 'This action needs the admin role.',
    fix: 'Ask an admin to do it, or to promote your account.'
  },
  P106: {
    status: 403,
    title: 'Editor or admin only',
    message: 'Editor privileges required',
    meaning: 'This action needs the editor or admin role.',
    fix: 'Ask an admin to make your account an editor.'
  },
  P107: {
    status: 401,
    title: 'Wrong username or password',
    message: 'Invalid username or password',
    meaning: 'The sign-in details did not match an account.',
    fix: 'Check the username and password. An admin can reset a password in Admin → Users.'
  },
  P108: {
    status: 429,
    title: 'Too many sign-in attempts',
    message: 'Too many sign-in attempts, try again later',
    meaning: 'Sign-in is rate limited to slow down password guessing.',
    fix: 'Wait 15 minutes and try again.'
  },

  // ── Libraries & scanning ─────────────────────────────────────────────────────────────
  P200: {
    status: 400,
    title: 'Library folder not found',
    message: 'Library folder not found',
    meaning: 'The folder a library points at does not exist inside the server (or container).',
    fix: 'In Docker, your media is mounted at /media, so library paths look like /media/Movies. Check MEDIA_DIR in docker/.env points at the right host folder.'
  },
  P201: {
    status: 500,
    title: 'Library folder unreadable (I/O error)',
    message: 'The media folder could not be read (I/O error)',
    meaning: 'Reading the folder failed with EIO. Almost always the drive behind it disconnected or was remounted, leaving a stale mount. A remounted USB drive can come back under a new path such as /media/you/Drive1.',
    fix: 'Check the drive is connected and mounted (`mount | grep media`). Point MEDIA_DIR at its current mount path and recreate the container. Mounting the drive by UUID in /etc/fstab keeps the path stable.'
  },
  P202: {
    status: 403,
    title: 'Library folder permission denied',
    message: 'The server does not have permission to read that folder',
    meaning: 'The folder exists but the Plinthio process cannot read it (EACCES).',
    fix: 'Give the container user read access to the media folder, e.g. with `chmod -R o+rX` on the host folder or matching PUID/PGID.'
  },
  P203: {
    status: 400,
    title: 'Not a folder',
    message: 'That path is not a folder',
    meaning: 'The library path points at a file rather than a directory.',
    fix: 'Choose the folder that contains your media.'
  },

  // ── Playback ─────────────────────────────────────────────────────────────────────────
  P300: {
    status: 404,
    title: 'Media not found',
    message: 'Media not found',
    meaning: 'No item with that id exists, or it is hidden from this account by an admin or parental controls.',
    fix: 'Refresh the library. A rescan may have replaced the item.'
  },
  P301: {
    status: 404,
    title: 'Media file missing',
    message: 'The media file is missing from disk',
    meaning: 'The item is in the library but its file is gone. It was moved, renamed or deleted, or the drive is not mounted.',
    fix: 'Check the drive is mounted, then rescan the library.'
  },
  P302: {
    status: 500,
    title: 'Media file unreadable',
    message: 'The media file could not be read',
    meaning: 'Reading the file failed. Usually a disconnected drive (EIO), a permissions problem, or a corrupt file.',
    fix: 'See P201/P202 for drive and permission problems. Check Admin → Logs for the underlying error.'
  },
  P303: {
    status: 500,
    title: 'ffmpeg not available',
    message: 'Video conversion is unavailable: ffmpeg could not be started',
    meaning: 'ffmpeg or ffprobe is missing or failed to launch, so videos that need converting cannot play.',
    fix: 'The Docker image includes ffmpeg. On a bare-metal install, install ffmpeg and make sure it is on PATH. Check Admin → Logs.'
  },
  P304: {
    status: 500,
    title: 'Conversion failed',
    message: 'Converting this video failed on the server',
    meaning: 'ffmpeg started but exited with an error while converting the video. Usually a corrupt file, an unsupported codec, or a hardware transcoding problem.',
    fix: 'Admin → Logs shows the ffmpeg error. If it mentions VAAPI/QSV/NVENC, turn hardware transcoding off in Admin → Server Settings and try again.'
  },
  P305: {
    status: 503,
    title: 'Still preparing',
    message: 'Still preparing this video, try again shortly',
    meaning: 'The conversion is running but has not produced the requested part yet.',
    fix: 'The player retries this on its own. If it never finishes, the server may be too slow for real-time transcoding at this quality. Pick a lower quality.'
  },
  P306: {
    status: 400,
    title: 'Invalid stream request',
    message: 'Invalid stream request',
    meaning: 'The stream URL named an unknown quality, audio track, segment or preview sheet.',
    fix: 'Reload the player. This usually means a stale URL after the video was rescanned.'
  },
  P307: {
    status: 404,
    title: 'Subtitle track not found',
    message: 'Subtitle track not found',
    meaning: 'The requested subtitle track does not exist or could not be extracted.',
    fix: 'Pick another track. Image-based subtitles (PGS/VobSub) cannot be shown as text.'
  },
  P350: {
    status: null,
    side: 'client',
    title: 'Browser cannot play this format',
    message: 'This browser cannot play this video',
    meaning: 'The browser rejected the stream even after the server converted it.',
    fix: 'Try another browser (Chrome, Edge or Safari). If this happens on every browser, the file itself may be damaged.'
  },
  P351: {
    status: null,
    side: 'client',
    title: 'Connection lost during playback',
    message: 'Lost connection to the server',
    meaning: 'The player could not reach the server to load the next part of the video.',
    fix: 'Check your network connection, then press Retry.'
  },
  P352: {
    status: null,
    side: 'client',
    title: 'Media link could not be renewed',
    message: 'Your media access expired and could not be renewed',
    meaning: 'Media URLs carry a short-lived token. It expired and the app could not get a new one.',
    fix: 'Reload the page. If that does not help, sign out and back in.'
  },

  // ── Metadata providers ───────────────────────────────────────────────────────────────
  P400: {
    status: 409,
    title: 'TMDB key not configured',
    message: 'TMDB API key is not configured. An admin must add one in Server Settings.',
    meaning: 'Movie, show and anime metadata comes from TMDB, which needs a free API key.',
    fix: 'Create a key at themoviedb.org → Settings → API and paste it into Admin → Server Settings.'
  },
  P401: {
    status: 502,
    title: 'Provider rejected the API key',
    message: 'The metadata provider rejected the configured API key',
    meaning: 'The server reached the provider, but the provider refused the key.',
    fix: 'For TMDB, paste either the "API Key" or the "API Read Access Token" from your TMDB account into Server Settings.'
  },
  P402: {
    status: 502,
    title: 'Provider rate limit',
    message: 'The metadata provider is rate limiting this server. Wait a moment and try again.',
    meaning: 'The provider is refusing requests because too many were sent.',
    fix: 'Wait a minute. Batch matching large libraries can trigger this.'
  },
  P403: {
    status: 502,
    title: 'Provider unreachable',
    message: 'Could not reach the metadata provider from the server',
    meaning: 'The request to the provider timed out or failed at the network level.',
    fix: 'Check the server (container) has outbound internet access and DNS.'
  },

  // ── Lists & requests ─────────────────────────────────────────────────────────────────
  P500: {
    status: 404,
    title: 'List not found',
    message: 'List not found',
    meaning: 'The list or folder does not exist or belongs to someone else.',
    fix: 'Refresh the Lists page.'
  },
  P501: {
    status: 400,
    title: 'Wrong kind of title for this list',
    message: 'That kind of title cannot go in this list',
    meaning: 'Each list holds one category: Movies, Shows, Anime, Read or Listen.',
    fix: 'Add it to a list in the matching category.'
  },
  P502: {
    status: 409,
    title: 'Already in list',
    message: 'That title is already in this list',
    meaning: 'The title was added to this list before.',
    fix: 'Nothing to do.'
  },
  P503: {
    status: 409,
    title: 'Already requested',
    message: 'That title has already been requested',
    meaning: 'Someone has an open request for this title.',
    fix: 'Its status is shown on the Requests page.'
  },
  P504: {
    status: 409,
    title: 'Already in the library',
    message: 'That title has already been added to the library',
    meaning: 'A request for this title was accepted and marked as added.',
    fix: 'Search the library for it.'
  },
  P505: {
    status: 403,
    title: 'Request can no longer be withdrawn',
    message: 'Only pending requests can be withdrawn',
    meaning: 'An admin or editor has already acted on this request.',
    fix: 'Ask an admin or editor if you want it removed.'
  },
  P506: {
    status: 404,
    title: 'Request not found',
    message: 'Request not found',
    meaning: 'The request was deleted or never existed.',
    fix: 'Refresh the Requests page.'
  }
};

// Fallback code for error responses that don't name one, keyed by HTTP status.
const STATUS_FALLBACK = { 400: 'P001', 401: 'P100', 403: 'P003', 404: 'P002', 409: 'P004', 413: 'P007', 429: 'P005', 503: 'P006' };

export function codeForStatus(status) {
  return STATUS_FALLBACK[status] || (status >= 500 ? 'P000' : 'P001');
}

// Filesystem failures map onto library/playback codes so "the drive fell off" reads as that,
// not as a generic 500.
export function codeForFsError(err, { playback = false } = {}) {
  switch (err?.code) {
    case 'EIO':
    case 'ENOTCONN':
    case 'ESTALE':
      return playback ? 'P302' : 'P201';
    case 'EACCES':
    case 'EPERM':
      return playback ? 'P302' : 'P202';
    case 'ENOENT':
      return playback ? 'P301' : 'P200';
    case 'ENOTDIR':
      return 'P203';
    default:
      return null;
  }
}

// An error that already knows its Plinthio code, for services to throw and routes to send.
export class PlinthioError extends Error {
  constructor(code, message, { cause } = {}) {
    super(message || ERROR_CODES[code]?.message || 'Error', cause ? { cause } : undefined);
    this.plinthioCode = code;
  }
}

/**
 * Send an error response carrying a Plinthio code.
 *
 *   sendError(req, res, 'P301')                               // catalog message + status
 *   sendError(req, res, 'P001', { message: 'name is required' })
 *   sendError(req, res, 'P000', { err })                      // logs err; admins get detail
 *
 * Unexpected failures (SQL errors, filesystem errors) carry internals in their message —
 * table names, absolute paths, library layout. Those belong in the server log, not in a
 * response any signed-in viewer can read. Admins still get the detail, since they're the
 * ones who'd act on it and can already read the logs anyway.
 */
export function sendError(req, res, code, { message, err, status, extra } = {}) {
  const entry = ERROR_CODES[code] || ERROR_CODES.P000;
  const httpStatus = status || entry.status || 500;
  if (err && httpStatus >= 500) {
    console.error(`[${code}] [${req.method} ${req.baseUrl || ''}${req.route?.path || ''}]`, err);
  }
  if (res.headersSent) return;

  const body = { error: message || entry.message, code, ...extra };
  // For a PlinthioError the useful part (ffmpeg's stderr, the fs error) is its cause.
  const cause = err?.cause?.message || err?.message;
  if (cause && req.user?.role === 'admin' && cause !== body.error) {
    body.detail = cause;
  }
  res.status(httpStatus).json(body);
}

// Safety net: any error response a route sends without a code gets one from its HTTP status,
// so every error the API returns can be looked up in the docs.
export function attachErrorCodes(req, res, next) {
  const json = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 400 && body && typeof body === 'object' && !Array.isArray(body) && !body.code) {
      body = { ...body, code: codeForStatus(res.statusCode) };
    }
    return json(body);
  };
  next();
}

// The catalog as served to the docs page and written to docs/error-codes.md.
export function errorCatalog() {
  return Object.entries(ERROR_CODES).map(([code, e]) => ({
    code,
    status: e.status,
    side: e.side || 'server',
    title: e.title,
    message: e.message,
    meaning: e.meaning,
    fix: e.fix
  }));
}
