import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';
import https from 'https';
import { fileURLToPath } from 'url';

import { config } from './config/env.js';
import { getDb, closeDb } from './config/database.js';
import { COVER_CSP_SOURCES } from './services/artwork.js';
import { APP_VERSION } from './config/version.js';
import { backupBeforeUpgrade, recordRunningVersion } from './services/upgrade.js';
import { initUpdateCheck } from './services/updateCheck.js';

import rateLimit from 'express-rate-limit';

import authRoutes from './routes/auth.js';
import libraryRoutes from './routes/libraries.js';
import itemRoutes from './routes/items.js';
import mediaRoutes from './routes/media.js';
import videoRoutes from './routes/video.js';
import progressRoutes from './routes/progress.js';
import userRoutes from './routes/users.js';
import logRoutes from './routes/logs.js';
import statRoutes from './routes/stats.js';
import apiKeyRoutes from './routes/apiKeys.js';
import collectionRoutes from './routes/collections.js';
import bookmarkRoutes from './routes/bookmarks.js';
import highlightRoutes from './routes/highlights.js';
import settingRoutes from './routes/settings.js';
import metadataRoutes from './routes/metadata.js';
import customizationRoutes from './routes/customization.js';
import partyRoutes from './routes/party.js';
import liveRoutes from './routes/live.js';
import liveMediaRoutes from './routes/liveMedia.js';
import { initLiveTv } from './services/liveTv.js';
import { startPartySweeper } from './services/party.js';
import activityRoutes from './routes/activity.js';
import seriesRoutes from './routes/series.js';
import requestRoutes from './routes/requests.js';
import { attachErrorCodes, errorCatalog, sendError } from './errors.js';
import opdsRoutes from './routes/opds.js';
import { komgaV1, komgaV2 } from './routes/komga.js';
import kosyncRoutes from './routes/kosync.js';
import healthRoutes from './routes/health.js';
import kidsRoutes from './routes/kids.js';
import systemRoutes from './routes/system.js';
import ratingRoutes from './routes/ratings.js';
import networkRoutes from './routes/network.js';
import { noteProxyHeaders, noteTailscale } from './services/network.js';
import { warmThumbnailCache } from './services/thumbnails.js';
import { initBackupScheduler } from './services/backup.js';
import { initAutoScan } from './services/autoScan.js';
import { backfillMovieCredits } from './services/credits.js';
import { sweepHlsCache } from './services/hls.js';
import { initCompat } from './services/compat.js';
import { sweepArchiveCache } from './services/archive/sevenZipBackend.js';
import { sweepPageCache } from './services/pageImages.js';
import { sweepPdfPageCache } from './services/pdf.js';
import { oneLineError } from './services/logger.js';
import { sweepTrickplayCache } from './services/trickplay.js';
import { tlsSettings, loadTlsCredentials, refreshTlsCredentials, tlsStatus, caCertificate, noteRequestHost } from './services/tls.js';
import { SEND_OPTS } from './utils/fileStream.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// X-Forwarded-For only when configured (see TRUST_PROXY in env.js).
if (config.trustProxy !== false) {
  app.set('trust proxy', config.trustProxy);
}
// Admin → Network warns when a proxy is in front that TRUST_PROXY doesn't cover (services/network.js).
app.use((req, res, next) => { noteProxyHeaders(req); noteTailscale(req); next(); });

// CSP: the session token lives in localStorage, so this is the backstop against injected
// script. No inline or third-party script except the Cast SDK; images from us plus the cover
// providers (COVER_CSP_SOURCES).
//   - gstatic: only the Cast SDK folders (trailing slash = folder), since the host also serves
//     old libraries that could be misused to bypass the policy
//   - style 'unsafe-inline': Vue style bindings, admin custom CSS, EPUB styling
//   - blob:/data:: hls.js MediaSource, epub.js resources, placeholder covers
//   - no upgrade-insecure-requests: it would break plain-HTTP LAN installs
// CSP=off disables it, CSP=report-only reports only.
// cast_sender.js pulls in /cast/sdk/libs/sender/…/cast_framework.js and /eureka/clank/….
const CAST_SCRIPT_SOURCES = [
  'https://www.gstatic.com/cv/js/sender/',
  'https://www.gstatic.com/cast/sdk/libs/',
  'https://www.gstatic.com/eureka/clank/'
];
const cspMode = (process.env.CSP || 'on').toLowerCase();
const contentSecurityPolicy = cspMode === 'off' ? false : {
  useDefaults: false,
  reportOnly: cspMode === 'report-only',
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", ...CAST_SCRIPT_SOURCES],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'blob:', ...COVER_CSP_SOURCES],
    mediaSrc: ["'self'", 'blob:'],
    fontSrc: ["'self'", 'data:', 'blob:'],
    connectSrc: ["'self'", 'https://www.gstatic.com'],
    workerSrc: ["'self'", 'blob:'],
    frameSrc: ["'self'", 'blob:'],
    manifestSrc: ["'self'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'self'"]
  }
};

// No HSTS: it pins per host name, not port, so it would break plain HTTP on the same host.
// A TLS-terminating proxy can still send it.
app.use(helmet({
  contentSecurityPolicy,
  crossOriginEmbedderPolicy: false,
  strictTransportSecurity: tlsSettings.port ? false : undefined
}));
// No cross-origin access by default (the web app is same-origin, apps aren't browsers);
// CORS_ORIGIN opens it. `credentials` stays off: auth is a Bearer token, and the only cookie
// (Komga session) is SameSite=Lax and limited to /api/v1 and /api/v2.
if (config.corsOrigin) {
  app.use(cors({ origin: config.corsOrigin }));
} else {
  // Chromecast's receiver page fetches streams cross-origin; the URLs carry a media token, so
  // this exposes nothing to anyone without the link.
  app.use('/api/media/video', cors({ origin: '*', methods: ['GET', 'HEAD'] }));
}

// Compress JSON; skip media and images (already compressed) and no-transform responses.
app.use(compression({
  threshold: 1024,
  filter: (req, res) => {
    const type = res.getHeader('Content-Type') || '';
    if (typeof type === 'string' && /^(image|video|audio)\//.test(type)) return false;
    return compression.filter(req, res);
  }
}));

app.use(express.json());
// Express 5 leaves req.body undefined when a request has no JSON body; routes destructure it.
app.use((req, res, next) => {
  req.body ??= {};
  next();
});

// Built-in HTTPS learns device addresses (noteRequestHost) only from signed-in requests or
// first-run setup, checked after the response. Re-issue is debounced.
let httpsServer = null;
let reissueTimer = null;
app.use((req, res, next) => {
  if (httpsServer) {
    res.on('finish', () => {
      const setupDone = req.method === 'POST' && req.originalUrl.split('?')[0] === '/api/auth/setup' && res.statusCode === 200;
      if ((req.user || setupDone) && noteRequestHost(req.hostname)) {
        clearTimeout(reissueTimer);
        reissueTimer = setTimeout(refreshHttpsCertificate, 2000);
      }
    });
  }
  next();
});

// Fills in a status-based error code for responses that don't name one.
app.use('/api', attachErrorCodes);

// Redact `?token=` from the access log.
morgan.token('url', (req) => (req.originalUrl || req.url).replace(/([?&]token=)[^&]+/i, '$1[REDACTED]'));
app.use(morgan('dev'));

// Media routes make many small requests, so they get a looser limit than the JSON API.
const mediaLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1200,
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/media/video', mediaLimiter, videoRoutes);
// Live TV streams: a playlist every few seconds plus every segment, like video.
app.use('/api/media/live', mediaLimiter, liveMediaRoutes);
app.use('/api/media', mediaLimiter, mediaRoutes);
// Komga (Mihon) and KOReader sync: Mihon fetches pages one by one, so the media limiter.
app.use('/api/v1', mediaLimiter, komgaV1);
app.use('/api/v2', mediaLimiter, komgaV2);
app.use('/api/kosync', mediaLimiter, kosyncRoutes);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Please try again later.', code: 'P108' },
  // Skip routes the app calls on every load; they can't be used to guess anything.
  skip: (req) => req.method === 'GET' || ['/refresh', '/media-token', '/me'].includes(req.path)
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false
});

// Per-address limit on failed /login and /login/2fa attempts (successes don't count, so a
// shared household IP isn't locked out). Per-account limits are in routes/auth.js.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please wait before trying again.', code: 'P108' }
});

// Full backups are heavy disk work, so a replayed admin token can't trigger them back-to-back.
const backupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many backup requests. Please wait before trying again.', code: 'P005' }
});

app.use('/api/', apiLimiter);
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth', authLimiter, authRoutes);
// Only operations that write or stream a snapshot.
app.get('/api/settings/backup', backupLimiter);
app.use(['/api/settings/backup/create', '/api/settings/backup/copy'], backupLimiter);
app.use('/api/libraries', libraryRoutes);
app.use('/api/items', itemRoutes);
app.use('/api/progress', progressRoutes);
app.use('/api/users', userRoutes);
app.use('/api/admin/logs', logRoutes);
app.use('/api/admin/health', healthRoutes);
app.use('/api/admin/network', networkRoutes);
app.use('/api/kids', kidsRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/stats', statRoutes);
app.use('/api/keys', apiKeyRoutes);
app.use('/api/collections', collectionRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/bookmarks', bookmarkRoutes);
app.use('/api/highlights', highlightRoutes);
app.use('/api/settings', settingRoutes);
app.use('/api/metadata', metadataRoutes);
app.use('/api/customization', customizationRoutes);
app.use('/api/party', partyRoutes);
app.use('/api/live', liveRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/series', seriesRoutes);
app.use('/api/ratings', ratingRoutes);
// OPDS readers fetch pages one at a time, so the media limiter.
app.use('/api/opds', mediaLimiter, opdsRoutes);

// The error code catalog, for the in-app docs. Public, like the docs page itself.
app.get('/api/errors', (req, res) => {
  res.json({ codes: errorCatalog() });
});

// Public: a phone needs the CA certificate before trusting HTTPS, and it holds no secret.
app.get('/api/tls', (req, res) => {
  const status = tlsStatus();
  res.json({ enabled: status.enabled, port: status.enabled ? tlsSettings.port : null, caAvailable: status.mode === 'generated' });
});
app.get('/api/tls/ca.crt', (req, res) => {
  const ca = caCertificate();
  if (!ca) return res.status(404).json({ error: 'Plinthio is not using its own certificate authority' });
  // This content type makes iOS offer "Profile Downloaded" instead of showing text.
  res.setHeader('Content-Type', 'application/x-x509-ca-cert');
  res.setHeader('Content-Disposition', 'attachment; filename="plinthio-ca.crt"');
  res.send(ca);
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', version: APP_VERSION, app: 'Plinthio' });
});

const frontendDist = path.resolve(__dirname, '../../frontend/dist');
if (fs.existsSync(frontendDist)) {
  // /assets/ filenames are content-hashed, so cache for a year; everything else (index.html,
  // sw.js, manifest) is rechecked each time so updates are picked up.
  app.use(express.static(frontendDist, {
    setHeaders(res, filePath) {
      const rel = path.relative(frontendDist, filePath);
      res.setHeader('Cache-Control', rel.startsWith(`assets${path.sep}`)
        ? 'public, max-age=31536000, immutable'
        : 'no-cache');
    }
  }));
  app.get('/{*splat}', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(frontendDist, 'index.html'), SEND_OPTS);
  });
}

app.use((err, req, res, next) => {
  // The message can quote the request (a JSON parse error includes part of the body).
  console.error('Unhandled error:', oneLineError(err));
  // Body-parser errors are safe to describe; anything else stays in the log.
  if (err.type === 'entity.parse.failed') {
    return sendError(req, res, 'P001', { message: err.message, status: err.status || 400 });
  }
  if (err.type === 'entity.too.large') {
    return sendError(req, res, 'P007', { message: err.message, status: 413 });
  }
  sendError(req, res, 'P000', { err });
});

async function start() {
  try {
    // Snapshot the database before a new version's migrations run.
    const upgrade = await backupBeforeUpgrade();

    await getDb();
    recordRunningVersion();
    if (upgrade) {
      console.log(`[upgrade] Now running Plinthio ${APP_VERSION}.`);
    }

    // New-release banner for admins; UPDATE_CHECK=false disables the check.
    initUpdateCheck();

    warmThumbnailCache().catch(e => console.warn('Thumbnail warming warning:', e.message));

    initBackupScheduler();

    // Periodic re-scan plus a filesystem watcher where supported.
    initAutoScan();

    // Watch parties: drop ones everyone has left, release anyone stuck buffering.
    startPartySweeper();

    // Live TV: refresh each channel source's playlist and guide every 12 hours while it's on.
    initLiveTv();

    // Fill in TMDB credits and collections for films not yet looked up; delayed past startup.
    setTimeout(() => backfillMovieCredits().catch(() => {}), 15000);

    // Resume the converted-copies queue.
    initCompat().catch((err) => console.error('[compat] could not start the conversion queue:', err.message));

    // Hourly eviction of stale HLS segments and unpacked 7z archives (HLS_CACHE_MAX_AGE_HOURS).
    // Trickplay sheets are slow to build, so they keep a 30-day limit.
    const cacheMaxAgeMs = config.hlsCacheMaxAgeHours * 60 * 60 * 1000;
    const sweepCaches = () => {
      sweepHlsCache(cacheMaxAgeMs);
      sweepArchiveCache(cacheMaxAgeMs);
      sweepPageCache(cacheMaxAgeMs);
      sweepPdfPageCache(cacheMaxAgeMs);
      sweepTrickplayCache();
    };
    sweepCaches();
    setInterval(sweepCaches, 60 * 60 * 1000).unref();

    const server = app.listen(config.port, config.host, () => {
      console.log(`
=====================================================
  📚 Plinthio Media Server v${APP_VERSION} is Running!
  ---------------------------------------------------
  Local:    http://localhost:${config.port}
  Network:  http://${config.host}:${config.port}
  Data Dir: ${config.dataDir}
=====================================================
      `);
    });
    const servers = [server];
    const secure = startHttps();
    if (secure) servers.push(secure);
    handleShutdown(servers);
  } catch (err) {
    console.error('Failed to start Plinthio:', err);
    process.exit(1);
  }
}

// HTTPS alongside HTTP (HTTPS_PORT). The certificate is checked daily and re-issued for a new
// LAN address or near expiry, without a restart.
function startHttps() {
  if (!tlsSettings.port) return null;
  let credentials;
  try {
    credentials = loadTlsCredentials();
  } catch (err) {
    console.error('[tls] Could not prepare a certificate, HTTPS is off:', err.message);
    return null;
  }
  if (!credentials) return null;

  const server = https.createServer(credentials, app);
  httpsServer = server;
  server.on('error', (err) => console.error(`[tls] HTTPS server error on port ${tlsSettings.port}:`, err.message));
  server.listen(tlsSettings.port, config.host, () => {
    console.log(`  🔒 HTTPS:  https://localhost:${tlsSettings.port}`);
    if (tlsStatus().mode === 'generated') {
      console.log('     Install the CA from /api/tls/ca.crt on your devices to stop certificate warnings.');
    }
  });
  setInterval(refreshHttpsCertificate, 24 * 60 * 60 * 1000).unref();
  return server;
}

// Non-blocking re-issue, so requests are served while openssl runs.
async function refreshHttpsCertificate() {
  if (!httpsServer) return;
  try {
    const fresh = await refreshTlsCredentials();
    if (fresh) httpsServer.setSecureContext(fresh);
  } catch (err) {
    console.error('[tls] Certificate refresh failed:', err.message);
  }
}

// As PID 1 in Docker, Node ignores SIGTERM unless handled, and would be SIGKILLed mid-write.
// Stop serving, close the database (checkpointing WAL) and exit; a second signal or a hang
// exits at once.
function handleShutdown(servers) {
  let stopping = false;
  const shutdown = (signal) => {
    if (stopping) process.exit(1);
    stopping = true;
    console.log(`[shutdown] ${signal} received, stopping Plinthio…`);
    setTimeout(() => process.exit(1), 8000).unref();
    for (const server of servers) {
      server.close();
      // Streams and watch-party connections stay open indefinitely; don't wait on them.
      server.closeIdleConnections?.();
    }
    closeDb()
      .catch((err) => console.error('[shutdown] closing the database failed:', err))
      .finally(() => process.exit(0));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// An unhandled rejection would otherwise crash the server; log it and keep serving.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', oneLineError(reason));
});

start();
