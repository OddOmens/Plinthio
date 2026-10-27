import os from 'os';
import path from 'path';
import { expect } from '@playwright/test';

export const ADMIN = { username: 'admin', password: 'e2e-password' };

// Where e2e/serve.mjs generated the manga library.
export function libraryPath() {
  return path.join(os.tmpdir(), `plinthio-e2e-${process.env.E2E_PORT || '18090'}`, 'media', 'manga');
}

// Where e2e/serve.mjs wrote the EPUB used by the ebook reader tests.
export function booksPath() {
  return path.join(os.tmpdir(), `plinthio-e2e-${process.env.E2E_PORT || '18090'}`, 'media', 'books');
}

// The id of a book from the EPUB library, adding and scanning that library the first time.
export async function bookId(request, token) {
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

// Signs in through the API and puts the session where the app looks for it, so each test
// starts signed in without replaying the login form.
export async function signIn(page, request) {
  const res = await request.post('/api/auth/login', { data: ADMIN });
  expect(res.ok()).toBeTruthy();
  const session = await res.json();
  await page.goto('/login');
  await page.evaluate((s) => {
    localStorage.setItem('plinthio_token', s.token);
    localStorage.setItem('plinthio_user', JSON.stringify(s.user));
    if (s.mediaToken) localStorage.setItem('plinthio_media_token', s.mediaToken);
  }, session);
  return session.token;
}

export async function volumes(request, token) {
  const res = await request.get('/api/items?limit=50', { headers: { Authorization: `Bearer ${token}` } });
  const { items } = await res.json();
  return items.filter((i) => i.series === 'Test Series').sort((a, b) => a.volume - b.volume);
}

export async function setProgress(request, token, itemId, currentPage, totalPages = 40) {
  const res = await request.post(`/api/progress/${itemId}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { currentPage, totalPages }
  });
  expect(res.ok()).toBeTruthy();
}

export const seriesUrl = '/series/' + encodeURIComponent('Test Series');
