import { test, expect } from '@playwright/test';
import { signIn } from './helpers.js';

test('Admin → Network: where this device is, and the Tailscale guide', async ({ page, request }) => {
  await signIn(page, request);
  await page.goto('/admin?tab=network');
  await expect(page.getByText(/This device is connecting from your home network/)).toBeVisible();
  await page.getByRole('button', { name: 'Set up Tailscale' }).click();
  await expect(page.getByText('Make a free Tailscale account')).toBeVisible();
  await page.getByRole('button', { name: /link for friends without Tailscale/ }).click();
  await expect(page.getByText(/TS_FUNNEL=true/)).toBeVisible();
  // Outside access is off on this server, so Funnel needs it: one click from here.
  await expect(page.getByRole('button', { name: 'Allow outside access' })).toBeVisible();
});
