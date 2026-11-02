/**
 * iOS Location Spoofer Web
 * Copyright (c) 2026 akudamatata (https://github.com/akudamatata/iOS-Location-Spoofer-Web)
 * Licensed under CC BY-NC-SA 4.0
 */

import { authOk, jsonResponse, corsHeaders } from './_utils.js';

const GLOBAL_ALIASES = new Map([
  ['东京', 'Tokyo'],
  ['东京涩谷', 'Shibuya Tokyo'],
  ['涩谷', 'Shibuya Tokyo'],
  ['纽约', 'New York']
]);
const USER_AGENT = 'iOS-Location-Spoofer-Web (https://github.com/akudamatata/iOS-Location-Spoofer-Web)';
const CACHE_SECONDS = 24 * 60 * 60;
const inFlight = new Map();

function normalizeLongitude(longitude) {
  return longitude >= -180 && longitude < 180
    ? longitude : ((longitude + 180) % 360 + 360) % 360 - 180;
}

function failure(code, message, status, retryAfter) {
  const response = jsonResponse({ error: code, message }, status);
  if (retryAfter) response.headers.set('Retry-After', retryAfter);
  return response;
}

function photonResult(feature) {
  const coordinates = feature?.geometry?.coordinates;
  if (!Array.isArray(coordinates)) return null;
  const [longitude, latitude] = coordinates;
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude)) return null;
  const properties = feature.properties || {};
  const name = properties.name || properties.street || properties.city || properties.district || properties.state;
  if (typeof name !== 'string' || !name) return null;
  const country = properties.country || properties.countrycode || '';
  const locality = properties.city || properties.district || properties.county || properties.state || '';
  const label = [...new Set([name, locality, properties.state, country].filter(Boolean))].join(' · ');
  const normalizedLongitude = normalizeLongitude(longitude);
  return {
    id: `photon:${properties.osm_type || ''}:${properties.osm_id ?? `${latitude},${normalizedLongitude}`}`,
    name, label, country, locality, latitude, longitude: normalizedLongitude, provider: 'photon'
  };
}

// Same GCJ-02 inverse approximation as the existing map: convert only at the Amap boundary.
function gcjToWgs(latitude, longitude) {
  if (longitude < 72.004 || longitude > 137.8347 || latitude < 0.8293 || latitude > 55.8271) return [latitude, longitude];
  const x = longitude - 105, y = latitude - 35, pi = Math.PI;
  let dLat = -100 + 2*x + 3*y + 0.2*y*y + 0.1*x*y + 0.2*Math.sqrt(Math.abs(x));
  dLat += (20*Math.sin(6*x*pi) + 20*Math.sin(2*x*pi))*2/3;
  dLat += (20*Math.sin(y*pi) + 40*Math.sin(y/3*pi))*2/3;
  dLat += (160*Math.sin(y/12*pi) + 320*Math.sin(y*pi/30))*2/3;
  let dLng = 300 + x + 2*y + 0.1*x*x + 0.1*x*y + 0.1*Math.sqrt(Math.abs(x));
  dLng += (20*Math.sin(6*x*pi) + 20*Math.sin(2*x*pi))*2/3;
  dLng += (20*Math.sin(x*pi) + 40*Math.sin(x/3*pi))*2/3;
  dLng += (150*Math.sin(x/12*pi) + 300*Math.sin(x/30*pi))*2/3;
  const radians = latitude/180*pi, sine = Math.sin(radians);
  const magic = 1 - 0.00669342162296594323*sine*sine, root = Math.sqrt(magic);
  dLat = dLat*180/((6378245*(1 - 0.00669342162296594323))/(magic*root)*pi);
  dLng = dLng*180/(6378245/root*Math.cos(radians)*pi);
  return [latitude - dLat, longitude - dLng];
}

function amapResult(tip) {
  if (typeof tip?.location !== 'string' || typeof tip.name !== 'string' || !tip.name) return null;
  const parts = tip.location.split(',');
  if (parts.length !== 2 || parts.some(part => !part.trim())) return null;
  const [longitude, latitude] = parts.map(Number);
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude)) return null;
  const [wgsLat, wgsLng] = gcjToWgs(latitude, longitude);
  const locality = typeof tip.district === 'string' ? tip.district : '';
  const address = typeof tip.address === 'string' ? tip.address : '';
  return {
    id: `amap:${typeof tip.id === 'string' && tip.id ? tip.id : tip.location}`,
    name: tip.name,
    label: [...new Set([tip.name, locality, address, '中国'].filter(Boolean))].join(' · '),
    country: '中国', locality, latitude: wgsLat, longitude: normalizeLongitude(wgsLng), provider: 'amap'
  };
}

async function lookup(query, scope, env) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    let upstreamUrl;
    if (scope === 'domestic') {
      upstreamUrl = new URL('https://restapi.amap.com/v3/assistant/inputtips');
      upstreamUrl.searchParams.set('key', env.AMAP_KEY);
      upstreamUrl.searchParams.set('keywords', query);
      upstreamUrl.searchParams.set('datatype', 'poi');
    } else {
      upstreamUrl = new URL(env.GLOBAL_GEOCODER_BASE_URL || 'https://photon.komoot.io');
      upstreamUrl.pathname = `${upstreamUrl.pathname.replace(/\/+$/, '').replace(/\/api$/, '')}/api/`;
      upstreamUrl.search = '';
      upstreamUrl.hash = '';
      upstreamUrl.searchParams.set('q', query);
      upstreamUrl.searchParams.set('limit', '6');
    }
    const upstream = await fetch(upstreamUrl, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT }
    });
    if (upstream.status === 429) {
      return failure('rate_limited', '搜索服务繁忙，请稍后重试。', 429, upstream.headers.get('Retry-After') || '1');
    }
    if (!upstream.ok) return failure('upstream_failure', '搜索服务暂时不可用，请稍后重试或直接输入坐标。', 502);
    const data = await upstream.json();
    if (scope === 'domestic') {
      if (String(data.status) !== '1') {
        if (/LIMIT|FREQUENT/.test(data.info || '')) return failure('rate_limited', '国内搜索额度或频率受限，请稍后重试。', 429, '1');
        return failure('upstream_failure', '国内搜索服务不可用，请检查高德 Key 配置。', 502);
      }
      if (!Array.isArray(data.tips)) return failure('upstream_failure', '国内搜索服务返回异常，请稍后重试。', 502);
      return jsonResponse({ results: data.tips.map(amapResult).filter(Boolean).slice(0, 6), provider: 'amap' });
    }
    if (!Array.isArray(data.features)) return failure('upstream_failure', '搜索服务返回异常，请稍后重试。', 502);
    return jsonResponse({ results: data.features.map(photonResult).filter(Boolean).slice(0, 6), provider: 'photon' });
  } catch {
    if (controller.signal.aborted) return failure('timeout', '搜索超时，请稍后重试或直接输入坐标。', 504);
    return failure('upstream_failure', '搜索服务连接失败，请稍后重试或直接输入坐标。', 502);
  } finally {
    clearTimeout(timeout);
  }
}

export async function onRequestGet({ request, env }) {
  if (!authOk(request, env)) return failure('unauthorized', '验证失败，请重新输入访问 Token。', 401);
  const url = new URL(request.url);
  const rawQuery = (url.searchParams.get('q') || '').trim();
  const scope = url.searchParams.get('scope') || 'global';
  if (!rawQuery || rawQuery.length > 200 || !['global', 'domestic'].includes(scope)) {
    return failure('invalid_query', '请输入 1–200 字的地名，并选择全球或国内搜索。', 400);
  }
  if (scope === 'domestic' && !env.AMAP_KEY) return failure('provider_unavailable', '国内搜索未配置高德 Key，请使用全球搜索或直接输入坐标。', 502);
  const query = scope === 'global' ? GLOBAL_ALIASES.get(rawQuery) || rawQuery : rawQuery;
  const provider = scope === 'global' ? 'photon' : 'amap';
  const source = scope === 'global' ? env.GLOBAL_GEOCODER_BASE_URL || 'https://photon.komoot.io' : 'amap';
  const cacheKey = `search-cache:${scope}:${encodeURIComponent(source)}:${encodeURIComponent(query)}`;
  try {
    const cached = env.SPOOFER_DATA ? await env.SPOOFER_DATA.get(cacheKey, { type: 'json' }) : null;
    if (cached?.expiresAt > Date.now() && cached.data?.provider === provider && Array.isArray(cached.data.results) && cached.data.results.length) {
      return jsonResponse(cached.data);
    }
  } catch { /* An unavailable cache must not prevent a provider lookup. */ }

  // The key is per provider and normalized query. Every caller receives its own body.
  let pending = inFlight.get(cacheKey);
  if (!pending) {
    pending = (async () => {
      const response = await lookup(query, scope, env);
      if (response.ok && env.SPOOFER_DATA) {
        const data = await response.clone().json();
        if (data.results.length) {
          try {
            await env.SPOOFER_DATA.put(cacheKey, JSON.stringify({ expiresAt: Date.now() + CACHE_SECONDS*1000, data }), { expirationTtl: CACHE_SECONDS });
          } catch { /* Keep successful search results even if the cache cannot be written. */ }
        }
      }
      return response;
    })();
    inFlight.set(cacheKey, pending);
  }
  try {
    return (await pending).clone();
  } finally {
    if (inFlight.get(cacheKey) === pending) inFlight.delete(cacheKey);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
