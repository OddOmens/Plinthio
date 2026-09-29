import { test, expect } from '@playwright/test';
import { ADMIN, libraryPath } from './helpers.js';

// The first-run wizard, end to end: every step through to a scanned library. (It once
// stopped at step 5 of 6 with a Continue button that did nothing.)
test('setup wizard creates the admin and the first library', async ({ page, request }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/setup/);

  const next = page.getByRole('button', { name: 'Continue' });
  await next.click(); // Appearance

  await page.getByPlaceholder('admin').fill(ADMIN.username);
  const passwords = page.getByPlaceholder('••••••••');
  await passwords.nth(0).fill(ADMIN.password);
  await passwords.nth(1).fill(ADMIN.password);
  await next.click();

  await next.click(); // Media types: keep the defaults

  await page.getByRole('button', { name: /Add a library folder now/ }).click();
  await page.getByPlaceholder('e.g. My Audiobooks').fill('Manga');
  await page.locator('select').first().selectOption('manga');
  await page.getByPlaceholder('/media/yourname/Database1/Books').fill(libraryPath());
  await next.click();

  await next.click(); // Household

  // Access: home only is the default.
  await expect(page.getByRole('radio', { name: /At home only/ })).toHaveAttribute('aria-checked', 'true');
  // Tailscale shows its step-by-step guide with the lines to paste…
  await page.getByRole('radio', { name: /away with Tailscale/ }).click();
  await expect(page.getByText('Set up Tailscale')).toBeVisible();
  await expect(page.getByText(/COMPOSE_FILE=docker-compose.yml:docker-compose.tailscale.yml/)).toBeVisible();
  await expect(page.getByText('TS_FUNNEL=true')).toBeHidden();
  // …and a link for friends (Funnel) opens the server to the internet.
  await page.getByRole('button', { name: /link for friends without Tailscale/ }).click();
  await expect(page.getByRole('radio', { name: /Also from the internet/ })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText(/TS_FUNNEL=true/)).toBeVisible();
  await expect(page.getByText('Require two-factor away from home')).toBeVisible();
  // Back to home only for the rest of the tests.
  await page.getByRole('radio', { name: /At home only/ }).click();
  await expect(page.getByText('Set up Tailscale')).toBeHidden();
  await next.click();

  await expect(page.getByText('Review & Launch Plinthio')).toBeVisible();
  await expect(page.getByText('Step 7 of 7')).toBeVisible();
  await expect(page.getByText('Home only')).toBeVisible();

  await page.getByRole('button', { name: 'Complete Setup & Launch' }).click();
  // Optional two-factor for the new admin, then on to the app.
  await expect(page.getByText('Plinthio is ready')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Turn on two-factor' })).toBeVisible();
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(page).not.toHaveURL(/\/setup/);

  // The first scan runs in the background; wait until both volumes are in.
  const login = await (await request.post('/api/auth/login', { data: ADMIN })).json();
  await expect.poll(async () => {
    const res = await request.get('/api/items?limit=50', { headers: { Authorization: `Bearer ${login.token}` } });
    return (await res.json()).items?.length || 0;
  }, { timeout: 30_000 }).toBe(2);
});
