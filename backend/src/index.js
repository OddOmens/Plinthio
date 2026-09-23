import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { config } from './config/env.js';
import { getDb } from './config/database.js';

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
import { warmThumbnailCache } from './services/thumbnails.js';
import { initBackupScheduler } from './services/backup.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Only honour X-Forwarded-For when explicitly configured (see TRUST_PROXY in env.js) —
// required for correct per-IP rate limiting behind a reverse proxy, unsafe without one.
if (config.trustProxy !== false) {
  app.set('trust proxy', config.trustProxy);
}

// Security and utility middleware
app.use(helmet({
  contentSecurityPolicy: false, // Allow streaming media & blob URLs in PWA
  crossOriginEmbedderPolicy: false
}));
// `credentials: true` only matters for cookie-based auth; Plinthio authenticates via a
// Bearer JWT (header or query param) that the app puts in localStorage itself, never a
// cookie, so there's nothing for a browser to attach automatically. Combined with a
// wildcard origin, `credentials: true` is also something browsers just reject outright for
// an actual cross-origin credentialed request — it was a no-op, not a real permission.
app.use(cors({ origin: config.corsOrigin }));
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
app.use('/api/stats', statRoutes);
app.use('/api/keys', apiKeyRoutes);
app.use('/api/collections', collectionRoutes);
app.use('/api/bookmarks', bookmarkRoutes);
app.use('/api/settings', settingRoutes);
app.use('/api/metadata', metadataRoutes);
app.use('/api/customization', customizationRoutes);
app.use('/api/activity', activityRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', version: '0.2.0', app: 'Plinthio' });
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
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

// Bootstrap server
async function start() {
  try {
    await getDb(); // Ensure database and tables are ready

    // Pre-warm WebP thumbnail cache in background
    warmThumbnailCache().catch(e => console.warn('Thumbnail warming warning:', e.message));

    // Periodically snapshot the database per the admin-configured backup schedule
    initBackupScheduler();

    app.listen(config.port, config.host, () => {
      console.log(`
=====================================================
  📚 Plinthio Media Server v0.2.0 is Running!
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
