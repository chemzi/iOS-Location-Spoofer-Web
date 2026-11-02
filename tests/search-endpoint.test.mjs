import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet } from '../functions/search.js';

const feature = (longitude = 139.7016, latitude = 35.6595) => ({
  geometry: { type: 'Point', coordinates: [longitude, latitude] },
  properties: { osm_type: 'R', osm_id: 123, name: 'Shibuya', city: 'Tokyo', country: 'Japan' }
});
const context = (q = '涩谷', scope = 'global', token = 'secret', extraEnv = {}) => ({
  request: new Request(`https://local.test/search?${new URLSearchParams({ q, scope, token })}`),
  env: { TOKEN: 'secret', ...extraEnv }
});

test('auth and query validation reject before contacting provider', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('Unexpected fetch'); });
  assert.equal((await onRequestGet(context('涩谷', 'global', 'wrong'))).status, 401);
  assert.equal((await onRequestGet(context(' '))).status, 400);
  assert.equal((await onRequestGet(context('x'.repeat(201)))).status, 400);
  assert.equal((await onRequestGet(context('Tokyo', 'unknown'))).status, 400);
  const forbiddenKv = { get() { throw new Error('Unauthorized request reached KV'); } };
  assert.equal((await onRequestGet(context('涩谷', 'global', 'wrong', { SPOOFER_DATA: forbiddenKv }))).status, 401);
  assert.equal(calls, 0);
});

test('domestic Amap results convert GCJ-02 once and preserve the domestic query', async t => {
  let latestUrl;
  t.mock.method(globalThis, 'fetch', async url => {
    latestUrl = url;
    return Response.json({ status: '1', tips: [
      { id: 'B000A', name: '北京示例', district: '北京市东城区', address: '示例路', location: '116.404,39.915' },
      { id: [], name: '区域提示', location: [] },
      { name: '缺失坐标', location: ',' }
    ] });
  });
  const response = await onRequestGet(context(' 纽约 ', 'domestic', 'secret', { AMAP_KEY: 'amap-key' }));
  assert.equal(response.status, 200);
  assert.equal(latestUrl.origin, 'https://restapi.amap.com');
  assert.equal(latestUrl.pathname, '/v3/assistant/inputtips');
  assert.equal(latestUrl.searchParams.get('keywords'), '纽约');
  assert.equal(latestUrl.searchParams.get('key'), 'amap-key');
  assert.equal(latestUrl.searchParams.has('token'), false);
  const data = await response.json();
  assert.equal(data.provider, 'amap');
  assert.equal(data.results.length, 1);
  assert.equal(data.results[0].id, 'amap:B000A');
  assert.equal(data.results[0].country, '中国');
  assert.equal(data.results[0].locality, '北京市东城区');
  assert.match(data.results[0].label, /北京示例.*北京市东城区.*中国/);
  assert.ok(Math.abs(data.results[0].latitude - 39.9135957) < 2e-5);
  assert.ok(Math.abs(data.results[0].longitude - 116.3977555) < 2e-5);
});

test('domestic missing key and provider application errors are actionable', async t => {
  const mock = t.mock.method(globalThis, 'fetch', async () => Response.json({ status: '0', info: 'INVALID_USER_KEY' }));
  let response = await onRequestGet(context('北京', 'domestic'));
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, 'provider_unavailable');
  assert.equal(mock.mock.callCount(), 0);
  const configured = () => context('北京', 'domestic', 'secret', { AMAP_KEY: 'amap-key' });
  response = await onRequestGet(configured());
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, 'upstream_failure');
  mock.mock.mockImplementation(async () => Response.json({ status: '0', info: 'DAILY_QUERY_OVER_LIMIT' }));
  response = await onRequestGet(configured());
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), '1');
  mock.mock.mockImplementation(async () => Response.json({ status: '1', tips: [] }));
  response = await onRequestGet(configured());
  assert.deepEqual(await response.json(), { provider: 'amap', results: [] });
});

function memoryKv() {
  const entries = new Map();
  const writes = [];
  return {
    entries, writes,
    async get(key) { return entries.has(key) ? JSON.parse(entries.get(key)) : null; },
    async put(key, value, options) { entries.set(key, value); writes.push({ key, value: JSON.parse(value), options }); }
  };
}

test('nonempty results cache for 24h by normalized query and scope; expiration is exclusive', async t => {
  let now = 100000;
  t.mock.method(Date, 'now', () => now);
  const kv = memoryKv();
  const extra = { SPOOFER_DATA: kv, AMAP_KEY: 'amap-key' };
  const mock = t.mock.method(globalThis, 'fetch', async url => url.hostname === 'restapi.amap.com'
    ? Response.json({ status: '1', tips: [{ id: 'b', name: '涩谷', location: '116.404,39.915' }] })
    : Response.json({ features: [feature()] }));
  assert.equal((await onRequestGet(context('涩谷', 'global', 'secret', extra))).status, 200);
  assert.equal(kv.writes.length, 1);
  assert.match(kv.writes[0].key, /^search-cache:global:/);
  assert.equal(kv.writes[0].options.expirationTtl, 86400);
  assert.equal(kv.writes[0].value.expiresAt, now + 86400000);
  assert.ok(!kv.writes[0].key.includes('secret'));
  now += 86400000 - 1;
  await onRequestGet(context(' Shibuya Tokyo ', 'global', 'secret', extra));
  assert.equal(mock.mock.callCount(), 1);
  now += 1;
  await onRequestGet(context('涩谷', 'global', 'secret', extra));
  assert.equal(mock.mock.callCount(), 2);
  await onRequestGet(context('涩谷', 'domestic', 'secret', extra));
  assert.equal(mock.mock.callCount(), 3);
  assert.match(kv.writes[2].key, /^search-cache:domestic:/);
  assert.ok(kv.writes.every(write => write.key.startsWith('search-cache:')));
});

test('cache failures do not fail successful queries; empty and failed responses are not cached', async t => {
  let reads = 0, writes = 0;
  const failingKv = {
    async get() { reads++; throw new Error('KV read unavailable'); },
    async put() { writes++; throw new Error('KV write unavailable'); }
  };
  const mock = t.mock.method(globalThis, 'fetch', async () => Response.json({ features: [feature()] }));
  assert.equal((await onRequestGet(context('Tokyo', 'global', 'secret', { SPOOFER_DATA: failingKv }))).status, 200);
  assert.equal(reads, 1);
  assert.equal(writes, 1);
  const kv = memoryKv();
  const cachedContext = () => context('Tokyo', 'global', 'secret', { SPOOFER_DATA: kv });
  mock.mock.mockImplementation(async () => Response.json({ features: [] }));
  await onRequestGet(cachedContext());
  await onRequestGet(cachedContext());
  assert.equal(mock.mock.callCount(), 3);
  mock.mock.mockImplementation(async () => new Response('', { status: 429 }));
  assert.equal((await onRequestGet(cachedContext())).status, 429);
  assert.equal(kv.writes.length, 0);
});

test('concurrent normalized queries coalesce and each response body can be consumed', async t => {
  let release;
  const mock = t.mock.method(globalThis, 'fetch', () => new Promise(resolve => { release = resolve; }));
  const first = onRequestGet(context('涩谷'));
  const second = onRequestGet(context(' Shibuya Tokyo '));
  assert.equal(mock.mock.callCount(), 1);
  release(Response.json({ features: [feature()] }));
  const [a, b] = await Promise.all([first, second]);
  assert.notEqual(a, b);
  assert.deepEqual(await a.json(), await b.json());
  mock.mock.mockImplementation(async () => Response.json({ features: [] }));
  await onRequestGet(context('涩谷'));
  assert.equal(mock.mock.callCount(), 2);
});

test('deadline includes slow response body and releases coalescing after timeout', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let bodyStarted;
  const started = new Promise(resolve => { bodyStarted = resolve; });
  const mock = t.mock.method(globalThis, 'fetch', async (url, { signal }) => ({
    status: 200, ok: true,
    json: () => new Promise((resolve, reject) => {
      bodyStarted();
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    })
  }));
  const pending = onRequestGet(context('slow body'));
  await started;
  t.mock.timers.tick(8000);
  assert.equal((await pending).status, 504);
  mock.mock.mockImplementation(async () => Response.json({ features: [] }));
  assert.equal((await onRequestGet(context('slow body'))).status, 200);
  assert.equal(mock.mock.callCount(), 2);
});

test('declared aliases and trimmed free text use Photon without forwarding token', async t => {
  let latestUrl, latestOptions;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    latestUrl = url;
    latestOptions = options;
    return Response.json({ features: [feature()] });
  });
  for (const [input, expected] of [['东京', 'Tokyo'], ['东京涩谷', 'Shibuya Tokyo'], [' 涩谷 ', 'Shibuya Tokyo'], ['纽约', 'New York'], [' 上海 ', '上海']]) {
    const response = await onRequestGet(context(input));
    assert.equal(response.status, 200);
    assert.equal(latestUrl.searchParams.get('q'), expected);
    assert.equal(latestUrl.searchParams.get('limit'), '6');
    assert.equal(latestUrl.searchParams.has('token'), false);
    assert.ok(latestOptions.headers['User-Agent'].includes('https://github.com/'));
    assert.ok(!JSON.stringify(latestOptions).includes('secret'));
    assert.deepEqual(await response.json(), { results: [{ id: 'photon:R:123', name: 'Shibuya', label: 'Shibuya · Tokyo · Japan', country: 'Japan', locality: 'Tokyo', latitude: 35.6595, longitude: 139.7016, provider: 'photon' }], provider: 'photon' });
  }
});

test('operator base URL, coordinate normalization, invalid feature filtering and result limit', async t => {
  let latestUrl;
  t.mock.method(globalThis, 'fetch', async url => {
    latestUrl = url;
    return Response.json({ features: [feature(1, 91), feature('139'), ...Array.from({ length: 8 }, () => feature(286, 40))] });
  });
  const response = await onRequestGet(context('New York', 'global', 'secret', { GLOBAL_GEOCODER_BASE_URL: 'https://photon.example/api/?old=value' }));
  assert.equal(latestUrl.origin, 'https://photon.example');
  assert.equal(latestUrl.pathname, '/api/');
  assert.equal(latestUrl.searchParams.has('old'), false);
  const data = await response.json();
  assert.equal(data.results.length, 6);
  assert.equal(data.results[0].longitude, -74);
});

test('empty matches remain distinct from malformed or unavailable upstream', async t => {
  const mock = t.mock.method(globalThis, 'fetch', async () => Response.json({ features: [] }));
  let response = await onRequestGet(context());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { results: [], provider: 'photon' });
  mock.mock.mockImplementation(async () => Response.json({ wrong: [] }));
  assert.equal((await onRequestGet(context())).status, 502);
  mock.mock.mockImplementation(async () => new Response('Unavailable', { status: 503 }));
  assert.equal((await onRequestGet(context())).status, 502);
  mock.mock.mockImplementation(async () => { throw new Error('offline'); });
  response = await onRequestGet(context());
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, 'upstream_failure');
});

test('provider throttling retains Retry-After with no retry', async t => {
  const mock = t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 429, headers: { 'Retry-After': '25' } }));
  const response = await onRequestGet(context());
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), '25');
  assert.equal((await response.json()).error, 'rate_limited');
  assert.equal(mock.mock.callCount(), 1);
});

test('eight-second deadline aborts provider and returns timeout without retry', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const mock = t.mock.method(globalThis, 'fetch', async (url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }));
  let settled = false;
  const pending = onRequestGet(context()).then(response => { settled = true; return response; });
  t.mock.timers.tick(7999);
  await Promise.resolve();
  assert.equal(settled, false);
  t.mock.timers.tick(1);
  const response = await pending;
  assert.equal(response.status, 504);
  assert.equal((await response.json()).error, 'timeout');
  assert.equal(mock.mock.callCount(), 1);
});
