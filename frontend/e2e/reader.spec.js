import { test, expect } from '@playwright/test';
import { signIn, volumes, setProgress, seriesUrl } from './helpers.js';

const pageLabel = (page) => page.locator('header p').filter({ hasText: /^Page/ }).first();

async function openReader(page) {
  await page.goto(seriesUrl);
  await page.getByRole('button', { name: /Start Reading|Continue Reading|Read Again/ }).first().click();
  await expect(pageLabel(page)).toBeVisible();
}

test.beforeEach(async ({ page, request }) => {
  const token = await signIn(page, request);
  for (const vol of await volumes(request, token)) await setProgress(request, token, vol.id, 0);
});

test('scroll mode keeps only nearby pages loaded, and the slider scrolls', async ({ page, request }) => {
  await openReader(page);
  await page.getByRole('button', { name: 'Scroll' }).click();
  const scroller = page.locator('.webtoon-scroll');
  await expect(scroller.locator('img').first()).toBeVisible();

  // Loading every page at once is what ran phones out of memory.
  expect(await scroller.locator('img').count()).toBeLessThanOrEqual(10);

  // Pages are asked for at screen size, not as full scans.
  expect(await scroller.locator('img').first().getAttribute('src')).toMatch(/[?&]w=\d+/);

  await page.locator('input[type=range]').evaluate((el) => {
    el.value = '29';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(pageLabel(page)).toHaveText('Page 30 of 40');
  expect(await scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await scroller.locator('img').count()).toBeLessThanOrEqual(10);

  // Scrolling to the end reaches the last page and saves progress without closing. (Keep
  // flinging, like a reader would: the last pages grow as their real images load.)
  const token = await page.evaluate(() => localStorage.getItem('plinthio_token'));
  await expect.poll(async () => {
    await scroller.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    return (await volumes(request, token))[0].current_page;
  }, { timeout: 10_000 }).toBe(40);
  await expect(pageLabel(page)).toHaveText('Page 40 of 40');

  // Scroll mode is remembered for this series on this device.
  await page.keyboard.press('Escape');
  await expect(page.locator('.webtoon-scroll')).toBeHidden();
  await openReader(page);
  await expect(page.locator('.webtoon-scroll')).toBeVisible();
});

test('swiping follows the reading direction in right-to-left manga', async ({ page }) => {
  await openReader(page);
  await expect(pageLabel(page)).toHaveText('Page 1 of 40');
  const zone = page.locator('.touch-none').first();
  const box = await zone.boundingBox();
  const y = box.y + box.height / 2;
  const swipe = async (fromX, toX) => {
    await page.mouse.move(fromX, y);
    await page.mouse.down();
    await page.mouse.move(toX, y, { steps: 5 });
    await page.mouse.up();
  };

  // Manga reads right to left: the next page comes from the left, so swipe right.
  await swipe(box.x + 60, box.x + box.width - 60);
  await expect(pageLabel(page)).toHaveText('Page 2 of 40');
  await swipe(box.x + box.width - 60, box.x + 60);
  await expect(pageLabel(page)).toHaveText('Page 1 of 40');
});

test('"Read Again" on a finished volume starts from page 1', async ({ page, request }) => {
  const token = await page.evaluate(() => localStorage.getItem('plinthio_token'));
  const [vol1] = await volumes(request, token);
  await setProgress(request, token, vol1.id, 40);
  await page.goto(`/title/${vol1.id}`);
  await page.getByRole('button', { name: /Read Again/ }).first().click();
  await expect(pageLabel(page)).toHaveText('Page 1 of 40');
});
