import express from 'express';
import { getDb } from '../config/database.js';
import { config } from '../config/env.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { handle } from '../utils/http.js';
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
    // untrustedProxy: this device shows as outside because it came through a reverse proxy
    // that TRUST_PROXY doesn't cover, not because of its address.
    thisDevice: { where: loc.where, away: loc.away, ip: loc.ip, untrustedProxy: loc.untrustedProxy },
    trustProxy: config.trustProxy !== false,
    // Requests arrived through a reverse proxy that TRUST_PROXY doesn't cover (it's unset, or
    // names another address). Plinthio can't tell those visitors apart, so every one of them
    // counts as outside, whoever they are, until TRUST_PROXY is set to the proxy's address.
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

router.get('/', handle(async (req, res) => {
  res.json(await report(req, await getDb()));
}));

router.patch('/', handle(async (req, res) => {
  const { remoteAccess, tailscaleIsHome, require2faOutside } = req.body || {};
  for (const [name, value] of Object.entries({ remoteAccess, tailscaleIsHome, require2faOutside })) {
    if (value !== undefined && typeof value !== 'boolean') return res.status(400).json({ error: `${name} must be true or false` });
  }
  const db = await getDb();
  // Don't let an admin shut themselves out: turning outside access off (or making
  // Tailscale count as outside) from a device that would then be outside.
  const loc = await requestLocation(req);
  const after = { ...loc.settings, ...Object.fromEntries(Object.entries({ remoteAccess, tailscaleIsHome }).filter(([, v]) => v !== undefined)) };
  const wouldBeAway = loc.where === 'outside' || (loc.where === 'tailscale' && !after.tailscaleIsHome);
  if (wouldBeAway && !after.remoteAccess) {
    return res.status(400).json({ error: "That would lock out the device you're using right now. Change it from your home network." });
  }
  // The same for two-factor away from home, which applies to sessions already signed in:
  // switching it on from outside, on an account without two-factor, would end this session
  // on its next request.
  if (require2faOutside === true && !loc.settings.require2faOutside && wouldBeAway && !req.user.two_factor && !req.isApiKey) {
    return res.status(400).json({ error: "You're away from home and your account has no two-factor, so that would lock out the device you're using right now. Turn on two-factor for your account first, or change it from your home network." });
  }
  await saveNetworkSettings(db, { remoteAccess, tailscaleIsHome, require2faOutside });
  logger.info('system', `Network access settings changed by ${req.user.username}`, { remoteAccess, tailscaleIsHome, require2faOutside });
  res.json(await report(req, db));
}));

export default router;
