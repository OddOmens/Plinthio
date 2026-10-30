import { test, expect } from '@playwright/test';
import { signIn } from './helpers.js';

// Admin → Metadata: titles with nothing to find online (home videos) can have their missing
// poster and details ignored, one by one or for a whole library, and brought back.
test('missing metadata can be ignored per title and per library, and flagged again', async ({ page, request }) => {
  const token = await signIn(page, request);
  const headers = { Authorization: `Bearer ${token}` };
  const { libraries } = await (await request.get('/api/libraries', { headers })).json();
  const manga = libraries.find((l) => l.type === 'manga');
  expect(manga).toBeTruthy();

  await page.goto('/admin?tab=metadata');
  const ignoredPill = page.getByRole('button', { name: /^Ignored \(\d+\)$/ });
  await expect(ignoredPill).toHaveText('Ignored (0)');

  // One title, picked by name.
  const { items } = await (await request.get('/api/metadata/admin/items?limit=1', { headers })).json();
  const title = items[0].title;
  await page.getByRole('checkbox', { name: title, exact: true }).check();
  const ignored = page.waitForResponse((r) => r.url().includes('/api/metadata/admin/ignore-missing'));
  await page.getByRole('button', { name: 'Ignore Missing Info (1)' }).click();
  expect((await ignored).ok()).toBeTruthy();
  await expect(ignoredPill).toHaveText('Ignored (1)');

  await ignoredPill.click();
  await page.getByRole('checkbox', { name: title, exact: true }).check();
  await page.getByRole('button', { name: 'Flag Again (1)' }).click();
  await expect(ignoredPill).toHaveText('Ignored (0)');

  // A whole library.
  const librarySwitch = page.getByTestId('home-video-libraries').getByRole('switch', { name: manga.name, exact: true });
  await expect(librarySwitch).toHaveAttribute('aria-checked', 'false');
  const saved = page.waitForResponse((r) => r.url().includes(`/api/libraries/${manga.id}`) && r.request().method() === 'PATCH');
  await librarySwitch.click();
  expect((await saved).ok()).toBeTruthy();
  await expect(librarySwitch).toHaveAttribute('aria-checked', 'true');
  await expect(ignoredPill).not.toHaveText('Ignored (0)');

  // Put it back for the other tests.
  await librarySwitch.click();
  await expect(librarySwitch).toHaveAttribute('aria-checked', 'false');
  await expect(ignoredPill).toHaveText('Ignored (0)');
});
