import { APP_VERSION, compareVersions } from '../config/version.js';
import { logger } from './logger.js';

// Asks GitHub for the newest published release so admins can be told an update exists.
// It's the only outbound call Plinthio makes on its own, so it sends nothing about the
// install (a plain unauthenticated GET) and can be switched off with UPDATE_CHECK=false.
const RELEASES_URL = process.env.UPDATE_CHECK_URL
  || 'https://api.github.com/repos/OddOmens/Plinthio/releases/latest';
const CHECK_EVERY_MS = 12 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 30 * 1000;
const MIN_MANUAL_INTERVAL_MS = 60 * 1000;
const TIMEOUT_MS = 10 * 1000;
const MAX_NOTES_CHARS = 4000;

const enabled = !['false', '0', 'off', 'no'].includes(String(process.env.UPDATE_CHECK || '').toLowerCase());

let status = {
  enabled,
  current: APP_VERSION,
  latest: null,
  updateAvailable: false,
  releaseUrl: null,
  releaseName: null,
  publishedAt: null,
  notes: null,
  checkedAt: null,
  error: null
};
let lastAttempt = 0;
let inflight = null;

export function getUpdateStatus() {
  return status;
}

export async function checkForUpdate({ force = false } = {}) {
  if (!enabled) return status;
  if (inflight) return inflight;
  if (!force && Date.now() - lastAttempt < MIN_MANUAL_INTERVAL_MS) return status;
  lastAttempt = Date.now();

  inflight = (async () => {
    try {
      const res = await fetch(RELEASES_URL, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Plinthio/${APP_VERSION}` },
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
      // 404 = no release published yet; not an error worth surfacing.
      if (res.status === 404) {
        status = { ...status, checkedAt: new Date().toISOString(), error: null };
        return status;
      }
      if (!res.ok) throw new Error(`GitHub answered ${res.status}`);

      const release = await res.json();
      const latest = String(release.tag_name || '').replace(/^v/i, '');
      if (!latest || release.draft || release.prerelease) {
        status = { ...status, checkedAt: new Date().toISOString(), error: null };
        return status;
      }

      const updateAvailable = compareVersions(latest, APP_VERSION) > 0;
      if (updateAvailable && status.latest !== latest) {
        logger.info('system', `Plinthio ${latest} is available (running ${APP_VERSION})`);
      }
      status = {
        ...status,
        latest,
        updateAvailable,
        releaseUrl: release.html_url || null,
        releaseName: release.name || `v${latest}`,
        publishedAt: release.published_at || null,
        notes: release.body ? String(release.body).slice(0, MAX_NOTES_CHARS) : null,
        checkedAt: new Date().toISOString(),
        error: null
      };
    } catch (err) {
      // Offline servers are normal for a self-hosted app — keep the last good answer.
      status = { ...status, checkedAt: new Date().toISOString(), error: err.message };
    } finally {
      inflight = null;
    }
    return status;
  })();
  return inflight;
}

let started = false;
export function initUpdateCheck() {
  if (!enabled || started) return;
  started = true;
  setTimeout(() => checkForUpdate({ force: true }), FIRST_CHECK_DELAY_MS).unref();
  setInterval(() => checkForUpdate({ force: true }), CHECK_EVERY_MS).unref();
}
