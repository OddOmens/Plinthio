import { test, expect } from '@playwright/test';
import { ADMIN } from './helpers.js';

// Downloads and cached media belong to the account that made them. A session that only ran
// out keeps them for the same account coming back, but a different account signing in next
// on the same browser must not inherit them (utils/accountDeviceData.js).

const OTHER = { username: 'device-other', password: 'device-other-password-1' };

// A sign-in token whose expiry is already past. The server rejects it; the app reads only
// its date, which is what makes the 401 look like a session that expired by itself.
function expiredToken(userId) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ id: userId, exp: Math.floor(Date.now() / 1000) - 3600 })}.x`;
}

// Leaves the browser as an expired session of `user` would: a download listed, a cached
// download in the offline cache, and the stored user record still there.
async function leaveExpiredSession(page, user) {
  // Seed storage from a same-origin page the app doesn't run on: a signed-in app tab would
  // write its live session back over the expired one.
  await page.goto('/api/health');
  await page.evaluate(async ({ token, user }) => {
    localStorage.clear();
    localStorage.setItem('plinthio_token', token);
    localStorage.setItem('plinthio_user', JSON.stringify(user));
    localStorage.setItem('plinthio_downloads', JSON.stringify({ seeded: { id: 'seeded' } }));
    const cache = await caches.open('plinthio-offline');
    await cache.put('/api/e2e-seeded-download', new Response('page'));
  }, { token: expiredToken(user.id), user });
  // Any page that asks the server anything gets the 401 and goes back to sign-in.
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('plinthio_user'))).toBeNull();
}

async function signInWithForm(page, account) {
  await page.getByLabel('Username').fill(account.username);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

const deviceState = (page) => page.evaluate(async () => ({
  owner: localStorage.getItem('plinthio_device_owner'),
  downloads: localStorage.getItem('plinthio_downloads'),
  // The worker re-creates an empty offline cache after clearing it, so look for the entry.
  offlineCache: !!(await (await caches.open('plinthio-offline')).match('/api/e2e-seeded-download'))
}));

test('an expired session keeps its downloads for the same account only', async ({ page, request }) => {
  const admin = await (await request.post('/api/auth/login', { data: ADMIN })).json();
  const made = await request.post('/api/users', {
    headers: { Authorization: `Bearer ${admin.token}` },
    data: { ...OTHER, preferences: { onboardingComplete: true } }
  });
  expect(made.ok() || made.status() === 409).toBeTruthy();

  // The same account signing back in keeps what it downloaded.
  await leaveExpiredSession(page, admin.user);
  expect((await deviceState(page)).owner).toBe(String(admin.user.id));
  await signInWithForm(page, ADMIN);
  let state = await deviceState(page);
  expect(state.downloads).not.toBeNull();
  expect(state.offlineCache).toBe(true);
  expect(state.owner).toBe(String(admin.user.id));

  // A different account signing in after the expiry finds nothing of the first one's.
  await leaveExpiredSession(page, admin.user);
  await signInWithForm(page, OTHER);
  await expect.poll(async () => (await deviceState(page)).offlineCache).toBe(false);
  state = await deviceState(page);
  expect(state.downloads).toBeNull();
  expect(state.owner).not.toBe(String(admin.user.id));
  expect(state.owner).not.toBeNull();
});
