import { test, expect } from '@playwright/test';
import { ADMIN, bookId } from './helpers.js';

// Settings → Hidden, as an everyday account: switching a library off takes everything in it
// away for that account only, and switching it back on brings it straight back.
const VIEWER = { username: 'hider', password: 'hider-password-1' };

test('a library switched off in Settings → Hidden disappears for that account only', async ({ page, request }) => {
  const admin = (await (await request.post('/api/auth/login', { data: ADMIN })).json()).token;
  const adminHeaders = { Authorization: `Bearer ${admin}` };
  await bookId(request, admin); // makes sure the Books library exists and has a book in it
  await request.post('/api/users', { headers: adminHeaders, data: VIEWER }); // already there on a rerun

  const res = await request.post('/api/auth/login', { data: VIEWER });
  expect(res.ok()).toBeTruthy();
  const session = await res.json();
  const headers = { Authorization: `Bearer ${session.token}` };
  // Straight to the app, without the first-run tour, and with nothing hidden yet.
  await request.patch('/api/users/preferences', { headers, data: { onboardingComplete: true, hiddenLibraries: [], hideKids: false } });
  session.user.preferences = { ...session.user.preferences, onboardingComplete: true, hiddenLibraries: [], hideKids: false };
  await page.goto('/login');
  await page.evaluate((s) => {
    localStorage.setItem('plinthio_token', s.token);
    localStorage.setItem('plinthio_user', JSON.stringify(s.user));
    if (s.mediaToken) localStorage.setItem('plinthio_media_token', s.mediaToken);
  }, session);

  const books = async (h) => (await (await request.get('/api/items?mediaType=book', { headers: h })).json()).items.length;
  expect(await books(headers)).toBeGreaterThan(0);

  await page.goto('/settings?tab=hidden');
  const list = page.getByTestId('hidden-libraries');
  await expect(list.getByRole('switch', { name: 'Kids content' })).toHaveAttribute('aria-checked', 'true');
  const booksSwitch = list.getByRole('switch', { name: 'Books', exact: true });
  await expect(booksSwitch).toHaveAttribute('aria-checked', 'true');

  const saved = page.waitForResponse((r) => r.url().includes('/api/users/preferences') && r.request().method() === 'PATCH');
  await booksSwitch.click();
  expect((await saved).ok()).toBeTruthy();
  await expect(booksSwitch).toHaveAttribute('aria-checked', 'false');
  expect(await books(headers)).toBe(0);
  expect(await books(adminHeaders), 'the admin still sees the books').toBeGreaterThan(0);

  // Still off after a reload, and back on with one more click.
  await page.reload();
  await expect(booksSwitch).toHaveAttribute('aria-checked', 'false');
  const savedAgain = page.waitForResponse((r) => r.url().includes('/api/users/preferences') && r.request().method() === 'PATCH');
  await booksSwitch.click();
  expect((await savedAgain).ok()).toBeTruthy();
  expect(await books(headers)).toBeGreaterThan(0);
});
