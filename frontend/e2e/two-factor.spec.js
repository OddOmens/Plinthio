import crypto from 'crypto';
import { test, expect } from '@playwright/test';
import { ADMIN } from './helpers.js';

// TOTP (RFC 6238), the same codes an authenticator app shows, so the test can be the phone.
function base32Decode(str) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0; let value = 0; const out = [];
  for (const ch of str.replace(/\s/g, '').toUpperCase()) {
    value = (value << 5) | alphabet.indexOf(ch);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
function totp(secret, offset = 0) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0');
}

const USER = { username: 'twofa', password: 'twofa-password-1' };

async function signInWithForm(page) {
  await page.goto('/login');
  await page.getByLabel('Username').fill(USER.username);
  await page.getByLabel('Password', { exact: true }).fill(USER.password);
  await page.getByRole('button', { name: 'Sign In' }).click();
}

async function signOut(page) {
  await page.evaluate(() => localStorage.clear());
}

// Its own account, so the other tests keep signing in with just a password.
test('two-factor: turn it on in Settings, then sign in with a code and with a backup code', async ({ page, request }) => {
  const admin = await (await request.post('/api/auth/login', { data: ADMIN })).json();
  const made = await request.post('/api/users', {
    headers: { Authorization: `Bearer ${admin.token}` },
    data: { ...USER, preferences: { onboardingComplete: true } }
  });
  expect(made.ok()).toBeTruthy();

  await signInWithForm(page);
  await expect(page).not.toHaveURL(/\/login/);

  // Settings → Security → Turn on two-factor.
  await page.goto('/settings?tab=account');
  await page.getByRole('button', { name: 'Turn on two-factor' }).click();
  await expect(page.getByAltText('QR code for your authenticator app')).toBeVisible();
  const secret = (await page.locator('code').filter({ hasText: /^[A-Z2-7 ]{20,}$/ }).first().textContent()).trim();

  await page.getByLabel('Six-digit code').fill(totp(secret));
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText("Two-factor is on. Save your backup codes.")).toBeVisible();
  const backup = (await page.locator('.font-mono span').first().textContent()).trim();
  expect(backup).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/);
  const done = page.getByRole('button', { name: 'Done' });
  await expect(done).toBeDisabled(); // not until the codes are saved
  await page.getByLabel("I've saved these codes").check();
  await done.click();
  await expect(page.getByText('Two-factor is on', { exact: true })).toBeVisible();

  // Signing in now asks for the code. (The one used to confirm is spent; the next works.)
  await signOut(page);
  await signInWithForm(page);
  await expect(page.getByText('Enter your code')).toBeVisible();
  await page.getByLabel('Six-digit code').fill('000000');
  await expect(page.getByText(/not right/)).toBeVisible();
  await page.getByLabel('Six-digit code').fill(totp(secret, 1)); // six digits: it signs in by itself
  await expect(page).not.toHaveURL(/\/login/);

  // A backup code works too.
  await signOut(page);
  await signInWithForm(page);
  await page.getByRole('button', { name: /Use a backup code/ }).click();
  await page.getByLabel('Backup code').fill(backup);
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).not.toHaveURL(/\/login/);
});
