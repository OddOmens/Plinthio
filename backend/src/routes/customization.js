import express from 'express';
import { getDb } from '../config/database.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { logger } from '../services/logger.js';
import { serverError } from '../utils/http.js';
import { getRatingSettings, saveRatingSettings } from '../services/ratings.js';

const router = express.Router();

// GET /api/customization (Public - needed for login screen and dynamic UI theming)
router.get('/', async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.all(`
      SELECT key, value FROM settings
      WHERE key IN ('server_name', 'custom_css', 'accent_theme', 'login_message', 'layout_mode')
    `);

    const config = {
      serverName: 'Plinthio',
      customCss: '',
      accentTheme: 'zinc',
      loginMessage: '',
      layoutMode: 'topnav'
    };

    for (const row of rows) {
      if (row.key === 'server_name') config.serverName = row.value;
      if (row.key === 'custom_css') config.customCss = row.value;
      if (row.key === 'accent_theme') config.accentTheme = row.value;
      if (row.key === 'login_message') config.loginMessage = row.value;
      if (row.key === 'layout_mode') config.layoutMode = row.value;
    }

    // Which parts of the rating UI are shown (personal stars, server average, TMDB score).
    config.ratings = await getRatingSettings(db);

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
  const { serverName, customCss, accentTheme, loginMessage, layoutMode, ratings } = req.body;

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

    if (ratings && typeof ratings === 'object') {
      await saveRatingSettings(db, ratings);
    }

    logger.info('system', `Customization updated by admin ${req.user.username}`);

    const rows = await db.all(`
      SELECT key, value FROM settings
      WHERE key IN ('server_name', 'custom_css', 'accent_theme', 'login_message', 'layout_mode')
    `);

    const result = {
      serverName: 'Plinthio',
      customCss: '',
      accentTheme: 'zinc',
      loginMessage: '',
      layoutMode: 'topnav'
    };

    for (const row of rows) {
      if (row.key === 'server_name') result.serverName = row.value;
      if (row.key === 'custom_css') result.customCss = row.value;
      if (row.key === 'accent_theme') result.accentTheme = row.value;
      if (row.key === 'login_message') result.loginMessage = row.value;
      if (row.key === 'layout_mode') result.layoutMode = row.value;
    }
    result.ratings = await getRatingSettings(db);

    res.json({ message: 'Customization updated successfully', ...result });
  } catch (err) {
    serverError(req, res, err);
  }
});

export default router;
