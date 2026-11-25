import express from 'express';
import { getDb } from '../config/database.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { logger } from '../services/logger.js';
import { handle } from '../utils/http.js';
import { getRatingSettings, saveRatingSettings } from '../services/ratings.js';
import { getShowMissingFilms, saveShowMissingFilms } from '../services/collections.js';
import { isPartyModeEnabled, savePartyModeEnabled } from './party.js';
import { endAllParties } from '../services/party.js';
import { isLiveTvEnabled, saveLiveTvEnabled } from '../services/liveTv.js';
import multer from 'multer';
import { getIntroSettings, saveIntroSettings, installIntro, removeIntro, INTRO_MAX_BYTES } from '../services/intro.js';
import { getSetting, setSetting } from '../services/settings.js';

const router = express.Router();

// What the video player shows while paused (components/VideoPlayer.vue).
const PAUSE_SCREENS = ['simple', 'details', 'cinematic', 'bedtime'];
const DEFAULT_PAUSE_SCREEN = 'details';

const PAGE_WIDTHS = ['full', 'contained'];
const DEFAULT_PAGE_WIDTH = 'full';

// Default language (frontend/src/i18n LANGUAGES). 'auto' follows the browser; a user's own
// choice always wins.
const LANGUAGES = ['auto', 'en', 'de', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'ja', 'ko', 'zh'];
const DEFAULT_LANGUAGE = 'auto';

// Whether subtitles are switched on when a video starts, and in which language. 'auto' is
// each person's own language. The server's default; a person's own choice always wins
// (preferences.subtitles). Codes are ISO 639-1, as in frontend/src/utils/languages.js.
const SUBTITLE_LANGUAGES = ['auto', 'en', 'de', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'ja', 'ko', 'zh',
  'ar', 'cs', 'da', 'el', 'fi', 'he', 'hi', 'hu', 'id', 'no', 'ro', 'ru', 'sv', 'th', 'tr', 'uk', 'vi'];
const DEFAULT_SUBTITLES = { on: false, language: 'auto' };

function parseSubtitles(raw) {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return {
        on: parsed.on === true,
        language: SUBTITLE_LANGUAGES.includes(parsed.language) ? parsed.language : DEFAULT_SUBTITLES.language
      };
    }
  } catch (e) {
    // Malformed stored JSON: use defaults
  }
  return { ...DEFAULT_SUBTITLES };
}

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
    // Malformed stored JSON: use defaults
  }
  return { ...DEFAULT_USER_CUSTOMIZATION };
}

// Public: the login screen needs branding before auth.
router.get('/', async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.all(`
      SELECT key, value FROM settings
      WHERE key IN ('server_name', 'custom_css', 'accent_theme', 'login_message', 'layout_mode', 'pause_screen', 'page_width', 'default_language', 'user_customization', 'subtitles_default')
    `);

    const config = {
      serverName: 'Plinthio',
      customCss: '',
      accentTheme: 'zinc',
      loginMessage: '',
      layoutMode: 'topnav',
      pauseScreen: DEFAULT_PAUSE_SCREEN,
      pageWidth: DEFAULT_PAGE_WIDTH,
      defaultLanguage: DEFAULT_LANGUAGE,
      userCustomization: { ...DEFAULT_USER_CUSTOMIZATION },
      subtitles: { ...DEFAULT_SUBTITLES }
    };

    for (const row of rows) {
      if (row.key === 'server_name') config.serverName = row.value;
      if (row.key === 'custom_css') config.customCss = row.value;
      if (row.key === 'accent_theme') config.accentTheme = row.value;
      if (row.key === 'login_message') config.loginMessage = row.value;
      if (row.key === 'layout_mode') config.layoutMode = row.value;
      if (row.key === 'pause_screen' && PAUSE_SCREENS.includes(row.value)) config.pauseScreen = row.value;
      if (row.key === 'page_width' && PAGE_WIDTHS.includes(row.value)) config.pageWidth = row.value;
      if (row.key === 'default_language' && LANGUAGES.includes(row.value)) config.defaultLanguage = row.value;
      if (row.key === 'user_customization') config.userCustomization = parseUserCustomization(row.value);
      if (row.key === 'subtitles_default') config.subtitles = parseSubtitles(row.value);
    }

    config.ratings = await getRatingSettings(db);
    // Whether a movie collection also shows the films the library doesn't have.
    config.showMissingFilms = await getShowMissingFilms(db);
    config.partyModeEnabled = await isPartyModeEnabled(db);
    config.liveTvEnabled = await isLiveTvEnabled(db);
    // The opening sequence played before movies and episodes.
    Object.assign(config, await getIntroSettings(db));

    res.json(config);
  } catch (err) {
    // Public route, so the raw error stays server-side.
    console.error('[customization] load failed:', err);
    res.status(500).json({ error: 'Could not load server customization' });
  }
});

router.patch('/', authenticateToken, requireAdmin, handle(async (req, res) => {
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
    liveTvEnabled,
    pauseScreen,
    defaultLanguage,
    subtitles,
    introEnabled,
    introMovies,
    introShows
  } = req.body;

  const db = await getDb();

  if (serverName !== undefined) {
    await setSetting(db, 'server_name', String(serverName).trim() || 'Plinthio');
  }

  if (customCss !== undefined) {
    // Admin-only, and the frontend injects it via textContent (never parsed as HTML). Any
    // HTML-parsing consumer (v-html) would need real sanitization first.
    await setSetting(db, 'custom_css', String(customCss));
  }

  if (accentTheme !== undefined) {
    const allowedThemes = ['zinc', 'slate', 'red', 'orange', 'amber', 'lime', 'emerald', 'teal', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose'];
    const theme = allowedThemes.includes(accentTheme) ? accentTheme : 'zinc';
    await setSetting(db, 'accent_theme', theme);
  }

  if (loginMessage !== undefined) {
    await setSetting(db, 'login_message', String(loginMessage).trim());
  }

  if (layoutMode !== undefined) {
    const allowedLayouts = ['topnav', 'sidebar'];
    const layout = allowedLayouts.includes(layoutMode) ? layoutMode : 'topnav';
    await setSetting(db, 'layout_mode', layout);
  }

  if (pageWidth !== undefined) {
    if (!PAGE_WIDTHS.includes(pageWidth)) {
      return res.status(400).json({ error: `pageWidth must be one of ${PAGE_WIDTHS.join(', ')}` });
    }
    await setSetting(db, 'page_width', pageWidth);
  }

  if (pauseScreen !== undefined) {
    if (!PAUSE_SCREENS.includes(pauseScreen)) {
      return res.status(400).json({ error: `pauseScreen must be one of ${PAUSE_SCREENS.join(', ')}` });
    }
    await setSetting(db, 'pause_screen', pauseScreen);
  }

  if (defaultLanguage !== undefined) {
    if (!LANGUAGES.includes(defaultLanguage)) {
      return res.status(400).json({ error: `defaultLanguage must be one of ${LANGUAGES.join(', ')}` });
    }
    await setSetting(db, 'default_language', defaultLanguage);
  }

  if (subtitles !== undefined) {
    if (!subtitles || typeof subtitles !== 'object' || Array.isArray(subtitles)) {
      return res.status(400).json({ error: 'subtitles must be an object' });
    }
    if (subtitles.on !== undefined && typeof subtitles.on !== 'boolean') {
      return res.status(400).json({ error: 'subtitles.on must be true or false' });
    }
    if (subtitles.language !== undefined && !SUBTITLE_LANGUAGES.includes(subtitles.language)) {
      return res.status(400).json({ error: `subtitles.language must be one of ${SUBTITLE_LANGUAGES.join(', ')}` });
    }
    const current = parseSubtitles(await getSetting(db, 'subtitles_default'));
    await setSetting(db, 'subtitles_default', JSON.stringify({
      on: subtitles.on !== undefined ? subtitles.on : current.on,
      language: subtitles.language !== undefined ? subtitles.language : current.language
    }));
  }

  if (userCustomization !== undefined) {
    if (!userCustomization || typeof userCustomization !== 'object' || Array.isArray(userCustomization)) {
      return res.status(400).json({ error: 'userCustomization must be an object' });
    }
    const current = parseUserCustomization(await getSetting(db, 'user_customization'));
    const updated = {
      enabled: userCustomization.enabled !== undefined ? !!userCustomization.enabled : current.enabled,
      accentColor: userCustomization.accentColor !== undefined ? !!userCustomization.accentColor : current.accentColor,
      layoutMode: userCustomization.layoutMode !== undefined ? !!userCustomization.layoutMode : current.layoutMode,
      pageWidth: userCustomization.pageWidth !== undefined ? !!userCustomization.pageWidth : current.pageWidth,
      pauseScreen: userCustomization.pauseScreen !== undefined ? !!userCustomization.pauseScreen : current.pauseScreen
    };
    await setSetting(db, 'user_customization', JSON.stringify(updated));
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

  if (typeof liveTvEnabled === 'boolean') {
    await saveLiveTvEnabled(db, liveTvEnabled);
  }

  await saveIntroSettings(db, { introEnabled, introMovies, introShows });

  logger.info('system', `Customization updated by admin ${req.user.username}`);

  const rows = await db.all(`
      SELECT key, value FROM settings
      WHERE key IN ('server_name', 'custom_css', 'accent_theme', 'login_message', 'layout_mode', 'pause_screen', 'page_width', 'default_language', 'user_customization', 'subtitles_default')
    `);

  const result = {
    serverName: 'Plinthio',
    customCss: '',
    accentTheme: 'zinc',
    loginMessage: '',
    layoutMode: 'topnav',
    pauseScreen: DEFAULT_PAUSE_SCREEN,
    pageWidth: DEFAULT_PAGE_WIDTH,
    defaultLanguage: DEFAULT_LANGUAGE,
    userCustomization: { ...DEFAULT_USER_CUSTOMIZATION },
    subtitles: { ...DEFAULT_SUBTITLES }
  };

  for (const row of rows) {
    if (row.key === 'server_name') result.serverName = row.value;
    if (row.key === 'custom_css') result.customCss = row.value;
    if (row.key === 'accent_theme') result.accentTheme = row.value;
    if (row.key === 'login_message') result.loginMessage = row.value;
    if (row.key === 'layout_mode') result.layoutMode = row.value;
    if (row.key === 'pause_screen' && PAUSE_SCREENS.includes(row.value)) result.pauseScreen = row.value;
    if (row.key === 'page_width' && PAGE_WIDTHS.includes(row.value)) result.pageWidth = row.value;
    if (row.key === 'default_language' && LANGUAGES.includes(row.value)) result.defaultLanguage = row.value;
    if (row.key === 'user_customization') result.userCustomization = parseUserCustomization(row.value);
    if (row.key === 'subtitles_default') result.subtitles = parseSubtitles(row.value);
  }
  result.ratings = await getRatingSettings(db);
  result.showMissingFilms = await getShowMissingFilms(db);
  result.partyModeEnabled = await isPartyModeEnabled(db);
  result.liveTvEnabled = await isLiveTvEnabled(db);
  Object.assign(result, await getIntroSettings(db));

  res.json({ message: 'Customization updated successfully', ...result });
}));

// Opening sequence upload (multipart, field "intro").
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

// Back to the built-in clip.
router.delete('/intro', authenticateToken, requireAdmin, handle(async (req, res) => {
  const db = await getDb();
  await removeIntro();
  logger.info('system', `Opening sequence removed by admin ${req.user.username}`);
  res.json(await getIntroSettings(db));
}));

export default router;
