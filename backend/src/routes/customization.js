import express from 'express';
import { getDb } from '../config/database.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { logger } from '../services/logger.js';
import { serverError } from '../utils/http.js';
import { getRatingSettings, saveRatingSettings } from '../services/ratings.js';
import { getShowMissingFilms, saveShowMissingFilms } from '../services/collections.js';
import { isPartyModeEnabled, savePartyModeEnabled } from './party.js';
import { endAllParties } from '../services/party.js';
import multer from 'multer';
import { getIntroSettings, saveIntroSettings, installIntro, removeIntro, INTRO_MAX_BYTES } from '../services/intro.js';

const router = express.Router();

// What the video player shows while paused (components/VideoPlayer.vue): nothing but the
// controls, the title's details, a full-screen cinematic card, or a dim bedtime clock.
const PAUSE_SCREENS = ['simple', 'details', 'cinematic', 'bedtime'];
const DEFAULT_PAUSE_SCREEN = 'details';

const PAGE_WIDTHS = ['full', 'contained'];
const DEFAULT_PAGE_WIDTH = 'full';

const DEFAULT_USER_CUSTOMIZATION = {
  enabled: true,
  accentColor: true,
  layoutMode: true,
  pageWidth: true,
  pauseScreen: true
};

function parseUserCustomization(raw) {
  if (!raw) return { ...DEFAULT_USER_CUSTOMIZATION };
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return {
        enabled: parsed.enabled !== false,
        accentColor: parsed.accentColor !== false,
        layoutMode: parsed.layoutMode !== false,
        pageWidth: parsed.pageWidth !== false,
        pauseScreen: parsed.pauseScreen !== false
      };
    }
  } catch (e) {
    // Malformed stored JSON — fall back to defaults
  }
  return { ...DEFAULT_USER_CUSTOMIZATION };
}

// GET /api/customization (Public - needed for login screen and dynamic UI theming)
router.get('/', async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.all(`
      SELECT key, value FROM settings
      WHERE key IN ('server_name', 'custom_css', 'accent_theme', 'login_message', 'layout_mode', 'pause_screen', 'page_width', 'user_customization')
    `);

    const config = {
      serverName: 'Plinthio',
      customCss: '',
      accentTheme: 'zinc',
      loginMessage: '',
      layoutMode: 'topnav',
      pauseScreen: DEFAULT_PAUSE_SCREEN,
      pageWidth: DEFAULT_PAGE_WIDTH,
      userCustomization: { ...DEFAULT_USER_CUSTOMIZATION }
    };

    for (const row of rows) {
      if (row.key === 'server_name') config.serverName = row.value;
      if (row.key === 'custom_css') config.customCss = row.value;
      if (row.key === 'accent_theme') config.accentTheme = row.value;
      if (row.key === 'login_message') config.loginMessage = row.value;
      if (row.key === 'layout_mode') config.layoutMode = row.value;
      if (row.key === 'pause_screen' && PAUSE_SCREENS.includes(row.value)) config.pauseScreen = row.value;
      if (row.key === 'page_width' && PAGE_WIDTHS.includes(row.value)) config.pageWidth = row.value;
      if (row.key === 'user_customization') config.userCustomization = parseUserCustomization(row.value);
    }

    // Which parts of the rating UI are shown (personal stars, server average, TMDB score).
    config.ratings = await getRatingSettings(db);
    // Whether a movie collection also shows the films the library doesn't have.
    config.showMissingFilms = await getShowMissingFilms(db);
    // Watch parties — off unless an admin turns them on.
    config.partyModeEnabled = await isPartyModeEnabled(db);
    // The opening sequence played before movies and episodes.
    Object.assign(config, await getIntroSettings(db));

    res.json(config);
  } catch (err) {
    // This route is intentionally public (the login screen needs branding before auth),
    // so keep the raw error server-side rather than returning it to any anonymous caller.
    console.error('[customization] load failed:', err);
    res.status(500).json({ error: 'Could not load server customization' });
  }
});

// PATCH /api/customization (Admin only)
router.patch('/', authenticateToken, requireAdmin, async (req, res) => {
  const {
    serverName,
    customCss,
    accentTheme,
    loginMessage,
    layoutMode,
    pageWidth,
    userCustomization,
    ratings,
    showMissingFilms,
    partyModeEnabled,
    pauseScreen,
    introEnabled,
    introMovies,
    introShows
  } = req.body;

  try {
    const db = await getDb();

    if (serverName !== undefined) {
      await db.run(
        `INSERT INTO settings (key, value, updated_at) VALUES ('server_name', ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
        [String(serverName).trim() || 'Plinthio']
      );
    }

    if (customCss !== undefined) {
      // This is admin-only (requireAdmin above) and the actual safety boundary is on the
      // frontend, which injects this as `styleTag.textContent = customCss` — plain CSS
      // text, never parsed as HTML/JS, so no client-side sink here to sanitize against. Do
      // not add a `v-html` (or similarly HTML-parsing) consumer of this value without
      // reintroducing real sanitization first.
      await db.run(
        `INSERT INTO settings (key, value, updated_at) VALUES ('custom_css', ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
        [String(customCss)]
      );
    }

    if (accentTheme !== undefined) {
      const allowedThemes = ['zinc', 'slate', 'emerald', 'violet', 'rose', 'amber', 'sky', 'indigo'];
      const theme = allowedThemes.includes(accentTheme) ? accentTheme : 'zinc';
      await db.run(
        `INSERT INTO settings (key, value, updated_at) VALUES ('accent_theme', ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
        [theme]
      );
    }

    if (loginMessage !== undefined) {
      await db.run(
        `INSERT INTO settings (key, value, updated_at) VALUES ('login_message', ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
        [String(loginMessage).trim()]
      );
    }

    if (layoutMode !== undefined) {
      const allowedLayouts = ['topnav', 'sidebar'];
      const layout = allowedLayouts.includes(layoutMode) ? layoutMode : 'topnav';
      await db.run(
        `INSERT INTO settings (key, value, updated_at) VALUES ('layout_mode', ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
        [layout]
      );
    }

    if (pageWidth !== undefined) {
      if (!PAGE_WIDTHS.includes(pageWidth)) {
        return res.status(400).json({ error: `pageWidth must be one of ${PAGE_WIDTHS.join(', ')}` });
      }
      await db.run(
        `INSERT INTO settings (key, value, updated_at) VALUES ('page_width', ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
        [pageWidth]
      );
    }

    if (pauseScreen !== undefined) {
      if (!PAUSE_SCREENS.includes(pauseScreen)) {
        return res.status(400).json({ error: `pauseScreen must be one of ${PAUSE_SCREENS.join(', ')}` });
      }
      await db.run(
        `INSERT INTO settings (key, value, updated_at) VALUES ('pause_screen', ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
        [pauseScreen]
      );
    }

    if (userCustomization !== undefined) {
      if (!userCustomization || typeof userCustomization !== 'object' || Array.isArray(userCustomization)) {
        return res.status(400).json({ error: 'userCustomization must be an object' });
      }
      const currentRow = await db.get("SELECT value FROM settings WHERE key = 'user_customization'");
      const current = parseUserCustomization(currentRow?.value);
      const updated = {
        enabled: userCustomization.enabled !== undefined ? !!userCustomization.enabled : current.enabled,
        accentColor: userCustomization.accentColor !== undefined ? !!userCustomization.accentColor : current.accentColor,
        layoutMode: userCustomization.layoutMode !== undefined ? !!userCustomization.layoutMode : current.layoutMode,
        pageWidth: userCustomization.pageWidth !== undefined ? !!userCustomization.pageWidth : current.pageWidth,
        pauseScreen: userCustomization.pauseScreen !== undefined ? !!userCustomization.pauseScreen : current.pauseScreen
      };
      await db.run(
        `INSERT INTO settings (key, value, updated_at) VALUES ('user_customization', ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
        [JSON.stringify(updated)]
      );
    }

    if (ratings && typeof ratings === 'object') {
      await saveRatingSettings(db, ratings);
    }

    if (typeof showMissingFilms === 'boolean') {
      await saveShowMissingFilms(db, showMissingFilms);
    }

    if (typeof partyModeEnabled === 'boolean') {
      await savePartyModeEnabled(db, partyModeEnabled);
      if (!partyModeEnabled) endAllParties();
    }

    await saveIntroSettings(db, { introEnabled, introMovies, introShows });

    logger.info('system', `Customization updated by admin ${req.user.username}`);

    const rows = await db.all(`
      SELECT key, value FROM settings
      WHERE key IN ('server_name', 'custom_css', 'accent_theme', 'login_message', 'layout_mode', 'pause_screen', 'page_width', 'user_customization')
    `);

    const result = {
      serverName: 'Plinthio',
      customCss: '',
      accentTheme: 'zinc',
      loginMessage: '',
      layoutMode: 'topnav',
      pauseScreen: DEFAULT_PAUSE_SCREEN,
      pageWidth: DEFAULT_PAGE_WIDTH,
      userCustomization: { ...DEFAULT_USER_CUSTOMIZATION }
    };

    for (const row of rows) {
      if (row.key === 'server_name') result.serverName = row.value;
      if (row.key === 'custom_css') result.customCss = row.value;
      if (row.key === 'accent_theme') result.accentTheme = row.value;
      if (row.key === 'login_message') result.loginMessage = row.value;
      if (row.key === 'layout_mode') result.layoutMode = row.value;
      if (row.key === 'pause_screen' && PAUSE_SCREENS.includes(row.value)) result.pauseScreen = row.value;
      if (row.key === 'page_width' && PAGE_WIDTHS.includes(row.value)) result.pageWidth = row.value;
      if (row.key === 'user_customization') result.userCustomization = parseUserCustomization(row.value);
    }
    result.ratings = await getRatingSettings(db);
    result.showMissingFilms = await getShowMissingFilms(db);
    result.partyModeEnabled = await isPartyModeEnabled(db);
    Object.assign(result, await getIntroSettings(db));

    res.json({ message: 'Customization updated successfully', ...result });
  } catch (err) {
    serverError(req, res, err);
  }
});

// ─── Opening sequence ────────────────────────────────────────────────────────
// POST /api/customization/intro (Admin): upload or replace the clip. multipart, field "intro".
const introUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: INTRO_MAX_BYTES, files: 1 } });

router.post('/intro', authenticateToken, requireAdmin, (req, res) => {
  introUpload.single('intro')(req, res, async (err) => {
    if (err) {
      const tooBig = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE';
      return res.status(tooBig ? 413 : 400).json({
        error: tooBig ? `The opening sequence must be smaller than ${INTRO_MAX_BYTES / 1024 / 1024} MB` : 'Upload failed'
      });
    }
    if (!req.file) return res.status(400).json({ error: 'Choose an MP4 file to upload' });
    try {
      const db = await getDb();
      await installIntro(db, req.file.buffer);
      logger.info('system', `Opening sequence uploaded by admin ${req.user.username}`);
      res.json(await getIntroSettings(db));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
});

// DELETE /api/customization/intro (Admin): remove the uploaded clip, back to the built-in one.
router.delete('/intro', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    await removeIntro();
    logger.info('system', `Opening sequence removed by admin ${req.user.username}`);
    res.json(await getIntroSettings(db));
  } catch (err) {
    serverError(req, res, err);
  }
});

export default router;
