import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// DSH_HOME is read on every call, so the route writes into a throwaway home
// instead of the machine's real ~/.dsh.
const home = await mkdtemp(join(tmpdir(), 'dsh-minimax-home-'));
process.env.DSH_HOME = home;

const { testing } = await import('../index.js');
const { handleCredentialRequest, settingsFilePath } = testing;

const settingsFile = join(home, 'plugin-data', 'dsh-minimax-image', 'settings.json');
const HOST = '127.0.0.1:55125';

after(async () => {
  delete process.env.DSH_HOME;
  await rm(home, { recursive: true, force: true });
});

function fakeResponse() {
  const out = { status: 0, headers: {}, body: '' };
  return {
    out,
    setHeader(name, value) {
      out.headers[String(name).toLowerCase()] = String(value);
    },
    writeHead(status, headers) {
      out.status = status;
      for (const [name, value] of Object.entries(headers || {})) {
        out.headers[String(name).toLowerCase()] = String(value);
      }
    },
    end(body) {
      out.body = body || '';
    },
  };
}

function fakeRequest({ method = 'POST', headers = {}, raw } = {}) {
  const payload = raw === undefined ? '' : raw;
  return {
    method,
    headers: {
      host: HOST,
      'content-type': 'application/json',
      ...headers,
    },
    async *[Symbol.asyncIterator]() {
      if (payload) yield Buffer.from(payload, 'utf8');
    },
  };
}

async function call(options) {
  const res = fakeResponse();
  await handleCredentialRequest(fakeRequest(options), res);
  return { status: res.out.status, headers: res.out.headers, payload: res.out.body ? JSON.parse(res.out.body) : null };
}

const post = (body, headers) => call({ raw: JSON.stringify(body), headers });

before(async () => {
  // Start from a clean slate: nothing configured yet.
  await rm(join(home, 'plugin-data'), { recursive: true, force: true });
});

test('get-endpoint reports the .cn default before anything is stored', async () => {
  const { status, payload } = await post({ action: 'get-endpoint' });
  assert.equal(status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.endpoint.endpoint, 'https://api.minimax.cn/v1');
  assert.equal(payload.endpoint.mode, 'cn');
  assert.equal(payload.endpoint.source, 'default');
});

test('set-endpoint io persists and get-endpoint reflects it', async () => {
  const { status, payload } = await post({ action: 'set-endpoint', mode: 'io' });
  assert.equal(status, 200);
  assert.equal(payload.endpoint.endpoint, 'https://api.minimax.io/v1');
  assert.equal(payload.endpoint.mode, 'io');
  assert.equal(payload.endpoint.source, 'settings');

  const stored = JSON.parse(await readFile(settingsFile, 'utf8'));
  assert.equal(stored.mode, 'io');

  const again = await post({ action: 'get-endpoint' });
  assert.equal(again.payload.endpoint.endpoint, 'https://api.minimax.io/v1');
});

test('switching back to cn drops a previously stored custom URL', async () => {
  await post({ action: 'set-endpoint', mode: 'custom', custom: 'https://proxy.example.com/v1/' });

  const custom = await post({ action: 'get-endpoint' });
  assert.equal(custom.payload.endpoint.endpoint, 'https://proxy.example.com/v1');
  assert.equal(custom.payload.endpoint.source, 'settings');

  const { payload } = await post({ action: 'set-endpoint', mode: 'cn' });
  assert.equal(payload.endpoint.endpoint, 'https://api.minimax.cn/v1');

  const stored = JSON.parse(await readFile(settingsFile, 'utf8'));
  assert.equal(stored.mode, 'cn');
  assert.equal(stored.custom, undefined);
});

test('an invalid custom endpoint is a 400 and leaves the stored setting alone', async () => {
  await post({ action: 'set-endpoint', mode: 'cn' });

  for (const custom of ['ftp://example.com', 'not a url', 'https:///v1', '']) {
    const { status, payload } = await post({ action: 'set-endpoint', mode: 'custom', custom });
    assert.equal(status, 400, `custom=${JSON.stringify(custom)}`);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /absolute http\(s\) URL/);
  }

  const stored = JSON.parse(await readFile(settingsFile, 'utf8'));
  assert.equal(stored.mode, 'cn');
});

test('an unknown mode is rejected without touching the file', async () => {
  const { status, payload } = await post({ action: 'set-endpoint', mode: 'mars' });
  assert.equal(status, 400);
  assert.match(payload.error, /mode/);
});

test('unknown actions are a 400', async () => {
  const { status, payload } = await post({ action: 'nope' });
  assert.equal(status, 400);
  assert.equal(payload.error, 'unknown action');
});

test('credential actions report 503 when the credentials service is absent', async () => {
  const describe = await post({ action: 'describe' });
  assert.equal(describe.status, 503);
  assert.match(describe.payload.error, /credentials service unavailable/);

  const set = await post({ action: 'set', value: 'sk-test' });
  assert.equal(set.status, 503);

  const unset = await post({ action: 'unset' });
  assert.equal(unset.status, 503);
});

test('non-POST methods are rejected with an Allow header', async () => {
  const { status, headers, payload } = await call({ method: 'GET' });
  assert.equal(status, 405);
  assert.equal(headers.allow, 'POST');
  assert.equal(payload.error, 'method not allowed');
});

test('a non-JSON content type is a 415', async () => {
  const { status, payload } = await call({
    raw: JSON.stringify({ action: 'get-endpoint' }),
    headers: { 'content-type': 'text/plain' },
  });
  assert.equal(status, 415);
  assert.equal(payload.error, 'application/json required');
});

test('a malformed JSON body is a 400', async () => {
  const { status, payload } = await call({ raw: '{nope' });
  assert.equal(status, 400);
  assert.equal(payload.error, 'invalid JSON body');
});

test('an oversized body is a 413', async () => {
  const { status, payload } = await call({ raw: JSON.stringify({ action: 'set', value: 'x'.repeat(9000) }) });
  assert.equal(status, 413);
  assert.equal(payload.error, 'request body too large');
});

test('cross-origin requests are forbidden', async () => {
  const { status, payload } = await call({
    raw: JSON.stringify({ action: 'get-endpoint' }),
    headers: { origin: 'https://evil.example.com' },
  });
  assert.equal(status, 403);
  assert.equal(payload.error, 'forbidden origin');
});

test('cross-site fetch metadata is forbidden', async () => {
  const { status, payload } = await call({
    raw: JSON.stringify({ action: 'get-endpoint' }),
    headers: { 'sec-fetch-site': 'cross-site' },
  });
  assert.equal(status, 403);
  assert.equal(payload.error, 'forbidden request site');
});

test('same-origin requests pass the guards', async () => {
  const { status, payload } = await post(
    { action: 'get-endpoint' },
    { origin: `http://${HOST}`, 'sec-fetch-site': 'same-origin' },
  );
  assert.equal(status, 200);
  assert.equal(payload.ok, true);
});

test('responses are JSON and never cached', async () => {
  const { status, headers } = await post({ action: 'get-endpoint' });
  assert.equal(status, 200);
  assert.match(headers['content-type'], /^application\/json/);
  assert.equal(headers['cache-control'], 'no-store');
});
