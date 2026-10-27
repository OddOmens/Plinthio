import { test, expect } from '@playwright/test';
import { signIn, bookId } from './helpers.js';

// Edit Metadata's book search, with the providers' answers stood in for: Google Books out of
// quota, and an Open Library result whose description arrives a moment later.
test('book search: says Google is out of quota, loads the description, and skips a broken cover', async ({ page, request }) => {
  const token = await signIn(page, request);
  const id = await bookId(request, token);

  let searchedLanguage;
  await page.route('**/api/metadata/search?**', async (route) => {
    searchedLanguage = new URL(route.request().url()).searchParams.get('language');
    await route.fulfill({
      json: {
        results: [{
          source: 'open-library', externalId: '/works/OL1W', title: 'Project Hail Mary', author: 'Andy Weir',
          releaseDate: '2021', isbn: '9780593135204', publisher: 'Ballantine Books', language: 'en', genres: [],
          overview: null, coverUrl: 'https://covers.invalid/b/id/1-L.jpg'
        }],
        notices: [{ provider: 'google-books', reason: 'quota', keyed: false }]
      }
    });
  });
  await page.route('**/api/metadata/details?**', (route) => route.fulfill({
    json: { details: { overview: 'A lone astronaut wakes up with no memory.' } }
  }));
  await page.route('https://covers.invalid/**', (route) => route.abort());

  await page.goto(`/title/${id}`);
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Edit Metadata' }).click();
  await page.getByRole('button', { name: /to fill in missing info/ }).click();
  await page.getByRole('button', { name: 'Search', exact: true }).click();

  await expect(page.getByText(/Google Books has used up its free daily searches/)).toBeVisible();
  expect(searchedLanguage).toBeTruthy();
  await expect(page.getByText('A lone astronaut wakes up with no memory.')).toBeVisible();
  await expect(page.getByText('Ballantine Books · ISBN 9780593135204 · English')).toBeVisible();
  // The cover link failed, so the result shows the placeholder and offers no cover to pick.
  await expect(page.getByRole('img', { name: 'Project Hail Mary' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Description', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cover', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Use all' }).click();
  await expect(page.getByPlaceholder(/description/i)).toHaveValue('A lone astronaut wakes up with no memory.');
  await expect(page.getByPlaceholder('10 or 13 digits')).toHaveValue('9780593135204');
});

test('Admin → Metadata: each source has a switch, and it sticks', async ({ page, request }) => {
  const token = await signIn(page, request);
  await page.goto('/admin?tab=metadata');

  const google = page.getByRole('switch', { name: 'Google Books' });
  for (const name of ['TMDB', 'TVmaze', 'AniList', 'MangaDex', 'Comic Vine', 'Open Library', 'Google Books', 'Audible']) {
    await expect(page.getByRole('switch', { name })).toHaveAttribute('aria-checked', 'true');
  }
  // Each says whether it needs a key; Comic Vine can't work until one is added.
  const row = (name) => page.locator('div', { has: page.getByRole('switch', { name }) }).last();
  await expect(row('Comic Vine')).toContainText('Needs a key');
  await expect(row('TVmaze')).toContainText('No key needed');
  await expect(row('Google Books')).toContainText('Optional key');
  await expect(page.getByRole('heading', { name: 'Comic Vine key' })).toBeVisible();
  await google.click();
  await expect(google).toHaveAttribute('aria-checked', 'false');
  await page.reload();
  await expect(page.getByRole('switch', { name: 'Google Books' })).toHaveAttribute('aria-checked', 'false');

  // Back on, through the API, so the other tests see every source.
  const res = await request.put('/api/settings/metadata-providers/enabled', {
    headers: { Authorization: `Bearer ${token}` }, data: { provider: 'google-books', enabled: true }
  });
  expect((await res.json()).providers['google-books']).toBe(true);
});
