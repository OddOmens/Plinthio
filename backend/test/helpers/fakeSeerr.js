import http from 'http';

// A stand-in Seerr on this machine: it records what Plinthio sends and answers the way the
// real one's API description says (201 created, 409 already requested, 401/403 for a bad key).
export const GOOD_KEY = 'seerr-test-key';
export function startFakeSeerr() {
  const state = { calls: [], nextRequest: null, id: 40 };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      state.calls.push({ method: req.method, url: req.url, key: req.headers['x-api-key'], body });
      const send = (status, data) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      if (req.url === '/api/v1/status') return send(200, { version: '3.5.0' });
      if (req.headers['x-api-key'] !== GOOD_KEY) return send(403, { message: 'You do not have permission to access this endpoint' });
      if (req.url === '/api/v1/auth/me') return send(200, { id: 1, displayName: 'owner' });
      if (req.method === 'POST' && req.url === '/api/v1/request') {
        const forced = state.nextRequest;
        state.nextRequest = null;
        if (forced) return send(forced.status, forced.data);
        return send(201, { id: ++state.id, status: 2 });
      }
      send(404, { message: 'Not found' });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    state,
    url: `http://127.0.0.1:${server.address().port}`,
    stop: () => new Promise((r) => server.close(r))
  })));
}
