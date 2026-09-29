import { test, expect } from '@playwright/test';
import { ADMIN } from './helpers.js';

// A viewer's onboarding: the accent they pick is theirs alone. (An admin's sets the server's
// default instead; the setup wizard covers that.)
test('a viewer picks their own accent in onboarding, without changing the server’s', async ({ page, request }) => {
  const admin = await (await request.post('/api/auth/login', { data: ADMIN })).json();
  const auth = { Authorization: `Bearer ${admin.token}` };
  const before = (await (await request.get('/api/customization')).json()).accentTheme;
  const user = { username: 'newviewer', password: 'newviewer-pass-1' };
  expect((await request.post('/api/users', { headers: auth, data: user })).ok()).toBeTruthy();

  await page.goto('/login');
  await page.getByLabel('Username').fill(user.username);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Sign In' }).click();

  const next = page.getByRole('button', { name: 'Continue' });
  await expect(page.getByText(/Welcome to/)).toBeVisible();
  await next.click(); // welcome
  await next.click(); // theme
  await expect(page.getByText("It's just for you")).toBeVisible();
  const pick = before === 'emerald' ? 'Violet' : 'Emerald';
  await page.getByRole('button', { name: pick, exact: true }).click();
  await next.click(); // accent
  await next.click(); // interests
  await page.getByRole('button', { name: 'Not now' }).click(); // two-factor
  await page.getByRole('button', { name: 'Start browsing' }).click();

  const me = await (await request.post('/api/auth/login', { data: user })).json();
  expect(me.user.preferences.accentTheme).toBe(pick.toLowerCase());
  expect((await (await request.get('/api/customization')).json()).accentTheme).toBe(before);
});
