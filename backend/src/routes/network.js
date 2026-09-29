import express from 'express';
import { getDb } from '../config/database.js';
import { config } from '../config/env.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { serverError } from '../utils/http.js';
import { logger } from '../services/logger.js';
import { getNetworkSettings, saveNetworkSettings, requestLocation, proxyWarning, tailscaleStatus } from '../services/network.js';

// Admin → Network: who can reach the server from where, and a way to check it's working.
const router = express.Router();
router.use(authenticateToken, requireAdmin);

async function report(req, db) {
  const settings = await getNetworkSettings(db);
  const loc = await requestLocation(req);
  const recentOutside = await db.all(`
    SELECT username, success, ip_address, created_at FROM login_history
    WHERE network = 'outside' ORDER BY created_at DESC LIMIT 20
  `);
  const accounts = await db.all('SELECT remote_access, totp_enabled_at, role FROM users');
  return {
    settings: {
      remoteAccess: settings.remoteAccess,
      tailscaleIsHome: settings.tailscaleIsHome,
      require2faOutside: settings.require2faOutside
    },
    // Where the device looking at this page is connecting from: open it on a phone on mobile
    // data to check outside access does what you expect.
    thisDevice: { where: loc.where, away: loc.away, ip: loc.ip },
    trustProxy: config.trustProxy !== false,
    // Requests arrived with X-Forwarded-For but TRUST_PROXY isn't set: everyone looks like
    // the proxy, so outside controls can't tell anyone apart.
    proxyWithoutTrust: proxyWarning(),
    accounts: {
      total: accounts.length,
      homeOnly: accounts.filter((a) => a.remote_access === 0).length,
      withTwoFactor: accounts.filter((a) => a.totp_enabled_at).length,
      adminsWithoutTwoFactor: accounts.filter((a) => a.role === 'admin' && !a.totp_enabled_at).length
    },
    recentOutsideSignIns: recentOutside,
    // Whether Tailscale and Funnel are seen reaching Plinthio (services/network.js).
    tailscale: await tailscaleStatus(db)
  };
}

router.get('/', async (req, res) => {
  try {
    res.json(await report(req, await getDb()));
  } catch (err) {
    serverError(req, res, err);
  }
});

router.patch('/', async (req, res) => {
  const { remoteAccess, tailscaleIsHome, require2faOutside } = req.body || {};
  for (const [name, value] of Object.entries({ remoteAccess, tailscaleIsHome, require2faOutside })) {
    if (value !== undefined && typeof value !== 'boolean') return res.status(400).json({ error: `${name} must be true or false` });
  }
  try {
    const db = await getDb();
    // Don't let an admin shut themselves out: turning outside access off (or making
    // Tailscale count as outside) from a device that would then be outside.
    const loc = await requestLocation(req);
    const after = { ...loc.settings, ...Object.fromEntries(Object.entries({ remoteAccess, tailscaleIsHome }).filter(([, v]) => v !== undefined)) };
    const wouldBeAway = loc.where === 'outside' || (loc.where === 'tailscale' && !after.tailscaleIsHome);
    if (wouldBeAway && !after.remoteAccess) {
      return res.status(400).json({ error: "That would lock out the device you're using right now. Change it from your home network." });
    }
    await saveNetworkSettings(db, { remoteAccess, tailscaleIsHome, require2faOutside });
    logger.info('system', `Network access settings changed by ${req.user.username}`, { remoteAccess, tailscaleIsHome, require2faOutside });
    res.json(await report(req, db));
  } catch (err) {
    serverError(req, res, err);
  }
});

export default router;
