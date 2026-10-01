import { test, expect } from '@playwright/test';
import { signIn, booksPath } from './helpers.js';

// The EPUB reader on a phone: bookmarks, highlights, and display settings that belong to
// the person (saved to their preferences, so the next book opens the same way).
async function bookId(request, token) {
  const headers = { Authorization: `Bearer ${token}` };
  let res = await request.get('/api/items?mediaType=book', { headers });
  let { items } = await res.json();
  if (!items.length) {
    res = await request.post('/api/libraries', { headers, data: { name: 'Books', type: 'books', path: booksPath() } });
    expect(res.ok()).toBeTruthy();
    const { library } = await res.json();
    // Creating a library starts a scan by itself; this one waits for its own to finish.
    expect((await request.post(`/api/libraries/${library.id}/scan`, { headers })).ok()).toBeTruthy();
    await expect.poll(async () => {
      ({ items } = await (await request.get('/api/items?mediaType=book', { headers })).json());
      return items.length;
    }).toBeGreaterThan(0);
  }
  expect(items.length).toBeGreaterThan(0);
  return items[0].id;
}

async function openBook(page, id) {
  await page.goto(`/title/${id}`);
  await page.getByRole('button', { name: /Start Reading|Continue Reading|Read Again/ }).first().click();
  const frame = page.frameLocator('iframe').first();
  await expect(frame.locator('p').first()).toBeVisible({ timeout: 15_000 });
  return frame;
}

async function bookFrame(page) {
  return (await page.locator('iframe').first().elementHandle()).contentFrame();
}

test('ebook reader: bookmark, highlight in a colour, and settings that stick', async ({ page, request }) => {
  const token = await signIn(page, request);
  const id = await bookId(request, token);
  await openBook(page, id);

  // Bookmark this page with the ribbon.
  const ribbon = page.getByRole('button', { name: 'Bookmark this page' });
  await ribbon.click();
  await expect(page.getByRole('button', { name: 'Remove bookmark from this page' })).toHaveAttribute('aria-pressed', 'true');

  // Select a few words and highlight them green.
  const frame = await bookFrame(page);
  await frame.evaluate(() => {
    const text = document.querySelector('p').firstChild;
    const range = document.createRange();
    range.setStart(text, 4);
    range.setEnd(text, 18);
    const sel = document.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await page.getByRole('button', { name: 'Highlight green' }).click();
  await expect(page.getByRole('toolbar', { name: 'Highlight' })).toBeHidden();

  // Both show in the notebook.
  await page.getByRole('button', { name: 'Contents, bookmarks and highlights' }).click();
  const notebook = page.getByRole('dialog', { name: 'Notebook' });
  await notebook.getByRole('tab', { name: /Highlights/ }).click();
  await expect(notebook.getByText('lantern keeper', { exact: false }).first()).toBeVisible();
  await notebook.getByRole('tab', { name: /Bookmarks/ }).click();
  await expect(notebook.getByText('Chapter 1').first()).toBeVisible();
  await page.getByRole('button', { name: 'Close notebook' }).click();

  // Sepia pages and bigger text, saved to the account.
  await page.getByRole('button', { name: 'Display settings' }).click();
  const display = page.getByRole('dialog', { name: 'Display' });
  await display.getByRole('button', { name: 'Sepia page' }).click();
  await display.getByRole('button', { name: 'Larger text' }).click();
  await display.getByRole('button', { name: 'Larger text' }).click();
  await expect.poll(async () => (await bookFrame(page)).evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe('rgb(244, 236, 216)');
  await expect.poll(async () => {
    const me = await (await request.get('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })).json();
    return me.user?.preferences?.ebookReader;
  }).toMatchObject({ theme: 'sepia', fontSize: 20 });

  // Another visit opens the same way, with the highlight drawn and the bookmark kept.
  await page.reload();
  await openBook(page, id);
  await expect.poll(async () => (await bookFrame(page)).evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe('rgb(244, 236, 216)');
  await expect.poll(async () => (await bookFrame(page)).evaluate(() => getComputedStyle(document.body).fontSize)).toBe('20px');
  await expect(page.locator('g.plinthio-hl, [ref="plinthio-hl"]').first()).toBeAttached();
  await expect(page.getByRole('button', { name: 'Remove bookmark from this page' })).toBeVisible();
});
