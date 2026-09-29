import { test, expect } from '@playwright/test';
import { signIn, volumes, setProgress, seriesUrl } from './helpers.js';

test('title page on a phone: one-line main button, labelled actions menu', async ({ page, request }) => {
  const token = await signIn(page, request);
  const [vol1] = await volumes(request, token);
  await setProgress(request, token, vol1.id, 12);
  await page.goto(seriesUrl);

  const cta = page.getByRole('button', { name: /Continue Reading/ });
  await expect(cta).toBeVisible();
  // One line (h-11), not wrapped onto two.
  expect((await cta.boundingBox()).height).toBeLessThan(56);

  // The icon-only row is gone on phones; the same actions are in a labelled menu.
  await expect(page.getByRole('button', { name: 'Reset History' })).toBeHidden();
  await page.getByRole('button', { name: 'More actions' }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: 'Reset History' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Mark All/ })).toBeVisible();
});

test('the app install guide opens from a /docs#pwa link and shows HTTPS status', async ({ page, request }) => {
  await signIn(page, request);
  await page.goto('/docs#pwa');
  await expect(page.getByText('Step 1: Secure connection (HTTPS)')).toBeVisible();
  // The test server runs without HTTPS.
  await expect(page.getByText('The easy way: Tailscale')).toBeVisible();
  await expect(page.getByText("Plinthio's own HTTPS isn't turned on for this server.")).toBeVisible();
});
