import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, setupAdmin, authed } from './helpers/server.js';

// Regression cover for: saving Settings wiped every preference key the Settings screen
// doesn't own, so `onboardingComplete` vanished and the onboarding flow replayed itself.
describe('PATCH /api/users/preferences', () => {
  let server;
  let token;

  before(async () => {
    server = await startTestServer();
    ({ token } = await setupAdmin(server.baseUrl));
  });

  after(async () => { await server.stop(); });

  const patch = async (body) => {
    const res = await fetch(`${server.baseUrl}/api/users/preferences`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...authed(token) },
      body: JSON.stringify(body)
    });
    return { status: res.status, body: await res.json() };
  };

  test('merges into stored preferences instead of replacing them', async () => {
    const seeded = await patch({ onboardingComplete: true, theme: 'dark' });
    assert.equal(seeded.status, 200);

    // Exactly what the Settings screen sends: the three keys it owns, nothing else.
    const saved = await patch({
      enabledMediaTypes: ['movie', 'show'],
      enabledGroupingModes: ['grid'],
      defaultView: 'all'
    });

    assert.equal(saved.status, 200);
    assert.equal(saved.body.preferences.onboardingComplete, true, 'onboardingComplete must survive a partial save');
    assert.equal(saved.body.preferences.theme, 'dark', 'unrelated keys must survive a partial save');
    assert.deepEqual(saved.body.preferences.enabledMediaTypes, ['movie', 'show']);
  });

  test('the merged result is what actually persists', async () => {
    await patch({ onboardingComplete: true });
    await patch({ defaultView: 'manga' });

    const res = await fetch(`${server.baseUrl}/api/auth/me`, { headers: authed(token) });
    const me = await res.json();
    assert.equal(me.user.preferences.onboardingComplete, true);
    assert.equal(me.user.preferences.defaultView, 'manga');
  });

  test('rejects a non-object body rather than storing garbage', async () => {
    const arrayBody = await patch(['not', 'an', 'object']);
    assert.equal(arrayBody.status, 400);
  });
});
