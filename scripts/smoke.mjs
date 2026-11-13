#!/usr/bin/env node
/**
 * Live smoke test: one real MiniMax generation to prove the endpoint, key and
 * response parsing work end to end.
 *
 * It is intentionally NOT part of `node --test`:
 *   - it needs a real MINIMAX_API_KEY,
 *   - MiniMax bills per generated image (roughly ¥0.1 for one 1K image),
 *   - generation is not idempotent, so the script never retries.
 *
 * Without MINIMAX_API_KEY it exits 0 after printing that it was skipped.
 *
 * Usage:
 *   MINIMAX_API_KEY=sk-... node scripts/smoke.mjs
 *   MINIMAX_API_KEY=sk-... MINIMAX_API_BASE=https://api.minimax.io/v1 node scripts/smoke.mjs
 */
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { testing } from '../index.js';

const { resolveEndpoint, sniffMediaType, readImageSize, extensionFor } = testing;

const apiKey = (process.env.MINIMAX_API_KEY || '').trim();
if (!apiKey) {
  console.log('smoke: skipped — set MINIMAX_API_KEY to run one real (billed) generation.');
  process.exit(0);
}

const { endpoint, mode, source } = resolveEndpoint(undefined, process.env.MINIMAX_API_BASE);
const body = {
  model: 'MiniMax-H3-Image',
  prompt: 'a single red apple on a white table, natural light, product photo',
  n: 1,
  size: '1024x1024',
  response_format: 'b64_json',
  stream: false,
  aigc_watermark: false,
};

console.log(`smoke: endpoint=${endpoint} (${mode}/${source})`);
console.log('smoke: this charges one 1K image (~¥0.1) and is never retried.');

const startedAt = Date.now();
let response;
try {
  response = await fetch(`${endpoint}/images/generations`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(660000),
  });
} catch (error) {
  console.error(`smoke: request failed: ${error && error.message ? error.message : error}`);
  console.error('smoke: the request may still have been accepted and billed; do not rerun blindly.');
  process.exit(1);
}

const text = await response.text();
if (!response.ok) {
  console.error(`smoke: HTTP ${response.status} ${response.statusText}`);
  console.error(text.slice(0, 800));
  process.exit(1);
}

let payload;
try {
  payload = JSON.parse(text);
} catch {
  console.error('smoke: response was not JSON');
  console.error(text.slice(0, 800));
  process.exit(1);
}

const item = Array.isArray(payload.data) ? payload.data[0] : undefined;
if (!item || typeof item.b64_json !== 'string') {
  console.error('smoke: response did not contain data[0].b64_json');
  console.error(text.slice(0, 800));
  process.exit(1);
}

const bytes = Buffer.from(item.b64_json, 'base64');
// The API may return JPEG or PNG for a requested size, so trust the bytes
// rather than the extension we guessed.
const mediaType = sniffMediaType(bytes) || 'image/png';
const size = readImageSize(bytes, mediaType);
const file = join(tmpdir(), `minimax-smoke-${Date.now()}.${extensionFor(mediaType)}`);
await writeFile(file, bytes);

console.log(`smoke: ok in ${Date.now() - startedAt} ms`);
if (payload.request_id) console.log(`smoke: request_id=${payload.request_id}`);
const shape = size ? `${size.width}x${size.height}` : 'unknown size';
console.log(`smoke: ${mediaType} ${shape}, ${bytes.length} bytes -> ${file}`);
