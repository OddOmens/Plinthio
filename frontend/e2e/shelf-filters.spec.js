import { test, expect } from '@playwright/test';
import { signIn } from './helpers.js';

// A shelf filter that's set gets a see-through tint. A <select>'s open list is drawn in the
// select's colours, and a see-through one can't be, so the list came out white under the
// dark theme's white text. The options now carry solid theme colours of their own.
test('a set shelf filter still opens a readable list in the dark theme', async ({ page, request }) => {
  await signIn(page, request);
  await page.goto('/');
  await page.evaluate(() => document.documentElement.classList.add('dark'));

  const status = page.getByRole('combobox', { name: 'Progress' });
  await status.selectOption('in_progress');
  const colours = await status.evaluate((select) => [...select.options].map((o) => {
    const style = getComputedStyle(o);
    return { background: style.backgroundColor, text: style.color };
  }));
  for (const { background, text } of colours) {
    expect(background, 'a solid background, not transparent').not.toMatch(/rgba\(.*, 0\)|transparent/);
    expect(background).not.toBe(text);
    expect(background, 'dark, under the dark theme').not.toBe('rgb(255, 255, 255)');
  }
});
