import { test, expect } from '@playwright/test';
import { signIn } from './helpers.js';

// A set filter has a see-through tint, which a <select>'s open list can't draw, so the options
// carry solid theme colours (otherwise white text on white in the dark theme).
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
