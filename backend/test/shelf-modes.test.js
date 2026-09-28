import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, setupAdmin, authed, getJson } from './helpers/server.js';

describe('shelf views (grouping modes)', () => {
  let server;
  let admin;
  const patch = (body) => fetch(`${server.baseUrl}/api/settings/filters`, {
    method: 'PATCH',
    headers: { ...authed(admin.token), 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });

  before(async () => {
    server = await startTestServer();
    admin = await setupAdmin(server.baseUrl);
  });
  after(async () => { await server.stop(); });

  test('defaults to all four views', async () => {
    const res = await getJson(server.baseUrl, '/settings/filters', admin.token);
    assert.deepEqual(res.body.allowedGroupingModes, ['series', 'creator', 'disk_folder', 'custom_folder']);
  });

  test('admins can switch off Disk and Custom Folders but never Series or Creator', async () => {
    const res = await patch({ allowedGroupingModes: [] });
    assert.deepEqual((await res.json()).allowedGroupingModes, ['series', 'creator']);
    const again = await getJson(server.baseUrl, '/settings/filters', admin.token);
    assert.deepEqual(again.body.allowedGroupingModes, ['series', 'creator']);

    await patch({ allowedGroupingModes: ['custom_folder'] });
    const one = await getJson(server.baseUrl, '/settings/filters', admin.token);
    assert.deepEqual(one.body.allowedGroupingModes, ['series', 'creator', 'custom_folder']);
  });

  test('legacy mode names from older installs map onto the new ones', async () => {
    await patch({ allowedGroupingModes: ['grid', 'author', 'disk_folder'] });
    const res = await getJson(server.baseUrl, '/settings/filters', admin.token);
    assert.deepEqual(res.body.allowedGroupingModes, ['series', 'creator', 'disk_folder']);
  });
});
