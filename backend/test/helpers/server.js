import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Each test file gets its own server process on its own port with its own DATA_DIR, so the
// suite never touches a real install's database and files can run in any order.
export async function startTestServer({ env = {} } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plinthio-test-'));
  const port = 30000 + Math.floor(Math.random() * 20000);

  const child = spawn('node', ['src/index.js'], {
    cwd: backendRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATA_DIR: dataDir,
      PORT: String(port),
      HOST: '127.0.0.1',
      JWT_SECRET: 'test-secret-not-used-anywhere-real',
      ...env
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20000;
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited early (code ${child.exitCode}):\n${output}`);
    }
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) break;
    } catch (e) {
      // Not listening yet.
    }
    if (Date.now() > deadline) {
      throw new Error(`Server did not become healthy in time:\n${output}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  const stop = async () => {
    child.kill('SIGKILL');
    await new Promise((r) => child.on('exit', r));
    fs.rmSync(dataDir, { recursive: true, force: true });
  };

  return { baseUrl, dataDir, stop, output: () => output };
}

// Runs the real first-run setup, then logs in — so tests authenticate the same way the app
// does rather than forging a token the server would never have issued.
export async function setupAdmin(baseUrl, { username = 'admin', password = 'test-password-123' } = {}) {
  const setup = await fetch(`${baseUrl}/api/auth/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password, serverName: 'Test Plinthio' })
  });
  if (!setup.ok) throw new Error(`Setup failed: ${await setup.text()}`);

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  if (!login.ok) throw new Error(`Login failed: ${await login.text()}`);

  const body = await login.json();
  return { token: body.token, user: body.user };
}

export function authed(token) {
  return { authorization: `Bearer ${token}` };
}

// `path` is relative to the API root, so tests read as the endpoint they're exercising.
export async function getJson(baseUrl, path, token) {
  const res = await fetch(`${baseUrl}/api${path}`, { headers: authed(token) });
  return { status: res.status, body: await res.json() };
}
