import { Buffer } from 'node:buffer';
import { mkdir, readFile, rename, stat as statFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Host half of the MiniMax H3-Image plugin.
 *
 * Zero-dependency on purpose: this bundle runs inside the DSH Host, where the
 * tool registry accepts a plain ToolDefinition object. The Client half is
 * shipped separately in ./client.js.
 */

const KEY_REF = 'MINIMAX_API_KEY';
const DEFAULT_API_BASE = 'https://api.minimax.cn/v1';
/** Region presets offered by the Endpoint dropdown in Settings > MiniMax Image. */
const REGION_ENDPOINTS = {
  cn: 'https://api.minimax.cn/v1',
  io: 'https://api.minimax.io/v1',
};
const SETTINGS_DIR_NAME = 'plugin-data';
const SETTINGS_PLUGIN_NAME = 'dsh-minimax-image';
const MODEL_STANDARD = 'MiniMax-H3-Image';
const MODEL_HIGHSPEED = 'MiniMax-H3-Image-Highspeed';
const REQUEST_TIMEOUT_MS = 660000;
const DOWNLOAD_TIMEOUT_MS = 120000;
const TEST_TIMEOUT_MS = 15000;

let hostCtx;

const MODEL_NOTE =
  'Every call is billed per generated image (n images). Generation is not idempotent: ' +
  'after a timeout or network error the server may still finish and bill the request, so never retry automatically.';

function service(ctx, name) {
  try {
    return typeof ctx.get === 'function' ? ctx.get(name) : ctx[name];
  } catch {
    return undefined;
  }
}

/** Per-user DSH state directory; DSH_HOME keeps portable installs working. */
function dshHomeDir() {
  const fromEnv = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : '';
  return fromEnv || join(homedir(), '.dsh');
}

function settingsFilePath(home) {
  return join(home || dshHomeDir(), SETTINGS_DIR_NAME, SETTINGS_PLUGIN_NAME, 'settings.json');
}

/**
 * Normalize a user-supplied endpoint into an absolute http(s) URL without a
 * trailing slash. Returns undefined for anything unusable so callers fall back.
 */
function sanitizeEndpoint(raw) {
  const value = typeof raw === 'string' ? raw.trim().replace(/\/+$/, '') : '';
  if (!value || !/^https?:\/\//i.test(value)) return null;
  // "https:///v1" makes WHATWG URL read "v1" as the host; treat it as the typo it is.
  if (/^https?:\/\/[\/\\]/i.test(value)) return null;
  // Reject control characters and interior whitespace: they never belong in a base URL
  // and would be silently percent-encoded by URL().
  if (/[\u0000-\u001f\u007f\s]/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.host ? value : null;
  } catch {
    return null;
  }
}

/**
 * Pure resolver for the request base URL.
 *
 * Precedence: endpoint saved from the settings page > MINIMAX_API_BASE > .cn.
 * The saved value deliberately wins so a region picked in the UI is not
 * silently overridden by a leftover environment variable.
 */
function resolveEndpoint(config, envValue) {
  const mode =
    config && (config.mode === 'cn' || config.mode === 'io' || config.mode === 'custom')
      ? config.mode
      : undefined;
  if (mode === 'cn' || mode === 'io') {
    return { endpoint: REGION_ENDPOINTS[mode], mode, source: 'settings' };
  }
  if (mode === 'custom') {
    const custom = sanitizeEndpoint(config.custom);
    if (custom) return { endpoint: custom, mode, source: 'settings' };
  }
  const fromEnv = sanitizeEndpoint(envValue);
  if (fromEnv) return { endpoint: fromEnv, mode: 'custom', source: 'environment' };
  return { endpoint: DEFAULT_API_BASE, mode: 'cn', source: 'default' };
}

let endpointCache;

async function readSettingsDocument(file) {
  try {
    const text = await readFile(file || settingsFilePath(), 'utf8');
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Atomic write: a crash mid-save cannot truncate the settings file. */
async function writeSettingsDocument(next, file) {
  const target = file || settingsFilePath();
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  await rename(temporary, target);
}

/** Resolved endpoint for this process; cached after the first read. */
async function currentEndpoint() {
  if (!endpointCache) {
    endpointCache = resolveEndpoint(await readSettingsDocument(), process.env.MINIMAX_API_BASE);
  }
  return endpointCache;
}

async function describeEndpoint() {
  const resolved = await currentEndpoint();
  const saved = await readSettingsDocument();
  return {
    ...resolved,
    presets: { ...REGION_ENDPOINTS },
    custom: sanitizeEndpoint(saved.custom) || null,
    environment: sanitizeEndpoint(process.env.MINIMAX_API_BASE) || null,
  };
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

/** Persist the region picked in the settings page and refresh the cache. */
async function saveEndpointConfig(mode, custom, file) {
  if (mode !== 'cn' && mode !== 'io' && mode !== 'custom') {
    throw badRequest('endpoint mode must be "cn", "io", or "custom"');
  }
  let customEndpoint;
  if (mode === 'custom') {
    customEndpoint = sanitizeEndpoint(custom);
    if (!customEndpoint) {
      throw badRequest(
        'custom endpoint must be an absolute http(s) URL, for example https://api.minimax.io/v1',
      );
    }
  }
  const existing = await readSettingsDocument(file);
  const next = { ...existing, mode };
  if (customEndpoint) next.custom = customEndpoint;
  else delete next.custom;
  await writeSettingsDocument(next, file);
  endpointCache = resolveEndpoint(next, process.env.MINIMAX_API_BASE);
  return describeEndpoint();
}

function isPlainInteger(value) {
  return typeof value === 'number' && Number.isInteger(value);
}

function validateAspectRatio(raw) {
  if (raw === 'auto') return raw;
  const match = /^(\d{1,3}):(\d{1,3})$/.exec(raw);
  if (!match) {
    throw new Error('aspect_ratio must be "auto" or "X:Y" with integers from 1 to 300, for example "16:9".');
  }
  const x = Number(match[1]);
  const y = Number(match[2]);
  if (x < 1 || y < 1 || x > 300 || y > 300) {
    throw new Error('aspect_ratio components must be integers from 1 to 300.');
  }
  const ratio = x / y;
  if (ratio < 1 / 3 || ratio > 3) {
    throw new Error('aspect_ratio must stay between 1:3 and 3:1.');
  }
  return `${x}:${y}`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return 'unknown size';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function mediaTypeFor(format) {
  if (format === 'png') return 'image/png';
  if (format === 'webp') return 'image/webp';
  return 'image/jpeg';
}

function normalizeMediaType(contentType, format) {
  const ct = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (ct === 'image/jpg') return 'image/jpeg';
  if (ct === 'image/png' || ct === 'image/jpeg' || ct === 'image/webp' || ct === 'image/gif') {
    return ct;
  }
  return mediaTypeFor(format);
}

function extensionFor(mediaType) {
  if (mediaType === 'image/png') return 'png';
  if (mediaType === 'image/webp') return 'webp';
  if (mediaType === 'image/gif') return 'gif';
  return 'jpg';
}

function deadlineSignal(signal, milliseconds) {
  const timeout = AbortSignal.timeout(milliseconds);
  if (!signal) return timeout;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, timeout]);
  return timeout;
}

function taggedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function errorCode(value) {
  if (value === undefined || value === null) return undefined;
  return String(value);
}

function apiErrorHint(status, code) {
  if (status === 401) {
    return (
      ' The key was rejected (HTTP 401). Keys are region-bound: a key created on platform.minimaxi.com ' +
      'works only with https://api.minimax.cn/v1, and one created on platform.minimax.io only with ' +
      'https://api.minimax.io/v1. Open Settings > MiniMax Image, pick the matching region in the Endpoint ' +
      'dropdown, then press Test connection.'
    );
  }
  if (status === 402 || code === '1008' || code === '2053' || code === '2067' || code === '2068') {
    return (
      ' The MiniMax account has no usable credit. Top up in the console (China: 控制台 > 费用管理 > ' +
      '账户钱包 > 立即充值; international: Billing > Wallet) and try again. Billing is per generated ' +
      'image, about ¥0.1 for one 1K image.'
    );
  }
  if (code === '2022') {
    return (
      ' This key is not allowed to use the image model. Enable MiniMax-H3-Image for the account, ' +
      'or verify the model id is MiniMax-H3-Image / MiniMax-H3-Image-Highspeed.'
    );
  }
  if (status === 429 && code === '1002') {
    return ' Rate limit reached; each request counts n images. Retry later.';
  }
  if (status === 429 && code === '2056') {
    return ' The MiniMax plan quota is exhausted.';
  }
  if (status === 429) {
    return ' Rate limited by MiniMax; retry later.';
  }
  if (status === 422 || code === '1026' || code === '1027') {
    return (
      ' MiniMax content safety rejected this request (1026 = the input prompt or image, ' +
      '1027 = the generated image). Rephrase the prompt or use a different reference image, ' +
      'then send a new call yourself - retries are never issued automatically.'
    );
  }
  if (status >= 500) {
    return ' MiniMax reported a server error; try again later.';
  }
  return '';
}

function parseJson(text) {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function formatApiError(status, statusText, payload, rawText, label) {
  const operation = label || 'image generation';
  const error = payload && typeof payload === 'object' ? payload.error : undefined;
  const code = errorCode(error && error.code !== undefined ? error.code : payload && payload.code);
  const message =
    (error && typeof error.message === 'string' && error.message) ||
    (typeof rawText === 'string' && rawText.trim()) ||
    statusText ||
    'unknown error';
  const requestId =
    (payload && typeof payload.request_id === 'string' && payload.request_id) || undefined;
  return (
    `MiniMax ${operation} failed (HTTP ${status}${code ? `, code ${code}` : ''}): ` +
    `${message.slice(0, 800)}` +
    `${requestId ? ` [request_id: ${requestId}]` : ''}` +
    apiErrorHint(status, code)
  );
}

const MAX_REFERENCE_COUNT = 16;
const MAX_REFERENCE_BYTES = 64 * 1024 * 1024;
const MAX_REQUEST_BYTES = 64 * 1024 * 1024;

function sniffMediaType(bytes) {
  if (!bytes || bytes.length < 12) return undefined;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  if (bytes.toString('ascii', 4, 8) === 'ftyp') {
    const brand = bytes.toString('ascii', 8, 12).toLowerCase();
    if (brand === 'mif1' || brand.startsWith('hei') || brand.startsWith('hev')) return 'image/heic';
  }
  return undefined;
}

function describeSource(source) {
  return source.length > 120 ? `${source.slice(0, 60)}...${source.slice(-40)}` : source;
}

const MIN_REFERENCE_SIDE = 128;
const MAX_REFERENCE_SIDE = 8192;
const MAX_REFERENCE_RATIO = 4;

const MIN_OUTPUT_PIXELS = 655360;
const MAX_OUTPUT_PIXELS = 20000000;
const MAX_OUTPUT_RATIO = 3;

function readJpegSize(bytes) {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return undefined;
    const length = bytes.readUInt16BE(offset + 2);
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    if (length < 2) return undefined;
    offset += 2 + length;
  }
  return undefined;
}

function readWebpSize(bytes) {
  const chunk = bytes.toString('ascii', 12, 16);
  if (chunk === 'VP8X' && bytes.length >= 30) {
    return {
      width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)),
      height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)),
    };
  }
  if (chunk === 'VP8 ' && bytes.length >= 30) {
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L' && bytes.length >= 25) {
    const bits = bytes.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return undefined;
}

function readHeifSize(bytes) {
  const index = bytes.indexOf(Buffer.from('ispe', 'ascii'));
  if (index < 0 || index + 16 > bytes.length) return undefined;
  return { width: bytes.readUInt32BE(index + 8), height: bytes.readUInt32BE(index + 12) };
}

function readImageSize(bytes, mediaType) {
  try {
    if (mediaType === 'image/png' && bytes.length >= 24) {
      return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    }
    if (mediaType === 'image/jpeg') return readJpegSize(bytes);
    if (mediaType === 'image/webp') return readWebpSize(bytes);
    if (mediaType === 'image/heic') return readHeifSize(bytes);
  } catch {
    return undefined;
  }
  return undefined;
}

function validateReferenceDimensions(size, index, source) {
  if (!size || !size.width || !size.height) return;
  const { width, height } = size;
  const ratio = Math.max(width, height) / Math.min(width, height);
  const problems = [];
  if (width < MIN_REFERENCE_SIDE || height < MIN_REFERENCE_SIDE) {
    problems.push(`each side must be at least ${MIN_REFERENCE_SIDE}px`);
  }
  if (width > MAX_REFERENCE_SIDE || height > MAX_REFERENCE_SIDE) {
    problems.push(`each side must be at most ${MAX_REFERENCE_SIDE}px`);
  }
  if (ratio > MAX_REFERENCE_RATIO) {
    problems.push(`the aspect ratio must be at most ${MAX_REFERENCE_RATIO}:1`);
  }
  if (problems.length > 0) {
    throw new Error(`images[${index}] is ${width}x${height}; ${problems.join('; ')} (${describeSource(source)})`);
  }
}

function parsePixelSize(raw) {
  const match = /^(\d{2,5})\s*[x*×]\s*(\d{2,5})$/i.exec(String(raw).trim());
  if (!match) throw new Error('size must look like "1024x1536" (width x height in pixels).');
  const width = Number(match[1]);
  const height = Number(match[2]);
  const pixels = width * height;
  if (pixels < MIN_OUTPUT_PIXELS || pixels > MAX_OUTPUT_PIXELS) {
    throw new Error(
      `size ${width}x${height} covers ${pixels} pixels; MiniMax allows ${MIN_OUTPUT_PIXELS} to ${MAX_OUTPUT_PIXELS}.`,
    );
  }
  const ratio = Math.max(width, height) / Math.min(width, height);
  if (ratio > MAX_OUTPUT_RATIO) {
    throw new Error(
      `size ${width}x${height} has an aspect ratio of ${ratio.toFixed(2)}:1; MiniMax allows 1:3 to 3:1.`,
    );
  }
  return `${width}x${height}`;
}

/**
 * Turn the caller's reference images into the `images` array the edits endpoint expects.
 * Entries may be local file paths, public http(s) URLs, or ready-made data URIs.
 */
async function buildReferenceImages(sources) {
  if (!Array.isArray(sources)) throw new Error('images must be an array of file paths, URLs, or data URIs.');
  if (sources.length < 1 || sources.length > MAX_REFERENCE_COUNT) {
    throw new Error(`images must contain between 1 and ${MAX_REFERENCE_COUNT} entries.`);
  }

  const images = [];
  let encodedBytes = 0;

  for (let index = 0; index < sources.length; index += 1) {
    const raw = typeof sources[index] === 'string' ? sources[index].trim() : '';
    if (!raw) throw new Error(`images[${index}] must be a non-empty file path, URL, or data URI.`);

    if (/^data:image\//i.test(raw)) {
      encodedBytes += raw.length;
      images.push({ image_url: raw });
      continue;
    }
    if (/^https?:\/\//i.test(raw)) {
      images.push({ image_url: raw });
      continue;
    }

    let info;
    try {
      info = await statFile(raw);
    } catch (error) {
      throw new Error(`images[${index}] is not a readable file: ${describeSource(raw)}`);
    }
    if (!info.isFile()) throw new Error(`images[${index}] is not a file: ${describeSource(raw)}`);
    if (info.size > MAX_REFERENCE_BYTES) {
      throw new Error(
        `images[${index}] is ${formatBytes(info.size)}, above the ${formatBytes(MAX_REFERENCE_BYTES)} limit ` +
          'for a single reference image',
      );
    }

    const bytes = await readFile(raw);
    const mediaType = sniffMediaType(bytes);
    if (!mediaType) {
      throw new Error(
        `images[${index}] is not a supported image (JPG, PNG, WEBP, HEIC, or HEIF): ${describeSource(raw)}`,
      );
    }
    validateReferenceDimensions(readImageSize(bytes, mediaType), index, raw);
    encodedBytes += Math.ceil(bytes.length * 4 / 3);
    if (encodedBytes > MAX_REQUEST_BYTES) {
      throw new Error(
        `the reference images exceed the ${formatBytes(MAX_REQUEST_BYTES)} request body limit after base64 encoding; ` +
          'use fewer images or pass public URLs',
      );
    }
    images.push({ image_url: `data:${mediaType};base64,${bytes.toString('base64')}` });
  }

  return images;
}

async function readApiKey() {
  const credentials = service(hostCtx, 'credentials');
  if (!credentials) {
    throw new Error('The credentials service is unavailable; cannot read MINIMAX_API_KEY.');
  }
  let apiKey;
  try {
    const resolved = await credentials.resolve(KEY_REF);
    apiKey = resolved && typeof resolved.value === 'string' ? resolved.value.trim() : '';
  } catch (error) {
    throw new Error(`Could not read the MiniMax API key: ${error && error.message ? error.message : String(error)}`);
  }
  if (!apiKey) {
    throw new Error(
      'MiniMax API key is not configured. Open Settings > MiniMax Image and save a key, ' +
        'or set the MINIMAX_API_KEY environment variable.',
    );
  }
  return apiKey;
}

/**
 * Cheap credential probe for the settings page.
 *
 * The free model-list endpoint sits behind the same gateway as the image
 * endpoints, so a 200 there proves the key is accepted for the configured
 * endpoint without generating (and billing) an image. A 401 means the key is
 * invalid, revoked, or belongs to another region.
 */
async function testConnection() {
  const startedAt = Date.now();
  const { endpoint } = await currentEndpoint();
  let apiKey;
  try {
    apiKey = await readApiKey();
  } catch (error) {
    return {
      ok: false,
      reason: 'missing',
      endpoint,
      message: error && error.message ? error.message : String(error),
    };
  }

  let response;
  try {
    response = await fetch(`${endpoint}/models`, {
      method: 'GET',
      headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
      signal: deadlineSignal(undefined, TEST_TIMEOUT_MS),
    });
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    return {
      ok: false,
      reason: 'network',
      endpoint,
      latencyMs: Date.now() - startedAt,
      message: `Could not reach ${endpoint}: ${message}`,
    };
  }

  const text = await response.text();
  const payload = parseJson(text);
  const latencyMs = Date.now() - startedAt;

  if (response.ok) {
    const models = payload && Array.isArray(payload.data) ? payload.data : [];
    const imageModels = models
      .map((model) => (model && typeof model.id === 'string' ? model.id : ''))
      .filter((id) => id === MODEL_STANDARD || id === MODEL_HIGHSPEED);
    return {
      ok: true,
      reason: 'ok',
      endpoint,
      latencyMs,
      modelCount: models.length,
      imageModels,
    };
  }

  return {
    ok: false,
    reason: response.status === 401 ? 'unauthorized' : 'error',
    status: response.status,
    endpoint,
    latencyMs,
    message: formatApiError(response.status, response.statusText, payload, text, 'connection test'),
  };
}

async function loadImageBytes(attachments, item, format, signal) {
  if (typeof item.b64_json === 'string' && item.b64_json) {
    const data = Buffer.from(item.b64_json, 'base64');
    // The API can return a different format than the one requested, so the
    // bytes win over the requested format.
    return {
      data,
      mediaType: sniffMediaType(data) || mediaTypeFor(format),
      url: undefined,
    };
  }
  if (typeof item.url !== 'string' || item.url.length === 0) {
    throw taggedError('NO_IMAGE_DATA', 'the response item contains neither url nor b64_json');
  }

  let response;
  try {
    response = await fetch(item.url, {
      method: 'GET',
      redirect: 'follow',
      signal: deadlineSignal(signal, DOWNLOAD_TIMEOUT_MS),
    });
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw taggedError('DOWNLOAD_ABORTED', 'the image download was cancelled or timed out');
    }
    throw taggedError('DOWNLOAD_FAILED', `image download failed: ${error && error.message ? error.message : String(error)}`);
  }
  if (!response.ok) {
    throw taggedError('DOWNLOAD_FAILED', `image download failed with HTTP ${response.status}`);
  }

  const maxBytes = attachments.imageLimits && attachments.imageLimits.maxImageBytes;
  const declared = Number(response.headers.get('content-length') || 0);
  if (maxBytes && declared > maxBytes) {
    throw taggedError(
      'IMAGE_TOO_LARGE',
      `the generated image is ${formatBytes(declared)}, above the attachment limit of ${formatBytes(maxBytes)}; ` +
        'use jpeg, webp, or a smaller area',
    );
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (maxBytes && bytes.byteLength > maxBytes) {
    throw taggedError(
      'IMAGE_TOO_LARGE',
      `the generated image is ${formatBytes(bytes.byteLength)}, above the attachment limit of ${formatBytes(maxBytes)}; ` +
        'use jpeg, webp, or a smaller area',
    );
  }

  return {
    data: bytes,
    mediaType:
      sniffMediaType(bytes) || normalizeMediaType(response.headers.get('content-type'), format),
    url: item.url,
  };
}

async function persistImage(attachments, loaded, name) {
  try {
    return await attachments.saveImage({
      data: loaded.data,
      mediaType: loaded.mediaType,
      name,
    });
  } catch (error) {
    throw taggedError('SAVE_FAILED', `could not persist the generated image: ${error && error.message ? error.message : String(error)}`);
  }
}

function renderResult(_args, value) {
  const lines = [];
  lines.push(
    `Generated ${value.images.length} of ${value.requested} requested image(s) with ${value.model}.`,
  );
  if (value.requestId) lines.push(`request_id: ${value.requestId}`);
  value.images.forEach((image, index) => {
    const ref = image.attachment || {};
    const dimensions =
      Number.isFinite(ref.width) && Number.isFinite(ref.height)
        ? `${ref.width}x${ref.height}`
        : 'unknown dimensions';
    lines.push(
      `image ${index + 1}: ${dimensions}, ${ref.mediaType || value.outputFormat}, ${formatBytes(ref.bytes)}`,
    );
  });
  if (value.failures.length > 0) {
    lines.push(`Failed image(s): ${value.failures.length}`);
    value.failures.forEach((failure) => {
      lines.push(`  image ${failure.index + 1}: ${failure.code} - ${failure.message}`);
    });
  }
  value.revisedPrompts.forEach((prompt, index) => {
    if (prompt) lines.push(`revised prompt ${index + 1}: ${String(prompt).slice(0, 300)}`);
  });

  const blocks = [{ type: 'text', text: lines.join('\n') }];
  value.images.forEach((image) => {
    if (image.attachment) blocks.push({ type: 'image', attachment: image.attachment });
  });
  return blocks;
}

/**
 * Validate `minimax_generate_image` arguments and build the request body.
 * Kept pure (no services, no I/O) so the size/aspect_ratio contract is testable.
 */
function buildGenerationBody(args) {
  const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
  if (!prompt) throw new Error('prompt must not be empty.');
  if (prompt.length > 32000) throw new Error('prompt must be at most 32000 characters.');

  const n = args.n === undefined ? 1 : args.n;
  if (!isPlainInteger(n) || n < 1 || n > 10) throw new Error('n must be an integer from 1 to 10.');

  const explicitSize =
    args.size === undefined || args.size === null || String(args.size).trim() === ''
      ? undefined
      : parsePixelSize(args.size);

  const aspectRatio = explicitSize
    ? undefined
    : validateAspectRatio(args.aspect_ratio === undefined ? '1:1' : String(args.aspect_ratio).trim());
  const area = explicitSize
    ? undefined
    : (args.area === undefined ? '2K' : String(args.area).trim().toUpperCase());
  if (!explicitSize && area !== '1K' && area !== '2K' && area !== '4K') {
    throw new Error('area must be 1K, 2K, or 4K.');
  }

  const rawFormat = args.output_format === undefined ? 'jpeg' : String(args.output_format).trim().toLowerCase();
  const outputFormat = rawFormat === 'jpg' ? 'jpeg' : rawFormat;
  if (outputFormat !== 'jpeg' && outputFormat !== 'png' && outputFormat !== 'webp') {
    throw new Error('output_format must be jpeg, png, or webp.');
  }

  const promptEnhance = args.prompt_enhance !== false;
  if (!promptEnhance && !explicitSize && aspectRatio === 'auto') {
    throw new Error('aspect_ratio must be explicit when prompt_enhance is false.');
  }

  const compression = args.output_compression === undefined ? 95 : args.output_compression;
  if (!isPlainInteger(compression) || compression < 0 || compression > 100) {
    throw new Error('output_compression must be an integer from 0 to 100.');
  }

  const body = {
    model: args.highspeed === true ? MODEL_HIGHSPEED : MODEL_STANDARD,
    prompt,
    n,
    output_format: outputFormat,
    response_format: 'url',
    stream: false,
    disable_prompt_enhanced: !promptEnhance,
    aigc_watermark: args.aigc_watermark === true,
  };
  if (explicitSize) {
    body.size = explicitSize;
  } else {
    body.size = 'auto';
    body.aspect_ratio = aspectRatio;
    body.area = area;
  }
  if (outputFormat !== 'png') body.output_compression = compression;

  return { body, n, outputFormat };
}

const definition = {
  name: 'minimax_generate_image',
  description:
    'Generate raster images from a text prompt with MiniMax H3-Image. Use this when the user asks for a picture, ' +
    'illustration, poster, concept art, product shot, or any other image. The tool saves the generated images and ' +
    'returns them as image content plus a text summary. ' +
    MODEL_NOTE +
    ' Requires a MiniMax API key configured in Settings > MiniMax Image (credential MINIMAX_API_KEY).',
  parameters: {
    prompt: {
      type: 'string',
      required: true,
      description: 'What to draw. Up to 32000 characters; ignored after roughly 4096 tokens when prompt_enhance is false.',
    },
    size: {
      type: 'string',
      description:
        'Exact output size as "WxH" pixels, e.g. "1024x1536". Overrides aspect_ratio and area; total pixels must be ' +
        '655360-20000000 and the ratio within 1:3-3:1.',
    },
    n: {
      type: 'integer',
      description: 'Number of images to generate, 1-10. Default 1. Each image is billed separately.',
    },
    aspect_ratio: {
      type: 'string',
      description: 'Output aspect ratio: "auto" or "X:Y" with integers 1-300, between 1:3 and 3:1. Default "1:1". Ignored when size is set.',
    },
    area: {
      type: 'string',
      description: 'Output area when aspect_ratio is used: 1K, 2K, or 4K. Default 2K.',
    },
    output_format: {
      type: 'string',
      description: 'Image format: jpeg, png, or webp. Default jpeg.',
    },
    output_compression: {
      type: 'integer',
      description: 'Compression quality 0-100 for jpeg/webp. Default 95.',
    },
    prompt_enhance: {
      type: 'boolean',
      description: 'Let MiniMax enhance the prompt. Default true. When false, aspect_ratio must not be "auto".',
    },
    aigc_watermark: {
      type: 'boolean',
      description: 'Add an explicit AIGC watermark. Default false; implicit AIGC metadata is always written.',
    },
    highspeed: {
      type: 'boolean',
      description: 'Use MiniMax-H3-Image-Highspeed instead of MiniMax-H3-Image. Default false.',
    },
  },
  output: {
    schema: { type: 'object' },
    render: renderResult,
    presentationMeta: (args, value) => ({
      requestId: value.requestId,
      model: value.model,
      requested: value.requested,
      area: args.area,
      aspectRatio: args.aspect_ratio,
      outputFormat: value.outputFormat,
      revisedPrompts: value.revisedPrompts,
      images: value.images.map((image) => ({ attachment: image.attachment, url: image.url })),
      failures: value.failures,
    }),
  },
  timeoutMs: REQUEST_TIMEOUT_MS,
  isConcurrencySafe: () => false,
  async execute(args, exec) {
    const { body, n, outputFormat } = buildGenerationBody(args);

    const apiKey = await readApiKey();

    const attachments = service(hostCtx, 'attachments');
    if (!attachments) {
      throw new Error('The attachments service is unavailable; generated images cannot be stored.');
    }

    const { endpoint: apiBase } = await currentEndpoint();

    return runImageRequest({
      endpoint: `${apiBase}/images/generations`,
      operation: 'image generation',
      body,
      apiKey,
      n,
      outputFormat,
      exec,
      attachments,
    });
  },
};

async function runImageRequest({ endpoint, operation, body, apiKey, n, outputFormat, exec, attachments }) {
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: deadlineSignal(exec.signal, REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new Error(
        `MiniMax ${operation} was cancelled or timed out. The request may still have been accepted and billed; ` +
          'do not retry automatically.',
      );
    }
    throw new Error(
      `MiniMax ${operation} request failed: ${error && error.message ? error.message : String(error)}. ` +
        'The request may have been accepted and billed; do not retry automatically.',
    );
  }

  const rawText = await response.text();
  const payload = parseJson(rawText);
  if (!response.ok) {
    throw new Error(formatApiError(response.status, response.statusText, payload, rawText, operation));
  }

  const data = payload && Array.isArray(payload.data) ? payload.data : [];
  const requestId =
    payload && typeof payload.request_id === 'string' && payload.request_id
      ? payload.request_id
      : undefined;
  const responseFormat =
    payload && typeof payload.output_format === 'string' && payload.output_format
      ? payload.output_format
      : outputFormat;

  const images = [];
  const failures = [];
  const revisedPrompts = [];

  for (let index = 0; index < n; index += 1) {
    const item = data[index];
    if (!item) {
      failures.push({ index, code: 'MISSING_IMAGE', message: 'the response did not contain this image' });
      continue;
    }
    if (item.error) {
      failures.push({
        index,
        code: errorCode(item.error.code) || 'IMAGE_FAILED',
        message: typeof item.error.message === 'string' ? item.error.message : 'image generation failed',
      });
      continue;
    }

    revisedPrompts.push(typeof item.revised_prompt === 'string' ? item.revised_prompt : null);

    try {
      const loaded = await loadImageBytes(attachments, item, responseFormat, exec.signal);
      const safeId = String(requestId || Date.now()).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
      const name = `minimax-${safeId}-${index + 1}.${extensionFor(loaded.mediaType)}`;
      const ref = await persistImage(attachments, loaded, name);
      images.push({ attachment: ref, url: loaded.url });
    } catch (error) {
      failures.push({
        index,
        code: error && error.code ? String(error.code) : 'IMAGE_FAILED',
        message: error && error.message ? error.message : String(error),
      });
    }
  }

  if (images.length === 0) {
    const detail = failures.length
      ? failures.map((failure) => `image ${failure.index + 1}: ${failure.code} - ${failure.message}`).join('; ')
      : 'no images were returned';
    throw new Error(
      `MiniMax ${operation} produced no usable images${requestId ? ` [request_id: ${requestId}]` : ''}: ${detail}`,
    );
  }

  return {
    requestId,
    model: body.model,
    requested: n,
    outputFormat: responseFormat,
    images,
    failures,
    revisedPrompts,
  };
}

function normalizeImageArgs(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }
  throw new Error('images must be an array of file paths, URLs, or data URIs (one per entry or per line).');
}

const editDefinition = {
  name: 'minimax_edit_image',
  description:
    'Edit existing images with MiniMax H3-Image (image-to-image). Use this when the user wants to modify, restyle, ' +
    'combine, or redraw images they already have. Reference images may be local file paths (uploaded inline as ' +
    'base64), public http(s) URLs, or data URIs; results are saved as image attachments. Image editing always ' +
    'enables MiniMax prompt enhancement, so the returned revised_prompt is usually richer than the input prompt. ' +
    MODEL_NOTE +
    ' Requires a MiniMax API key configured in Settings > MiniMax Image (credential MINIMAX_API_KEY).',
  parameters: {
    prompt: {
      type: 'string',
      required: true,
      description:
        'What to change or produce from the reference images, e.g. "put the apple in a glass bowl on a wooden table".',
    },
    images: {
      type: 'array',
      required: true,
      items: { type: 'string' },
      description:
        '1-16 reference images in order. Each entry is a local file path, an http(s) URL, or a data:image/... URI. ' +
        'Local files are uploaded as base64; a newline-separated string is also accepted.',
    },
    size: {
      type: 'string',
      description:
        'Exact output size as "WxH" pixels, e.g. "1024x1536". Overrides aspect_ratio and area; total pixels must be ' +
        '655360-20000000 and the ratio within 1:3-3:1.',
    },
    n: {
      type: 'integer',
      description: 'Number of images to generate, 1-10. Default 1. Each image is billed separately.',
    },
    aspect_ratio: {
      type: 'string',
      description: 'Output aspect ratio: "auto" or "X:Y" with integers 1-300, between 1:3 and 3:1. Default "auto". Ignored when size is set.',
    },
    area: {
      type: 'string',
      description: 'Output area when aspect_ratio is used: 1K, 2K, or 4K. Default 2K.',
    },
    output_format: {
      type: 'string',
      description: 'Image format: jpeg, png, or webp. Default jpeg.',
    },
    output_compression: {
      type: 'integer',
      description: 'Compression quality 0-100 for jpeg/webp. Default 95.',
    },
    aigc_watermark: {
      type: 'boolean',
      description: 'Add an explicit AIGC watermark. Default false; implicit AIGC metadata is always written.',
    },
    highspeed: {
      type: 'boolean',
      description: 'Use MiniMax-H3-Image-Highspeed instead of MiniMax-H3-Image. Default false.',
    },
  },
  output: {
    schema: { type: 'object' },
    render: renderResult,
    presentationMeta: (args, value) => ({
      requestId: value.requestId,
      model: value.model,
      requested: value.requested,
      area: args.area,
      aspectRatio: args.aspect_ratio,
      outputFormat: value.outputFormat,
      revisedPrompts: value.revisedPrompts,
      images: value.images.map((image) => ({ attachment: image.attachment, url: image.url })),
      failures: value.failures,
    }),
  },
  timeoutMs: REQUEST_TIMEOUT_MS,
  isConcurrencySafe: () => false,
  async execute(args, exec) {
    const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
    if (!prompt) throw new Error('prompt must not be empty.');
    if (prompt.length > 32000) throw new Error('prompt must be at most 32000 characters.');

    const images = await buildReferenceImages(normalizeImageArgs(args.images));

    const n = args.n === undefined ? 1 : args.n;
    if (!isPlainInteger(n) || n < 1 || n > 10) throw new Error('n must be an integer from 1 to 10.');

    const explicitSize =
      args.size === undefined || args.size === null || String(args.size).trim() === ''
        ? undefined
        : parsePixelSize(args.size);

    const aspectRatio = explicitSize
      ? undefined
      : validateAspectRatio(args.aspect_ratio === undefined ? 'auto' : String(args.aspect_ratio).trim());
    const area = explicitSize
      ? undefined
      : (args.area === undefined ? '2K' : String(args.area).trim().toUpperCase());
    if (!explicitSize && area !== '1K' && area !== '2K' && area !== '4K') {
      throw new Error('area must be 1K, 2K, or 4K.');
    }

    const rawFormat = args.output_format === undefined ? 'jpeg' : String(args.output_format).trim().toLowerCase();
    const outputFormat = rawFormat === 'jpg' ? 'jpeg' : rawFormat;
    if (outputFormat !== 'jpeg' && outputFormat !== 'png' && outputFormat !== 'webp') {
      throw new Error('output_format must be jpeg, png, or webp.');
    }

    const compression = args.output_compression === undefined ? 95 : args.output_compression;
    if (!isPlainInteger(compression) || compression < 0 || compression > 100) {
      throw new Error('output_compression must be an integer from 0 to 100.');
    }

    const apiKey = await readApiKey();

    const attachments = service(hostCtx, 'attachments');
    if (!attachments) {
      throw new Error('The attachments service is unavailable; generated images cannot be stored.');
    }

    const { endpoint: apiBase } = await currentEndpoint();

    const body = {
      model: args.highspeed === true ? MODEL_HIGHSPEED : MODEL_STANDARD,
      prompt,
      images,
      n,
      output_format: outputFormat,
      response_format: 'url',
      stream: false,
      aigc_watermark: args.aigc_watermark === true,
    };
    if (explicitSize) {
      body.size = explicitSize;
    } else {
      body.size = 'auto';
      body.aspect_ratio = aspectRatio;
      body.area = area;
    }
    if (outputFormat !== 'png') body.output_compression = compression;

    return runImageRequest({
      endpoint: `${apiBase}/images/edits`,
      operation: 'image edit',
      body,
      apiKey,
      n,
      outputFormat,
      exec,
      attachments,
    });
  },
};

export const inject = ['tools'];

const CREDENTIAL_PATH = '/minimax-image/credential';
const MAX_CREDENTIAL_BODY = 8192;

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

async function readCredentialBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_CREDENTIAL_BODY) {
      const error = new Error('request body too large');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error('invalid JSON body');
    error.statusCode = 400;
    throw error;
  }
}

async function handleCredentialRequest(req, res) {
  const headers = req.headers || {};
  // Same-origin guard: the settings page is the only intended caller. A browser
  // sends Origin on a cross-origin POST; compare its host with the request Host.
  const origin = String(headers.origin || '');
  if (origin) {
    let originHost = '';
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = '';
    }
    if (originHost !== String(headers.host || '')) {
      return sendJson(res, 403, { ok: false, error: 'forbidden origin' });
    }
  }
  if (headers['sec-fetch-site'] && headers['sec-fetch-site'] !== 'same-origin') {
    return sendJson(res, 403, { ok: false, error: 'forbidden request site' });
  }
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST');
    return sendJson(res, 405, { ok: false, error: 'method not allowed' });
  }
  const contentType = String(headers['content-type'] || '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    return sendJson(res, 415, { ok: false, error: 'application/json required' });
  }

  let body;
  try {
    body = await readCredentialBody(req);
  } catch (error) {
    return sendJson(res, error.statusCode || 400, {
      ok: false,
      error: error && error.message ? error.message : 'invalid request body',
    });
  }

  const credentials = service(hostCtx, 'credentials');
  const action = body && body.action;
  try {
    if (action === 'describe') {
      if (!credentials || typeof credentials.describe !== 'function') {
        return sendJson(res, 503, { ok: false, error: 'credentials service unavailable' });
      }
      const info = await credentials.describe(KEY_REF);
      return sendJson(res, 200, { ok: true, info: info || { configured: false }, endpoint: await describeEndpoint() });
    }
    if (action === 'get-endpoint') {
      return sendJson(res, 200, { ok: true, endpoint: await describeEndpoint() });
    }
    if (action === 'set-endpoint') {
      const endpoint = await saveEndpointConfig(body && body.mode, body && body.custom);
      return sendJson(res, 200, { ok: true, endpoint });
    }
    if (action === 'set') {
      const value = body && typeof body.value === 'string' ? body.value.trim() : '';
      if (!value) return sendJson(res, 400, { ok: false, error: 'value is required' });
      if (!credentials || typeof credentials.set !== 'function') {
        return sendJson(res, 503, { ok: false, error: 'credentials service unavailable' });
      }
      await credentials.set(KEY_REF, value);
      return sendJson(res, 200, { ok: true });
    }
    if (action === 'unset') {
      if (!credentials || typeof credentials.unset !== 'function') {
        return sendJson(res, 503, { ok: false, error: 'credentials service unavailable' });
      }
      await credentials.unset(KEY_REF);
      return sendJson(res, 200, { ok: true });
    }
    if (action === 'test') {
      const result = await testConnection();
      return sendJson(res, 200, { ok: true, result });
    }
    return sendJson(res, 400, { ok: false, error: 'unknown action' });
  } catch (error) {
    return sendJson(res, error.statusCode || 500, {
      ok: false,
      error: error && error.message ? error.message : 'credential update failed',
    });
  }
}

export function apply(ctx) {
  hostCtx = ctx;
  ctx.tools.register(definition);
  ctx.tools.register(editDefinition);

  // webServer is a dynamic service: it may not be ready when apply() runs, so
  // acquire it through inject() the same way other host plugins do. Surfaces
  // without a web server (for example the TUI) simply never get the callback.
  const mountSettingsRoute = (webCtx) => {
    const server = (webCtx && webCtx.webServer) || service(webCtx || ctx, 'webServer');
    if (!server || typeof server.register !== 'function') return;
    const register = () =>
      server.register({
        kind: 'exact',
        path: CREDENTIAL_PATH,
        handler: (req, res) => handleCredentialRequest(req, res),
      });
    if (typeof webCtx.effect === 'function') {
      webCtx.effect(register, 'minimax-image-credential-route');
    } else {
      register();
    }
  };

  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject(['webServer'], mountSettingsRoute);
    } catch {
      mountSettingsRoute(ctx);
    }
  } else {
    mountSettingsRoute(ctx);
  }
}

/**
 * Internals exposed for `node --test`. Not part of the public plugin API: the
 * host only consumes `apply` and `inject`, so this export is inert at runtime.
 */
export const testing = {
  REGION_ENDPOINTS,
  DEFAULT_API_BASE,
  sanitizeEndpoint,
  resolveEndpoint,
  settingsFilePath,
  readSettingsDocument,
  writeSettingsDocument,
  saveEndpointConfig,
  currentEndpoint,
  parsePixelSize,
  readImageSize,
  readJpegSize,
  readWebpSize,
  readHeifSize,
  sniffMediaType,
  normalizeMediaType,
  mediaTypeFor,
  extensionFor,
  validateAspectRatio,
  validateReferenceDimensions,
  buildReferenceImages,
  normalizeImageArgs,
  handleCredentialRequest,
  buildGenerationBody,
  runImageRequest,
  formatApiError,
  apiErrorHint,
  errorCode,
};
