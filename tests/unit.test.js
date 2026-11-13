import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { testing } from '../index.js';

const {
  parsePixelSize,
  validateAspectRatio,
  readImageSize,
  sniffMediaType,
  buildReferenceImages,
  normalizeImageArgs,
  buildGenerationBody,
  resolveEndpoint,
  sanitizeEndpoint,
  settingsFilePath,
  readSettingsDocument,
  saveEndpointConfig,
  formatApiError,
} = testing;

/** Minimal but structurally valid PNG header; only the IHDR size fields matter here. */
function pngBytes(width, height) {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  Buffer.from('IHDR', 'ascii').copy(bytes, 12);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

/** JPEG with a single SOF0 segment: 96x64. */
function jpegBytes() {
  const bytes = Buffer.alloc(20);
  Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08]).copy(bytes, 0);
  bytes.writeUInt16BE(64, 7);
  bytes.writeUInt16BE(96, 9);
  return bytes;
}

/** WebP VP8X header carrying an explicit canvas size. */
function webpBytes(width, height) {
  const bytes = Buffer.alloc(30);
  Buffer.from('RIFF', 'ascii').copy(bytes, 0);
  bytes.writeUInt32LE(22, 4);
  Buffer.from('WEBPVP8X', 'ascii').copy(bytes, 8);
  bytes.writeUInt32LE(10, 16);
  bytes[24] = (width - 1) & 0xff;
  bytes[25] = ((width - 1) >> 8) & 0xff;
  bytes[26] = ((width - 1) >> 16) & 0xff;
  bytes[27] = (height - 1) & 0xff;
  bytes[28] = ((height - 1) >> 8) & 0xff;
  bytes[29] = ((height - 1) >> 16) & 0xff;
  return bytes;
}

/** HEIC brand box with an ispe box carrying 640x480. */
function heicBytes() {
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32BE(24, 0);
  Buffer.from('ftypmif1', 'ascii').copy(bytes, 4);
  Buffer.from('ispe', 'ascii').copy(bytes, 16);
  bytes.writeUInt32BE(640, 24);
  bytes.writeUInt32BE(480, 28);
  return bytes;
}

test('parsePixelSize accepts x, * and × separators', () => {
  assert.equal(parsePixelSize('1024x1536'), '1024x1536');
  assert.equal(parsePixelSize('1024*1536'), '1024x1536');
  assert.equal(parsePixelSize('1024×1536'), '1024x1536');
  assert.equal(parsePixelSize('  1024 x 1536  '), '1024x1536');
  assert.equal(parsePixelSize('2048X2048'), '2048x2048');
});

test('parsePixelSize rejects malformed sizes', () => {
  for (const bad of ['', '1024', 'x1536', '1024x', 'abcxdef', '10x10x10', '1024px']) {
    assert.throws(() => parsePixelSize(bad), /size must look like/, `expected ${JSON.stringify(bad)} to fail`);
  }
});

test('parsePixelSize enforces the pixel budget', () => {
  // 100x100 = 10,000 px, below the 655,360 minimum.
  assert.throws(() => parsePixelSize('100x100'), /covers 10000 pixels/);
  // 9000x9000 = 81,000,000 px, above the 20,000,000 maximum.
  assert.throws(() => parsePixelSize('9000x9000'), /covers 81000000 pixels/);
});

test('parsePixelSize enforces the 1:3 to 3:1 ratio', () => {
  // 512x2048 = 1,048,576 px (in budget) but a 4:1 ratio.
  assert.throws(() => parsePixelSize('512x2048'), /aspect ratio of 4\.00:1/);
  assert.equal(parsePixelSize('768x1536'), '768x1536');
});

test('validateAspectRatio accepts auto and well-formed ratios', () => {
  assert.equal(validateAspectRatio('auto'), 'auto');
  assert.equal(validateAspectRatio('16:9'), '16:9');
  assert.equal(validateAspectRatio('1:1'), '1:1');
  assert.equal(validateAspectRatio('300:300'), '300:300');
});

test('validateAspectRatio rejects bad shapes and out-of-range ratios', () => {
  assert.throws(() => validateAspectRatio('16x9'), /must be "auto" or "X:Y"/);
  assert.throws(() => validateAspectRatio('16:9:1'), /must be "auto" or "X:Y"/);
  assert.throws(() => validateAspectRatio('0:1'), /components must be integers from 1 to 300/);
  assert.throws(() => validateAspectRatio('301:1'), /components must be integers from 1 to 300/);
  assert.throws(() => validateAspectRatio('1:4'), /between 1:3 and 3:1/);
});

test('sniffMediaType recognises PNG, JPEG, WebP and HEIC', () => {
  assert.equal(sniffMediaType(pngBytes(200, 200)), 'image/png');
  assert.equal(sniffMediaType(jpegBytes()), 'image/jpeg');
  assert.equal(sniffMediaType(webpBytes(200, 200)), 'image/webp');
  assert.equal(sniffMediaType(heicBytes()), 'image/heic');
});

test('sniffMediaType returns undefined for unknown or short payloads', () => {
  assert.equal(sniffMediaType(Buffer.from('not an image at all')), undefined);
  assert.equal(sniffMediaType(Buffer.from([0x89, 0x50])), undefined);
  assert.equal(sniffMediaType(undefined), undefined);
});

test('readImageSize reads the PNG IHDR dimensions', () => {
  assert.deepEqual(readImageSize(pngBytes(1024, 768), 'image/png'), { width: 1024, height: 768 });
});

test('readImageSize reads the JPEG SOF0 dimensions', () => {
  assert.deepEqual(readImageSize(jpegBytes(), 'image/jpeg'), { width: 96, height: 64 });
});

test('readImageSize reads the WebP VP8X canvas dimensions', () => {
  assert.deepEqual(readImageSize(webpBytes(320, 200), 'image/webp'), { width: 320, height: 200 });
});

test('readImageSize reads the HEIC ispe dimensions', () => {
  assert.deepEqual(readImageSize(heicBytes(), 'image/heic'), { width: 640, height: 480 });
});

test('readImageSize tolerates truncated buffers instead of throwing', () => {
  assert.equal(readImageSize(Buffer.from([0x89, 0x50]), 'image/png'), undefined);
  assert.equal(readImageSize(Buffer.alloc(0), 'image/jpeg'), undefined);
});

test('normalizeImageArgs passes arrays through and splits newline strings', () => {
  const list = ['a.png', 'b.png'];
  assert.equal(normalizeImageArgs(list), list);
  assert.deepEqual(normalizeImageArgs('a.png\r\n\r\n b.png \n'), ['a.png', 'b.png']);
});

test('normalizeImageArgs rejects empty input', () => {
  assert.throws(() => normalizeImageArgs(''), /must be an array/);
  assert.throws(() => normalizeImageArgs('   \n  '), /must be an array/);
  assert.throws(() => normalizeImageArgs(undefined), /must be an array/);
});

test('buildReferenceImages keeps data URIs and public URLs as-is', async () => {
  const dataUri = 'data:image/png;base64,AAAA';
  const url = 'https://example.com/cat.png';
  assert.deepEqual(await buildReferenceImages([dataUri, url]), [
    { image_url: dataUri },
    { image_url: url },
  ]);
});

test('buildReferenceImages never touches the network for URLs', async () => {
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error('fetch must not be called');
  };
  try {
    await buildReferenceImages(['https://example.com/a.png']);
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(called, false);
});

test('buildReferenceImages rejects empty lists, empty entries and bad paths', async () => {
  await assert.rejects(() => buildReferenceImages([]), /between 1 and 16/);
  await assert.rejects(
    () => buildReferenceImages(Array.from({ length: 17 }, (_, i) => `https://example.com/${i}.png`)),
    /between 1 and 16/,
  );
  await assert.rejects(() => buildReferenceImages(['   ']), /must be a non-empty/);
  await assert.rejects(() => buildReferenceImages(['no/such/file.png']), /not a readable file/);
  await assert.rejects(() => buildReferenceImages('not-an-array'), /must be an array/);
});

test('buildReferenceImages embeds a local PNG as base64 and validates dimensions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'minimax-unit-'));
  const file = join(dir, 'ref.png');
  try {
    await writeFile(file, pngBytes(200, 300));
    const [image] = await buildReferenceImages([file]);
    assert.match(image.image_url, /^data:image\/png;base64,/);
    const decoded = Buffer.from(image.image_url.split(',')[1], 'base64');
    assert.equal(decoded.length, 33);

    const tiny = join(dir, 'tiny.png');
    await writeFile(tiny, pngBytes(64, 64));
    await assert.rejects(() => buildReferenceImages([tiny]), /at least 128px/);

    const wide = join(dir, 'wide.png');
    await writeFile(wide, pngBytes(1024, 200));
    await assert.rejects(() => buildReferenceImages([wide]), /aspect ratio must be at most 4:1/);

    const notImage = join(dir, 'notes.txt');
    await writeFile(notImage, 'hello');
    await assert.rejects(() => buildReferenceImages([notImage]), /not a supported image/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('sanitizeEndpoint accepts http(s) URLs and normalises trailing slashes', () => {
  assert.equal(sanitizeEndpoint('https://api.minimax.io/v1/'), 'https://api.minimax.io/v1');
  assert.equal(sanitizeEndpoint('  http://127.0.0.1:8080/v1///  '), 'http://127.0.0.1:8080/v1');
});

test('sanitizeEndpoint rejects non-http, hostless and control-character input', () => {
  for (const bad of ['ftp://api.minimax.io/v1', 'api.minimax.io/v1', 'https://', 'https:///v1', '']) {
    assert.equal(sanitizeEndpoint(bad), null, `expected ${JSON.stringify(bad)} to be rejected`);
  }
  assert.equal(sanitizeEndpoint('https://api.minimax.io/v1\u0000'), null);
  assert.equal(sanitizeEndpoint(undefined), null);
});

test('buildGenerationBody defaults to auto size, 1:1 and 2K', () => {
  const { body, n, outputFormat } = buildGenerationBody({ prompt: 'a cat' });
  assert.equal(n, 1);
  assert.equal(outputFormat, 'jpeg');
  assert.equal(body.prompt, 'a cat');
  assert.equal(body.size, 'auto');
  assert.equal(body.aspect_ratio, '1:1');
  assert.equal(body.area, '2K');
  assert.equal(body.output_compression, 95);
  assert.equal(body.disable_prompt_enhanced, false);
  assert.equal(body.model, 'MiniMax-H3-Image');
});

test('buildGenerationBody keeps size and aspect_ratio mutually exclusive', () => {
  const explicit = buildGenerationBody({ prompt: 'a cat', size: '1024x1536', aspect_ratio: '16:9' });
  assert.equal(explicit.body.size, '1024x1536');
  assert.equal('aspect_ratio' in explicit.body, false);
  assert.equal('area' in explicit.body, false);

  const derived = buildGenerationBody({ prompt: 'a cat', aspect_ratio: '16:9', area: '4k' });
  assert.equal(derived.body.size, 'auto');
  assert.equal(derived.body.aspect_ratio, '16:9');
  assert.equal(derived.body.area, '4K');
});

test('buildGenerationBody normalises format, compression and the highspeed model', () => {
  const jpeg = buildGenerationBody({ prompt: 'a', output_format: 'JPG', output_compression: 40 });
  assert.equal(jpeg.outputFormat, 'jpeg');
  assert.equal(jpeg.body.output_compression, 40);

  const png = buildGenerationBody({ prompt: 'a', output_format: 'png', highspeed: true });
  assert.equal(png.outputFormat, 'png');
  assert.equal('output_compression' in png.body, false);
  assert.equal(png.body.model, 'MiniMax-H3-Image-Highspeed');
});

test('buildGenerationBody rejects bad prompt, n, area, format and compression', () => {
  assert.throws(() => buildGenerationBody({ prompt: '   ' }), /prompt must not be empty/);
  assert.throws(() => buildGenerationBody({ prompt: 'x'.repeat(32001) }), /at most 32000/);
  assert.throws(() => buildGenerationBody({ prompt: 'a', n: 0 }), /n must be an integer from 1 to 10/);
  assert.throws(() => buildGenerationBody({ prompt: 'a', n: 11 }), /n must be an integer from 1 to 10/);
  assert.throws(() => buildGenerationBody({ prompt: 'a', n: 1.5 }), /n must be an integer/);
  assert.throws(() => buildGenerationBody({ prompt: 'a', area: '8K' }), /area must be 1K, 2K, or 4K/);
  assert.throws(() => buildGenerationBody({ prompt: 'a', output_format: 'gif' }), /jpeg, png, or webp/);
  assert.throws(() => buildGenerationBody({ prompt: 'a', output_compression: 101 }), /0 to 100/);
});

test('buildGenerationBody requires an explicit ratio when prompt_enhance is false', () => {
  assert.throws(
    () => buildGenerationBody({ prompt: 'a', prompt_enhance: false, aspect_ratio: 'auto' }),
    /aspect_ratio must be explicit/,
  );
  const ok = buildGenerationBody({ prompt: 'a', prompt_enhance: false, size: '1024x1024' });
  assert.equal(ok.body.disable_prompt_enhanced, true);
  assert.equal(ok.body.size, '1024x1024');
});

test('resolveEndpoint prefers saved settings over the environment and the default', () => {
  const saved = resolveEndpoint({ mode: 'io' }, 'https://api.minimax.cn/v1');
  assert.deepEqual(saved, { endpoint: 'https://api.minimax.io/v1', mode: 'io', source: 'settings' });

  const env = resolveEndpoint(undefined, 'https://proxy.example.com/v1');
  assert.deepEqual(env, { endpoint: 'https://proxy.example.com/v1', mode: 'custom', source: 'environment' });

  const fallback = resolveEndpoint(undefined, undefined);
  assert.deepEqual(fallback, { endpoint: 'https://api.minimax.cn/v1', mode: 'cn', source: 'default' });
});

test('resolveEndpoint handles a custom saved endpoint and ignores a bad saved mode', () => {
  assert.deepEqual(resolveEndpoint({ mode: 'custom', custom: 'https://proxy.example.com/v1' }, undefined), {
    endpoint: 'https://proxy.example.com/v1',
    mode: 'custom',
    source: 'settings',
  });
  // An unknown mode falls back to the environment, then to .cn.
  assert.equal(resolveEndpoint({ mode: 'bogus' }, undefined).source, 'default');
  assert.equal(resolveEndpoint({ mode: 'custom', custom: 'ftp://nope' }, undefined).source, 'default');
  // cn still honours the .cn preset even when a stale custom URL is stored.
  assert.deepEqual(resolveEndpoint({ mode: 'cn', custom: 'https://stale.example.com/v1' }, undefined), {
    endpoint: 'https://api.minimax.cn/v1',
    mode: 'cn',
    source: 'settings',
  });
});

test('settingsFilePath lives under <DSH home>/plugin-data', () => {
  const file = settingsFilePath('/home/tester');
  assert.match(file, /plugin-data[\\/]dsh-minimax-image[\\/]settings\.json$/);
});

test('saveEndpointConfig persists atomically and survives a restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'minimax-settings-'));
  const file = join(dir, 'nested', 'settings.json');
  try {
    const saved = await saveEndpointConfig('io', undefined, file);
    assert.equal(saved.endpoint, 'https://api.minimax.io/v1');

    // Reading the file back is what a restart does.
    assert.deepEqual(await readSettingsDocument(file), { mode: 'io' });

    const custom = await saveEndpointConfig('custom', 'https://proxy.example.com/v1/', file);
    assert.equal(custom.endpoint, 'https://proxy.example.com/v1');
    assert.deepEqual(await readSettingsDocument(file), {
      mode: 'custom',
      custom: 'https://proxy.example.com/v1',
    });

    // Switching back to a preset drops the stored custom URL.
    await saveEndpointConfig('cn', undefined, file);
    assert.deepEqual(await readSettingsDocument(file), { mode: 'cn' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('saveEndpointConfig rejects an invalid mode or custom URL with HTTP 400', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'minimax-settings-'));
  try {
    await assert.rejects(() => saveEndpointConfig('moon', undefined, join(dir, 's.json')), (error) => {
      assert.equal(error.statusCode, 400);
      return /"cn", "io", or "custom"/.test(error.message);
    });
    await assert.rejects(
      () => saveEndpointConfig('custom', 'ftp://nope', join(dir, 's.json')),
      (error) => {
        assert.equal(error.statusCode, 400);
        return /absolute http\(s\) URL/.test(error.message);
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readSettingsDocument tolerates a missing or corrupt file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'minimax-settings-'));
  try {
    assert.deepEqual(await readSettingsDocument(join(dir, 'missing.json')), {});
    const corrupt = join(dir, 'corrupt.json');
    await writeFile(corrupt, '{not json');
    assert.deepEqual(await readSettingsDocument(corrupt), {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('formatApiError carries the hint for the matching failure class', () => {
  const unauthorized = formatApiError(401, 'Unauthorized', { error: { message: 'bad key' } }, '', 'image generation');
  assert.match(unauthorized, /HTTP 401/);
  assert.match(unauthorized, /region-bound/);

  const broke = formatApiError(402, 'Payment Required', { error: { code: 1008, message: 'no balance' } }, '', 'image generation');
  assert.match(broke, /code 1008/);
  assert.match(broke, /no usable credit/);

  const safety = formatApiError(422, 'Unprocessable', { error: { code: 1027, message: 'blocked' } }, '', 'image edit');
  assert.match(safety, /content safety/);
  assert.match(safety, /image edit failed/);
});
