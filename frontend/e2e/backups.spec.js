import { test, expect } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { signIn } from './helpers.js';

// Admin → Backups: copying backups to a second folder, chosen and
// checked from the browser.
test('backups can be copied to a folder chosen in the browser', async ({ page, request }) => {
  await signIn(page, request);
  const root = path.join(os.tmpdir(), `plinthio-e2e-${process.env.E2E_PORT || '18090'}`);
  const dest = path.join(root, 'second-place');

  await page.goto('/admin?tab=backups');
  const field = page.getByLabel('Also copy backups to');
  await field.scrollIntoViewIfNeeded();

  // A folder the server can't use says why.
  await field.fill('relative/path');
  await page.getByRole('button', { name: 'Test backup folder' }).click();
  await expect(page.getByText('Use a full path, starting with /.')).toBeVisible();

  // The picker browses the server's folders and can make a new one.
  await page.getByRole('button', { name: 'Browse for a backup folder' }).click();
  const picker = page.getByRole('dialog', { name: 'Copy backups to' });
  await expect(picker).toBeVisible();
  await picker.getByRole('button', { name: 'Close' }).click();

  await field.fill(dest);
  await page.getByRole('button', { name: 'Test backup folder' }).click();
  await expect(page.getByText(/The server can write there/)).toBeVisible();

  await page.getByRole('button', { name: 'Save backup settings' }).click();
  await expect(page.getByText(/Saved\. The backups you have are being copied/)).toBeVisible();

  // The backups that already exist arrive there, and the card says so.
  await page.getByRole('button', { name: 'Back up now' }).click();
  await expect.poll(() => (fs.existsSync(path.join(dest, 'database'))
    ? fs.readdirSync(path.join(dest, 'database')).filter((f) => f.endsWith('.sqlite')).length
    : 0)).toBeGreaterThan(0);
  await page.reload();
  await expect(page.getByText(`Copied to ${dest}`, { exact: false })).toBeVisible();
});
