import { validateHeaderName, validateHeaderValue } from 'node:http';
import { parse as parseForm } from 'node:querystring';

const BODY_LIMIT = 1024 * 1024;
const sensitiveHeaders = new Set(['authorization', 'host', 'content-type', 'content-length',
  'x-mutter-release-action']);
const ownObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function responseBody(statusCode, headers, value, head = false) {
  const body = Buffer.from(JSON.stringify(value));
  return { statusCode, headers: { ...headers, 'content-type': ['application/json; charset=utf-8'],
    'content-length': [String(body.length)] }, encoding: 'base64', body: head ? '' : body.toString('base64') };
}

function decodeRequest(event) {
  if (!ownObject(event) || typeof event.body !== 'string') throw new Error('INVALID_ENVELOPE');
  const payload = JSON.parse(event.body);
  if (!ownObject(payload) || typeof payload.method !== 'string' || !/^[A-Z]{1,16}$/.test(payload.method)
    || typeof payload.path !== 'string' || payload.path.length > 16384
    || !payload.path.startsWith('/') || payload.path.startsWith('//') || /[\u0000-\u0020\u007f]/.test(payload.path)
    || !ownObject(payload.headers)
    || (payload.body !== undefined && payload.body !== null && typeof payload.body !== 'string')
    || ![undefined, '', 'base64'].includes(payload.encoding)) throw new Error('INVALID_REQUEST');
  const headers = Object.create(null);
  for (const [name, original] of Object.entries(payload.headers)) {
    validateHeaderName(name);
    const lower = name.toLowerCase(), values = Array.isArray(original) ? original : [original];
    if (!values.length || values.some(value => typeof value !== 'string')) throw new Error('INVALID_HEADER');
    for (const value of values) validateHeaderValue(name, value);
    if (Object.hasOwn(headers, lower) || (sensitiveHeaders.has(lower) && values.length !== 1)) {
      throw new Error('AMBIGUOUS_HEADER');
    }
    headers[lower] = values.join(lower === 'cookie' ? '; ' : ', ');
  }
  // Vercel's official bridge treats missing/null Body as the zero-value string.
  // This only reconstructs transport bytes; each handler still authorizes and
  // validates its own operation before accessing or changing data.
  const body = payload.body ?? '';
  if (body.length > BODY_LIMIT * 2) throw new Error('BODY_TOO_LARGE');
  const bytes = Buffer.from(body, payload.encoding === 'base64' ? 'base64' : 'utf8');
  if (bytes.length > BODY_LIMIT || (payload.encoding === 'base64' && bytes.toString('base64') !== body)) {
    throw new Error('INVALID_BODY');
  }
  // Helpers are deliberately limited to the actual access handler's interface.
  // Preserve the original path: its suffix selects session/request/complete.
  const request = { method: payload.method, url: payload.path, headers };
  Object.defineProperty(request, 'body', { get() {
    const type = headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
    if (!type) return undefined;
    const text = bytes.toString('utf8');
    if (type === 'application/json') return text ? JSON.parse(text) : {};
    if (type === 'application/x-www-form-urlencoded') return parseForm(text);
    if (type === 'text/plain') return text;
    if (type === 'application/octet-stream') return bytes;
    return undefined;
  } });
  return request;
}

export async function invokeAccess(event, handler) {
  let request;
  try { request = decodeRequest(event); } catch {
    return responseBody(400, { 'cache-control': ['no-store'], 'referrer-policy': ['no-referrer'] },
      { code: 'INVALID_REQUEST', error: 'Invalid request' });
  }
  let statusCode = 200, completed;
  const headers = Object.create(null);
  const response = {
    setHeader(name, value) {
      validateHeaderName(name);
      const values = Array.isArray(value) ? value.map(String) : [String(value)];
      for (const item of values) validateHeaderValue(name, item);
      headers[name.toLowerCase()] = values;
      return this;
    },
    status(value) {
      if (!Number.isInteger(value) || value < 100 || value > 599) throw new Error('INVALID_STATUS');
      statusCode = value; return this;
    },
    json(value) {
      if (completed) throw new Error('RESPONSE_ALREADY_COMPLETED');
      completed = responseBody(statusCode, headers, value, request.method === 'HEAD');
      return this;
    },
  };
  await handler(request, response);
  if (!completed) throw new Error('ACCESS_RESPONSE_MISSING');
  return completed;
}
