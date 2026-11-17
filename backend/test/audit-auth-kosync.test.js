import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { startTestServer, setupAdmin, authed } from './helpers/server.js';

// KOReader sends MD5(key). The database keeps only SHA-256 of that, so a copy of the
// database (or a backup) holds nothing kosync accepts as a sign-in.
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const PASSWORD = 'test-password-123'; // setupAdmin's

describe('kosync keys at rest', () => {
  let server;
  let admin;
  let rawKey;
  let keyId;

  const openDb = async () => {
    const db = await open({ filename: path.join(server.dataDir, 'plinthio.sqlite'), driver: sqlite3.Database });
    await db.run('PRAGMA busy_timeout = 5000');
    return db;
  };
  const kosyncAuth = (key, username = 'admin') => fetch(`${server.baseUrl}/api/kosync/users/auth`, {
    headers: { 'x-auth-user': username, 'x-auth-key': key, accept: 'application/vnd.koreader.v1+json' }
  });

  before(async () => {
    server = await startTestServer();
    admin = await setupAdmin(server.baseUrl);
    const made = await fetch(`${server.baseUrl}/api/keys`, {
      method: 'POST',
      headers: { ...authed(admin.token), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'KOReader', password: PASSWORD })
    });
    const body = await made.json();
    rawKey = body.key.key;
    keyId = body.key.id;
  });

  after(async () => { await server?.stop(); });

  test('the MD5 KOReader sends works; the stored value does not', async () => {
    assert.equal((await kosyncAuth(md5(rawKey))).status, 200);
    assert.equal((await kosyncAuth(md5(rawKey).toUpperCase())).status, 200, 'case does not matter');

    const db = await openDb();
    const { key_md5: stored } = await db.get('SELECT key_md5 FROM api_keys WHERE id = ?', [keyId]);
    await db.close();
    assert.equal(stored.length, 64);
    assert.equal(stored, sha256(md5(rawKey)));
    assert.notEqual(stored, md5(rawKey));

    const replayed = await kosyncAuth(stored);
    assert.equal(replayed.status, 401, 'what the database holds is not a sign-in');
    assert.equal((await kosyncAuth(md5(rawKey), 'someone-else')).status, 401, 'the username has to match');
  });

  test('a database from before keeps working after the upgrade, and the plain MD5 is gone', async () => {
    // As an earlier version stored it: the MD5 itself.
    let db = await openDb();
    await db.run('UPDATE api_keys SET key_md5 = ? WHERE id = ?', [md5(rawKey), keyId]);
    await db.close();

    await server.stopKeepData();
    server = await startTestServer({ dataDir: server.dataDir });

    db = await openDb();
    const { key_md5: migrated } = await db.get('SELECT key_md5 FROM api_keys WHERE id = ?', [keyId]);
    await db.close();
    assert.equal(migrated, sha256(md5(rawKey)));
    assert.equal((await kosyncAuth(md5(rawKey))).status, 200, 'KOReader needs to do nothing');
    assert.equal((await kosyncAuth(migrated)).status, 401);

    // Safe to run again: a second start leaves the rows as they are.
    await server.stopKeepData();
    server = await startTestServer({ dataDir: server.dataDir });
    db = await openDb();
    assert.equal((await db.get('SELECT key_md5 FROM api_keys WHERE id = ?', [keyId])).key_md5, migrated);
    await db.close();
    assert.equal((await kosyncAuth(md5(rawKey))).status, 200);
  });
});
