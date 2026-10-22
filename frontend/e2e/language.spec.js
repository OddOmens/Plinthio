import { test, expect } from '@playwright/test';
import { ADMIN } from './helpers.js';

// Before signing in, the choice lives on the device; the sign-in page switches straight away
// and remembers it.
test('the sign-in page switches language and remembers it', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();

  await page.getByLabel('Language').selectOption('fr');
  await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');

  await page.reload();
  await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible();
});

// Signed in, it's saved to the account, so it follows the person to another device.
test('a language picked in Settings is saved to the account', async ({ page, request, browser }) => {
  const admin = await (await request.post('/api/auth/login', { data: ADMIN })).json();
  const user = { username: 'polyglot', password: 'polyglot-pass-1' };
  const created = await request.post('/api/users', {
    headers: { Authorization: `Bearer ${admin.token}` },
    data: { ...user, preferences: { onboardingComplete: true } }
  });
  expect(created.ok()).toBeTruthy();

  const signIn = async (p) => {
    const session = await (await request.post('/api/auth/login', { data: user })).json();
    await p.goto('/login');
    await p.evaluate((s) => {
      localStorage.setItem('plinthio_token', s.token);
      localStorage.setItem('plinthio_user', JSON.stringify(s.user));
      if (s.mediaToken) localStorage.setItem('plinthio_media_token', s.mediaToken);
    }, session);
  };

  await signIn(page);
  await page.goto('/settings?tab=appearance');
  await page.getByRole('radio', { name: 'Deutsch' }).click();
  await expect(page.getByRole('heading', { name: 'Darstellung' })).toBeVisible();

  const me = await (await request.post('/api/auth/login', { data: user })).json();
  expect(me.user.preferences.language).toBe('de');

  // A fresh browser with no device choice picks it up from the account.
  const other = await browser.newContext({ locale: 'en-US' });
  const second = await other.newPage();
  await signIn(second);
  await second.goto('/settings?tab=appearance');
  await expect(second.getByRole('heading', { name: 'Darstellung' })).toBeVisible();
  await other.close();
});
