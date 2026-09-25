import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { config } from './config/env.js';
import { getDb } from './config/database.js';
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
import settingRoutes from './routes/settings.js';
import metadataRoutes from './routes/metadata.js';
import customizationRoutes from './routes/customization.js';
import activityRoutes from './routes/activity.js';
import seriesRoutes from './routes/series.js';
import requestRoutes from './routes/requests.js';
import opdsRoutes from './routes/opds.js';
import healthRoutes from './routes/health.js';
import systemRoutes from './routes/system.js';
import { warmThumbnailCache } from './services/thumbnails.js';
import { initBackupScheduler } from './services/backup.js';
import { initAutoScan } from './services/autoScan.js';
import { sweepHlsCache } from './services/hls.js';
import { sweepArchiveCache } from './services/archive/sevenZipBackend.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Only honour X-Forwarded-For when explicitly configured (see TRUST_PROXY in env.js) —
// required for correct per-IP rate limiting behind a reverse proxy, unsafe without one.
if (config.trustProxy !== false) {
  app.set('trust proxy', config.trustProxy);
}

// Security and utility middleware
// Content-Security-Policy. The session token lives in localStorage, so any injected script
// could lift it — the CSP is the backstop: no inline or third-party script except Google's
// Cast SDK (loaded on demand, Chromium only), and images only from ourselves plus the
// metadata providers whose cover art the editor previews.
//   - style 'unsafe-inline': Vue style bindings, the admin's custom CSS and EPUB styling
//   - blob:/data: — hls.js MediaSource URLs, epub.js resource URLs, placeholder covers
//   - no upgrade-insecure-requests: most installs are reached over plain HTTP on a LAN,
//     where it would rewrite every same-origin request to https and break the app
// Set CSP=off to disable (e.g. while diagnosing a blocked resource), or CSP=report-only.
const cspMode = (process.env.CSP || 'on').toLowerCase();
const COVER_PROVIDER_HOSTS = [
  'uploads.mangadex.org', 'books.google.com', 'books.googleusercontent.com',
  'covers.openlibrary.org', '*.archive.org', 'image.tmdb.org'
];
const contentSecurityPolicy = cspMode === 'off' ? false : {
  useDefaults: false,
  reportOnly: cspMode === 'report-only',
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", 'https://www.gstatic.com'],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'blob:', ...COVER_PROVIDER_HOSTS],
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

app.use(helmet({
  contentSecurityPolicy,
  crossOriginEmbedderPolicy: false
}));
// `credentials: true` only matters for cookie-based auth; Plinthio authenticates via a
// Bearer JWT (header or query param) that the app puts in localStorage itself, never a
// cookie, so there's nothing for a browser to attach automatically. Combined with a
// wildcard origin, `credentials: true` is also something browsers just reject outright for
// an actual cross-origin credentialed request — it was a no-op, not a real permission.
app.use(cors({ origin: config.corsOrigin }));

// JSON responses compress extremely well (a 1000-item shelf page measured 386KB raw vs
// 29KB gzipped) and that ratio is what a phone or a remote connection actually feels.
// Media, covers and thumbnails are already-compressed binary formats where gzip burns CPU
// for nothing, so they opt out — as does any response explicitly marked no-transform.
app.use(compression({
  threshold: 1024,
  filter: (req, res) => {
    const type = res.getHeader('Content-Type') || '';
    if (typeof type === 'string' && /^(image|video|audio)\//.test(type)) return false;
    return compression.filter(req, res);
  }
}));

app.use(express.json());

// Media URLs authenticate via a `?token=<JWT>` query param (needed for <img>/<video> src,
// which can't send an Authorization header) — redact it so a live session token never
// ends up sitting in plaintext in the access log.
morgan.token('url', (req) => (req.originalUrl || req.url).replace(/([?&]token=)[^&]+/i, '$1[REDACTED]'));
app.use(morgan('dev'));

// High-throughput media streaming and thumbnail routes are exempt from the strict JSON API
// rate limit below (a reader/player firing off many small range/page requests per second is
// normal use, not abuse) but still need *some* ceiling — otherwise nothing stops a single
// authenticated client from hammering thumbnail generation or video byte-range requests.
const mediaLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1200, // generous — normal seeking/page-turning is well under this
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/media/video', mediaLimiter, videoRoutes);
app.use('/api/media', mediaLimiter, mediaRoutes);

// Rate limiters for security hardening
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 60, // 60 requests per 15 min for auth/login attempts
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Please try again later.' }
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 600, // 600 requests per minute
  standardHeaders: true,
  legacyHeaders: false
});

// Tighter limit specifically on password guessing, on top of the general auth limiter
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 login attempts per 15 min per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please wait before trying again.' }
});

// Full backups (VACUUM INTO a whole-DB snapshot) are comparatively expensive disk/IO work —
// an admin token being replayed shouldn't be able to trigger them back-to-back.
const backupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 6, // 6 backup operations per 15 min is generous for manual + scheduled use
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many backup requests. Please wait before trying again.' }
});

// API Routes
app.use('/api/', apiLimiter);
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/settings/backup', backupLimiter);
app.use('/api/libraries', libraryRoutes);
app.use('/api/items', itemRoutes);
app.use('/api/progress', progressRoutes);
app.use('/api/users', userRoutes);
app.use('/api/admin/logs', logRoutes);
app.use('/api/admin/health', healthRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/stats', statRoutes);
app.use('/api/keys', apiKeyRoutes);
app.use('/api/collections', collectionRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/bookmarks', bookmarkRoutes);
app.use('/api/settings', settingRoutes);
app.use('/api/metadata', metadataRoutes);
app.use('/api/customization', customizationRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/series', seriesRoutes);
// OPDS readers poll the catalog and fetch pages one at a time, so it sits under the media
// limiter rather than the tighter JSON API one.
app.use('/api/opds', mediaLimiter, opdsRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', version: APP_VERSION, app: 'Plinthio' });
});

// Serve frontend build if present
const frontendDist = path.resolve(__dirname, '../../frontend/dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  // Body-parser rejects (malformed JSON, oversized body) are the client's fault and safe to
  // describe; anything else stays in the server log.
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
    return res.status(err.status || 400).json({ error: err.message });
  }
  res.status(500).json({ error: 'Internal Server Error' });
});

// Bootstrap server
async function start() {
  try {
    // Snapshot the database before a new version's migrations touch it (no-op when the
    // version hasn't changed or on a fresh install).
    const upgrade = await backupBeforeUpgrade();

    await getDb(); // Ensure database and tables are ready
    recordRunningVersion();
    if (upgrade) {
      console.log(`[upgrade] Now running Plinthio ${APP_VERSION}.`);
    }

    // Admins get a dismissible banner when a newer release is published (UPDATE_CHECK=false
    // turns the outbound check off entirely).
    initUpdateCheck();

    // Pre-warm WebP thumbnail cache in background
    warmThumbnailCache().catch(e => console.warn('Thumbnail warming warning:', e.message));

    // Periodically snapshot the database per the admin-configured backup schedule
    initBackupScheduler();

    // Pick up new media on its own: a periodic re-scan plus (where the filesystem supports
    // it) a watcher, both configurable under Admin → Server Settings.
    initAutoScan();

    // Evict stale on-disk HLS segment caches (see HLS_CACHE_MAX_AGE_HOURS) — run once at
    // boot and then hourly, mirroring the backup scheduler's own setInterval pattern.
    // Evict stale on-disk media caches (see HLS_CACHE_MAX_AGE_HOURS): HLS segments, and the
    // 7z archives that have to be unpacked to disk to be read page by page.
    const cacheMaxAgeMs = config.hlsCacheMaxAgeHours * 60 * 60 * 1000;
    const sweepCaches = () => {
      sweepHlsCache(cacheMaxAgeMs);
      sweepArchiveCache(cacheMaxAgeMs);
    };
    sweepCaches();
    setInterval(sweepCaches, 60 * 60 * 1000).unref();

    app.listen(config.port, config.host, () => {
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
  } catch (err) {
    console.error('Failed to start Plinthio:', err);
    process.exit(1);
  }
}

start();
