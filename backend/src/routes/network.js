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
    // Where this device connects from (open it on mobile data to test outside access).
    // untrustedProxy: outside only because it came through a proxy TRUST_PROXY doesn't cover.
    thisDevice: { where: loc.where, away: loc.away, ip: loc.ip, untrustedProxy: loc.untrustedProxy },
    trustProxy: config.trustProxy !== false,
    // { at, from }: latest request in the past day with forwarding headers from a home or
    // loopback address TRUST_PROXY doesn't cover. Could be any device, so it's shown as
    // something to check, not an address to trust.
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
  // Don't let an admin lock themselves out by turning off outside access from outside.
  const loc = await requestLocation(req);
  const after = { ...loc.settings, ...Object.fromEntries(Object.entries({ remoteAccess, tailscaleIsHome }).filter(([, v]) => v !== undefined)) };
  const wouldBeAway = loc.where === 'outside' || (loc.where === 'tailscale' && !after.tailscaleIsHome);
  if (wouldBeAway && !after.remoteAccess) {
    return res.status(400).json({ error: "That would lock out the device you're using right now. Change it from your home network." });
  }
  // Same for two-factor away from home: it applies to existing sessions, so enabling it from
  // outside without 2FA would end this one.
  if (require2faOutside === true && !loc.settings.require2faOutside && wouldBeAway && !req.user.two_factor && !req.isApiKey) {
    return res.status(400).json({ error: "You're away from home and your account has no two-factor, so that would lock out the device you're using right now. Turn on two-factor for your account first, or change it from your home network." });
  }
  await saveNetworkSettings(db, { remoteAccess, tailscaleIsHome, require2faOutside });
  logger.info('system', `Network access settings changed by ${req.user.username}`, { remoteAccess, tailscaleIsHome, require2faOutside });
  res.json(await report(req, db));
}));

export default router;
