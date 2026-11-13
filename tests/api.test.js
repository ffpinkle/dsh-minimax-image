import test from 'node:test';
import assert from 'node:assert/strict';

import { testing } from '../index.js';

const { runImageRequest, buildGenerationBody } = testing;

/** Replace globalThis.fetch for one test and record every call. */
function stubFetch(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return handler(String(url), options, calls.length);
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

function jsonResponse(status, payload, statusText = '') {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: new Headers({ 'content-type': 'application/json' }),
    async text() {
      return JSON.stringify(payload);
    },
    async arrayBuffer() {
      throw new Error('arrayBuffer is not used for JSON responses');
    },
  };
}

function fakeAttachments() {
  return {
    imageLimits: { maxImageBytes: 10 * 1024 * 1024 },
    async saveImage({ data, mediaType, name }) {
      return { id: `att-${name}`, mediaType, bytes: data.length, width: 1, height: 1 };
    },
  };
}

const exec = { signal: undefined };

function requestFor(overrides = {}) {
  const { body, n, outputFormat } = buildGenerationBody({ prompt: 'a cat', ...overrides });
  return {
    endpoint: 'https://api.minimax.cn/v1/images/generations',
    operation: 'image generation',
    body,
    apiKey: 'test-key',
    n,
    outputFormat,
    exec,
    attachments: fakeAttachments(),
  };
}

test('runImageRequest posts once and persists returned images', async () => {
  const stub = stubFetch(() =>
    jsonResponse(200, {
      request_id: 'req-123',
      output_format: 'jpeg',
      data: [{ b64_json: Buffer.from('fake-jpeg').toString('base64') }],
    }),
  );
  try {
    const result = await runImageRequest(requestFor());
    assert.equal(result.requestId, 'req-123');
    assert.equal(result.images.length, 1);
    assert.equal(result.failures.length, 0);
    assert.equal(result.images[0].attachment.id, 'att-minimax-req-123-1.jpg');

    assert.equal(stub.calls.length, 1, 'exactly one request, never a retry');
    const [call] = stub.calls;
    assert.equal(call.url, 'https://api.minimax.cn/v1/images/generations');
    assert.equal(call.options.method, 'POST');
    assert.equal(call.options.headers.Authorization, 'Bearer test-key');
    const sent = JSON.parse(call.options.body);
    assert.equal(sent.prompt, 'a cat');
    assert.equal(sent.size, 'auto');
    assert.equal(sent.aspect_ratio, '1:1');
  } finally {
    stub.restore();
  }
});

test('a 401 fails with the region hint and is not retried', async () => {
  const stub = stubFetch(() =>
    jsonResponse(401, { error: { message: 'invalid api key' } }, 'Unauthorized'),
  );
  try {
    await assert.rejects(
      () => runImageRequest(requestFor()),
      (error) => /HTTP 401/.test(error.message) && /region-bound/.test(error.message),
    );
    assert.equal(stub.calls.length, 1, 'a rejected request must never be retried');
  } finally {
    stub.restore();
  }
});

test('a 402 with code 1008 explains the empty balance', async () => {
  const stub = stubFetch(() =>
    jsonResponse(402, { error: { code: 1008, message: 'insufficient balance' } }, 'Payment Required'),
  );
  try {
    await assert.rejects(
      () => runImageRequest(requestFor()),
      (error) => /code 1008/.test(error.message) && /no usable credit/.test(error.message),
    );
    assert.equal(stub.calls.length, 1);
  } finally {
    stub.restore();
  }
});

test('partial failures are reported next to the images that succeeded', async () => {
  const stub = stubFetch(() =>
    jsonResponse(200, {
      request_id: 'req-partial',
      data: [
        { b64_json: Buffer.from('ok').toString('base64') },
        { error: { code: 1026, message: 'input blocked' } },
      ],
    }),
  );
  try {
    const result = await runImageRequest(requestFor({ n: 2 }));
    assert.equal(result.images.length, 1);
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].code, '1026');
    assert.equal(result.requested, 2);
    assert.equal(stub.calls.length, 1);
  } finally {
    stub.restore();
  }
});

test('a response that misses a requested image is recorded, not retried', async () => {
  const stub = stubFetch(() => jsonResponse(200, { request_id: 'r', data: [] }));
  try {
    await assert.rejects(() => runImageRequest(requestFor({ n: 1 })), /produced no usable images/);
    assert.equal(stub.calls.length, 1);
  } finally {
    stub.restore();
  }
});

test('a timeout surfaces as a no-retry error', async () => {
  const stub = stubFetch(() => {
    const error = new Error('The operation was aborted due to timeout');
    error.name = 'AbortError';
    throw error;
  });
  try {
    await assert.rejects(
      () => runImageRequest(requestFor()),
      (error) => /cancelled or timed out/.test(error.message) && /do not retry automatically/.test(error.message),
    );
    assert.equal(stub.calls.length, 1, 'a timeout must not trigger an automatic retry');
  } finally {
    stub.restore();
  }
});

test('a network failure surfaces as a no-retry error', async () => {
  const stub = stubFetch(() => {
    throw new Error('ECONNRESET');
  });
  try {
    await assert.rejects(
      () => runImageRequest(requestFor()),
      (error) => /request failed: ECONNRESET/.test(error.message) && /do not retry automatically/.test(error.message),
    );
    assert.equal(stub.calls.length, 1);
  } finally {
    stub.restore();
  }
});

test('a failed image download is recorded as a failure without a retry', async () => {
  const stub = stubFetch((url) => {
    if (url === 'https://cdn.example.com/a.jpg') {
      return {
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        headers: new Headers(),
        async text() {
          return '';
        },
        async arrayBuffer() {
          return new ArrayBuffer(0);
        },
      };
    }
    return jsonResponse(200, { request_id: 'req-dl', data: [{ url: 'https://cdn.example.com/a.jpg' }] });
  });
  try {
    await assert.rejects(
      () => runImageRequest(requestFor()),
      (error) => /DOWNLOAD_FAILED/.test(error.message) && /HTTP 503/.test(error.message),
    );
    // One generation call plus one download attempt: no retries of either.
    assert.deepEqual(stub.calls.map((call) => call.url), [
      'https://api.minimax.cn/v1/images/generations',
      'https://cdn.example.com/a.jpg',
    ]);
  } finally {
    stub.restore();
  }
});

test('the request body is sent verbatim, including an explicit size', async () => {
  const stub = stubFetch(() => jsonResponse(200, { data: [{ b64_json: 'AAAA' }] }));
  try {
    const request = requestFor({ size: '1024x1536', aspect_ratio: '16:9' });
    await runImageRequest(request);
    const sent = JSON.parse(stub.calls[0].options.body);
    assert.equal(sent.size, '1024x1536');
    assert.equal('aspect_ratio' in sent, false);
    assert.equal('area' in sent, false);
  } finally {
    stub.restore();
  }
});

test('the bytes decide the media type when the API returns another format', async () => {
  const jpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00,
  ]);
  const stub = stubFetch(() =>
    jsonResponse(200, { request_id: 'req-fmt', data: [{ b64_json: jpeg.toString('base64') }] }),
  );
  try {
    const result = await runImageRequest(requestFor({ output_format: 'png' }));
    assert.equal(result.images[0].attachment.mediaType, 'image/jpeg');
    assert.match(result.images[0].attachment.id, /\.jpg$/);
  } finally {
    stub.restore();
  }
});

test('downloaded bytes win over a mislabelled content-type header', async () => {
  const png = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48,
    0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00,
    0x00,
  ]);
  const stub = stubFetch((url) => {
    if (url === 'https://cdn.example.com/a.bin') {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/octet-stream' }),
        async arrayBuffer() {
          return png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength);
        },
      };
    }
    return jsonResponse(200, { request_id: 'req-dl2', data: [{ url: 'https://cdn.example.com/a.bin' }] });
  });
  try {
    const result = await runImageRequest(requestFor());
    assert.equal(result.images[0].attachment.mediaType, 'image/png');
    assert.match(result.images[0].attachment.id, /\.png$/);
  } finally {
    stub.restore();
  }
});