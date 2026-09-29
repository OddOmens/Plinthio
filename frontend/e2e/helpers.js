import os from 'os';
import path from 'path';
import { expect } from '@playwright/test';

export const ADMIN = { username: 'admin', password: 'e2e-password' };

// Where e2e/serve.mjs generated the manga library.
export function libraryPath() {
  return path.join(os.tmpdir(), `plinthio-e2e-${process.env.E2E_PORT || '18090'}`, 'media', 'manga');
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
