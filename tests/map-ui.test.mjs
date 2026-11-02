import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
const source = scripts.at(-1)[1];
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

class Element {
  constructor() {
    this.style = {}; this.dataset = {}; this.children = []; this.events = {};
    this.value = ''; this.textContent = ''; this.hidden = false;
    const values = new Set();
    this.classList = {
      add: value => values.add(value), remove: value => values.delete(value),
      contains: value => values.has(value),
      toggle(value, force) { if (force ?? !values.has(value)) values.add(value); else values.delete(value); }
    };
  }
  set innerHTML(value) { this.markup = value; this.children = []; }
  get innerHTML() { return this.markup || ''; }
  appendChild(child) { this.children.push(child); return child; }
  addEventListener(name, listener) { (this.events[name] ||= []).push(listener); }
  fire(name, event = {}) { for (const listener of this.events[name] || []) listener({ target: this, stopPropagation() {}, ...event }); }
  querySelector() { return this.button ||= new Element(); }
  contains(target) { return target === this || this.children.includes(target); }
  setAttribute() {}
  focus() {}
  blur() {}
}

class Evented {
  constructor(options = {}) { this.options = options; this.events = {}; }
  on(name, listener) { (this.events[name] ||= []).push(listener); return this; }
  fire(name) { for (const listener of this.events[name] || []) listener(); return this; }
  addTo(map) { this.map = map; return this; }
}

async function createUI({ preferences = {}, initial = { latitude: 39.90872, longitude: 116.39748 } } = {}) {
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(match => [match[1], new Element()]));
  const get = id => elements.get(id);
  const layerItems = ['osm', 'esri', 'amap', 'sat'].map(name => {
    const item = get('layer-' + name); item.dataset.layer = name; return item;
  });
  const storage = new Map(Object.entries(preferences));
  const calls = [], searches = [], markers = [];
  let now = 10000;
  class Clock extends Date { static now() { return now; } }
  const map = new Evented();
  Object.assign(map, {
    center: { lat: initial.latitude, lng: initial.longitude }, zoom: 13,
    attributionControl: { setPosition(position) { this.position = position; } },
    getCenter() { return this.center; }, getZoom() { return this.zoom; }, stop() {},
    setView(point, zoom) {
      this.center = { lat: point[0], lng: point[1] }; this.zoom = zoom;
      this.fire('move'); this.fire('moveend'); return this;
    },
    removeLayer() {}, zoomIn() {}, zoomOut() {}
  });
  const response = (data, status = 200, retry) => ({
    ok: status >= 200 && status < 300, status,
    headers: { get: name => name === 'Retry-After' ? retry || null : null },
    json: async () => data
  });
  const context = {
    console, URL, AbortController, Date: Clock,
    setTimeout: () => 1, clearTimeout() {},
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    document: {
      documentElement: new Element(), getElementById: get, createElement: () => new Element(),
      querySelectorAll: selector => selector === '.layer-item' ? layerItems : [], addEventListener() {}
    },
    navigator: {},
    window: { location: { origin: 'https://picker.test' }, __CFG__: { amapKey: 'configured-key', hasToken: Boolean(preferences.gps_session) } },
    L: {
      map: () => map,
      tileLayer: (url, options) => Object.assign(new Evented(options), { url }),
      layerGroup: children => Object.assign(new Evented(), { eachLayer: listener => children.forEach(listener), children }),
      divIcon: options => options,
      marker: point => {
        const marker = new Evented();
        marker.point = point;
        marker.setLatLng = value => { marker.point = value; return marker; };
        marker.setIcon = () => marker;
        markers.push(marker); return marker;
      }
    },
    fetch: (url, options = {}) => {
      const parsed = new URL(url, 'https://picker.test');
      calls.push({ url: parsed, options, at: now });
      if (parsed.pathname === '/search') {
        return new Promise((resolve, reject) => searches.push({ url: parsed, options, resolve: (data, status, retry) => resolve(response(data, status, retry)), reject }));
      }
      if (parsed.pathname === '/loc.json') return Promise.resolve(response(initial));
      if (parsed.pathname === '/verify') return Promise.resolve(response({ ok: true }));
      if (parsed.pathname === '/favorites') return Promise.resolve(response([]));
      if (parsed.pathname === '/set') return Promise.resolve(response({ ok: true }));
      throw new Error('Unexpected request: ' + parsed.pathname);
    }
  };
  const instrumented = source.replace(/\}\)\(\);\s*$/, `globalThis.ui = {
    previewLocation, switchLayer, doSearch, GCJ, layers, projectWGS,
    getWGS: function(){return WGS;}, getLocked: function(){return lockedWGS;},
    getLayer: function(){return currentLayer;}, getScope: function(){return searchScope;},
    favorites: function(value){favorites=value;renderFavorites();}
  };})();`);
  assert.notEqual(instrumented, source, 'test seam must be injected into the real inline script');
  vm.runInNewContext(instrumented, context);
  await flush();
  return {
    ui: context.ui, get, map, storage, calls, searches, markers,
    advance: milliseconds => { now += milliseconds; },
    search(query) { get('search-input').value = query; get('search-btn').fire('click'); },
    scope(value) { get('search-scope').value = value; get('search-scope').fire('change'); }
  };
}

const result = (latitude = 35.66337, longitude = 139.69649) => ({
  results: [{ id: 'jp', name: '渋谷区', label: '渋谷区, 東京都, 日本', country: '日本', locality: '東京都', latitude, longitude, provider: 'photon' }], provider: 'photon'
});
function close(actual, expected, tolerance = 1e-10) { assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`); }
function noWrites(app) { assert.equal(app.calls.filter(call => call.options.method && call.options.method !== 'GET').length, 0); }

test('defaults, valid preferences, and independent scope use only same-origin authenticated search', async () => {
  const app = await createUI({ preferences: {
    gps_token: 'private token', gps_session: JSON.stringify({ token: 'private token', expiresAt: 2147483647000 })
  } });
  assert.equal(app.ui.getLayer(), 'osm');
  assert.equal(app.ui.getScope(), 'global');
  assert.equal(app.ui.layers.osm.url, 'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  assert.equal(app.ui.layers.osm.options.maxNativeZoom, 19);
  assert.equal(app.map.attributionControl.position, 'topleft');
  app.ui.switchLayer('amap');
  app.search('东京涩谷');
  assert.equal(app.searches[0].url.origin, 'https://picker.test');
  assert.equal(app.searches[0].url.searchParams.get('token'), 'private token');
  assert.equal(app.searches[0].url.searchParams.get('q'), '东京涩谷');
  assert.equal(app.searches[0].url.searchParams.getAll('token').length, 1);
  assert.equal(app.searches[0].url.searchParams.get('scope'), 'global');
  app.scope('domestic'); app.advance(1000); app.search('北京');
  assert.equal(app.searches[1].url.searchParams.get('scope'), 'domestic');
  assert.equal(app.storage.get('ios_loc_spoofer_layer'), 'amap');
  assert.equal(app.storage.get('ios_loc_spoofer_scope'), 'domestic');
  const restored = await createUI({ preferences: Object.fromEntries(app.storage) });
  assert.equal(restored.ui.getLayer(), 'amap'); assert.equal(restored.ui.getScope(), 'domestic');
  const invalid = await createUI({ preferences: { ios_loc_spoofer_layer: 'unknown', ios_loc_spoofer_scope: 'unknown' } });
  assert.equal(invalid.ui.getLayer(), 'osm'); assert.equal(invalid.ui.getScope(), 'global');
  noWrites(app);
});

test('newer submissions and scope changes isolate stale success and failure responses', async () => {
  const app = await createUI();
  app.search('first'); app.advance(1000); app.search('second');
  assert.equal(app.searches[0].options.signal.aborted, true);
  app.searches[1].resolve(result()); await flush();
  const box = app.get('search-results');
  assert.match(box.children[0].innerHTML, /日本.*東京都.*photon/);
  app.searches[0].resolve({ results: [] }); await flush();
  assert.equal(box.children.length, 1);
  app.advance(1000); app.search('third'); app.scope('domestic');
  app.searches[2].reject(new Error('old failure')); await flush();
  assert.equal(box.style.display, 'none');
  assert.doesNotMatch(box.innerHTML, /old failure/);
  noWrites(app);
});

test('explicit search spacing and Retry-After do not queue or retry requests', async () => {
  const app = await createUI();
  app.search('first'); app.search('too soon');
  assert.equal(app.searches.length, 1);
  assert.match(app.get('search-results').innerHTML, /等待 1 秒/);
  app.advance(1000); app.search('throttled');
  app.searches[1].resolve({ error: 'throttled', message: '请稍后重试' }, 429, '4'); await flush();
  app.advance(3000); app.search('still waiting'); assert.equal(app.searches.length, 2);
  app.advance(1000); app.search('allowed'); assert.equal(app.searches.length, 3);
  assert.ok(app.calls.filter(call => call.url.pathname === '/search').every((call, index, calls) => !index || call.at - calls[index - 1].at >= 1000));
  noWrites(app);
});

test('empty and failed searches end loading, preserve query and locked point, and provide useful hints', async () => {
  const app = await createUI();
  const locked = { ...app.ui.getLocked() };
  app.search('未知中文'); app.searches[0].resolve({ results: [], provider: 'photon' }); await flush();
  assert.match(app.get('search-results').innerHTML, /未找到结果.*当地文字或英文/);
  assert.equal(app.get('search-input').value, '未知中文');
  for (const status of [401, 400, 502, 504]) {
    app.advance(1000); app.search('failure');
    app.searches.at(-1).resolve({ error: 'failure' }, status); await flush();
    assert.doesNotMatch(app.get('search-results').innerHTML, /搜索中/);
    assert.match(app.get('search-results').innerHTML, /登录|检查|不可用|超时/);
  }
  app.advance(1000); app.search('network failure');
  app.searches.at(-1).reject(new TypeError('Failed to fetch')); await flush();
  assert.match(app.get('search-results').innerHTML, /检查网络后重试/);
  assert.deepEqual({ ...app.ui.getLocked() }, locked); noWrites(app);
});

test('canonical WGS survives repeated domestic/global switches and result selection until explicit lock', async () => {
  const app = await createUI();
  const target = { lat: 39.90872, lng: 116.39748 };
  app.ui.previewLocation(target.lat, target.lng, 16);
  for (let cycle = 0; cycle < 20; cycle++) for (const layer of ['amap', 'sat', 'esri', 'osm']) app.ui.switchLayer(layer);
  close(app.ui.getWGS().lat, target.lat); close(app.ui.getWGS().lng, target.lng);
  const gcj = app.ui.GCJ.w2g(target.lat, target.lng);
  const back = app.ui.GCJ.g2w(gcj[0], gcj[1]);
  close(back[0], target.lat, 2e-5); close(back[1], target.lng, 2e-5);
  app.ui.switchLayer('amap'); app.search('New York');
  app.searches[0].resolve(result(40.7128, -74.006)); await flush();
  app.get('search-results').children[0].fire('click');
  close(app.ui.getWGS().lat, 40.7128); close(app.ui.getWGS().lng, -74.006);
  noWrites(app);
  app.get('btn-lock').fire('click'); await flush();
  const writes = app.calls.filter(call => call.options.method === 'POST');
  assert.equal(writes.length, 1); assert.equal(writes[0].url.pathname, '/set');
  const payload = JSON.parse(writes[0].options.body);
  close(payload.latitude, 40.7128); close(payload.longitude, -74.006);
});

test('favorite jumps on Esri use WGS and direct coordinates normalize the dateline without writes', async () => {
  const app = await createUI();
  app.ui.switchLayer('esri');
  app.ui.favorites([{ id: 'beijing', name: '北京', latitude: 39.90872, longitude: 116.39748 }]);
  app.get('fav-list').children[0].fire('click');
  close(app.map.center.lat, 39.90872); close(app.map.center.lng, 116.39748);
  app.search('40.7128, -74.006'); close(app.ui.getWGS().lng, -74.006);
  app.search('0, 180'); assert.equal(app.ui.getWGS().lng, -180);
  assert.equal(app.searches.length, 0); noWrites(app);
});

test('real user map movement updates canonical coordinates while inactive tile failures stay isolated', async () => {
  const app = await createUI();
  app.ui.switchLayer('amap');
  const gcj = app.ui.GCJ.w2g(39.92, 116.42);
  app.map.center = { lat: gcj[0], lng: gcj[1] }; app.map.fire('moveend');
  close(app.ui.getWGS().lat, 39.92, 2e-5); close(app.ui.getWGS().lng, 116.42, 2e-5);
  app.ui.layers.osm.fire('loading').fire('tileerror').fire('load');
  assert.equal(app.get('map-status').hidden, true);
  app.ui.switchLayer('osm'); assert.equal(app.get('map-status').hidden, false);
  app.get('map-switch-btn').fire('click'); assert.equal(app.get('layer-menu').style.display, 'block');
  app.ui.layers.osm.fire('loading').fire('load'); assert.equal(app.get('map-status').hidden, true);
  app.ui.switchLayer('sat');
  app.ui.layers.sat.children[0].fire('loading').fire('tileerror').fire('load');
  app.ui.layers.sat.children[1].fire('loading').fire('load');
  assert.equal(app.get('map-status').hidden, false, 'a successful overlay must not hide failed satellite imagery');
  noWrites(app);
});
