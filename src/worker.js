import { GAME_ID_TO_SLUG } from './game-redirects.js';

const EXACT_ALLOWED_ORIGINS = new Set([
  'https://gekkotari.com',
  'https://www.gekkotari.com',
]);

const ALLOWED_UPSTREAM_SUFFIXES = [
  'archive.org',
  'archive-it.org',
];

const MIME_BY_EXT = {
  '.swf': 'application/x-shockwave-flash',
  '.xml': 'application/xml; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oep': 'application/xml; charset=utf-8',
};

const LEGACY_ASSET_REWRITES = {
  '/index.php': '/index.html',
  '/oyun.php': '/oyun.html',
  '/kategori.php': '/kategori.html',
  '/kutuphane.php': '/kutuphane.html',
  '/giris.php': '/giris.html',
  '/kayit.php': '/kayit.html',
  '/sayfa.php': '/sayfa.html',
  '/admin': '/admin.html',
  '/admin/': '/admin.html',
  '/admin/index.php': '/admin.html',
  '/admin/oyunlar.php': '/admin.html',
};

const MAX_CACHEABLE_BYTES = 500 * 1024 * 1024;
const ipHits = new Map();

export function isAllowedBrowserOrigin(origin) {
  if (!origin) return false;
  if (EXACT_ALLOWED_ORIGINS.has(origin)) return true;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol === 'https:') {
      return parsed.hostname.endsWith('.gekkotari.com') || parsed.hostname.endsWith('.workers.dev');
    }
    if (parsed.protocol === 'http:') {
      return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    }
  } catch {
    return false;
  }
  return false;
}

function buildCorsHeaders(request) {
  const origin = request ? request.headers.get('origin') : null;
  if (origin && !isAllowedBrowserOrigin(origin)) {
    return null;
  }
  return {
    'Access-Control-Allow-Origin': origin || 'https://gekkotari.com',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, Content-Type',
    Vary: 'Origin',
  };
}

export function isAllowedUpstreamHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!host) return false;
  return ALLOWED_UPSTREAM_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith('.' + suffix)
  );
}

export function isAllowedUpstreamUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password) return false;
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '::1' ||
      /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) ||
      host.includes(':')
    ) {
      return false;
    }
    return isAllowedUpstreamHost(host);
  } catch {
    return false;
  }
}

function resolveContentType(targetUrl, upstreamHeader) {
  try {
    const pathname = new URL(targetUrl).pathname.toLowerCase();
    const dotIdx = pathname.lastIndexOf('.');
    if (dotIdx !== -1) {
      const ext = pathname.slice(dotIdx);
      if (MIME_BY_EXT[ext]) return MIME_BY_EXT[ext];
    }
  } catch {}
  return upstreamHeader || 'application/x-shockwave-flash';
}

async function fetchWithSafeRedirects(initialUrl, method, headers, maxHops = 5) {
  let currentUrl = initialUrl;
  for (let hop = 0; hop <= maxHops; hop++) {
    if (!isAllowedUpstreamUrl(currentUrl)) {
      throw new Error('Blocked redirect outside upstream allowlist');
    }
    const res = await fetch(currentUrl, {
      method,
      redirect: 'manual',
      headers,
      cf: { cacheEverything: true, cacheTtl: 31536000 },
      signal: AbortSignal.timeout(25000),
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return res;
      currentUrl = new URL(loc, currentUrl).toString();
      continue;
    }
    return res;
  }
  throw new Error('Too many upstream redirects');
}

function extractProxyTarget(url) {
  if (url.pathname.startsWith('/p/')) {
    const rawPath = url.pathname.slice('/p/'.length);
    if (!rawPath) return '';
    return rawPath.trim().replace(/^https\/+/i, 'https://').replace(/ /g, '%20');
  }
  const rawUrl = url.searchParams.get('url');
  if (rawUrl) return rawUrl.trim().replace(/ /g, '%20');
  const rawPath = url.searchParams.get('path');
  if (rawPath) return rawPath.trim().replace(/^https\/+/i, 'https://').replace(/ /g, '%20');
  return '';
}

function applyProxyResponseHeaders(sourceHeaders, cors, cacheStatus) {
  const headers = new Headers(sourceHeaders);
  headers.delete('vary');
  for (const [k, v] of Object.entries(cors)) {
    headers.set(k, v);
  }
  headers.set('X-Content-Type-Options', 'nosniff');
  if (cacheStatus) headers.set('X-Gekkotari-Cache', cacheStatus);
  return headers;
}

export async function handleSwfProxy(request, env, ctx) {
  const cors = buildCorsHeaders(request);
  if (!cors) {
    return new Response('Origin not allowed', { status: 403 });
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: cors });
  }

  const url = new URL(request.url);
  const targetUrl = extractProxyTarget(url);
  if (!targetUrl) {
    return new Response('Missing url parameter', { status: 400, headers: cors });
  }
  if (!isAllowedUpstreamUrl(targetUrl)) {
    return new Response('Invalid or disallowed upstream URL', { status: 400, headers: cors });
  }

  const method = request.method === 'HEAD' ? 'HEAD' : 'GET';
  const rangeHeader = request.headers.get('range');
  const cache = typeof caches !== 'undefined' && caches?.default ? caches.default : null;
  const cacheKeyUrl = `https://swf-cache.gekkotari.invalid/v1?u=${encodeURIComponent(targetUrl)}`;

  if (cache && method === 'GET') {
    try {
      const matchReq = rangeHeader
        ? new Request(cacheKeyUrl, { method: 'GET', headers: { Range: rangeHeader } })
        : new Request(cacheKeyUrl, { method: 'GET' });
      const cached = await cache.match(matchReq);
      if (cached) {
        return new Response(cached.body, {
          status: cached.status,
          headers: applyProxyResponseHeaders(cached.headers, cors, 'HIT'),
        });
      }
    } catch {}
  }

  const upstreamHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    Accept: '*/*',
  };
  if (rangeHeader) {
    upstreamHeaders.Range = rangeHeader;
  }

  try {
    let upstream = await fetchWithSafeRedirects(targetUrl, method, upstreamHeaders);
    for (const delayMs of [350, 750]) {
      if (upstream.status !== 429 && (upstream.status < 502 || upstream.status > 504)) break;
      await upstream.body?.cancel().catch(() => {});
      await new Promise((r) => setTimeout(r, delayMs));
      upstream = await fetchWithSafeRedirects(targetUrl, method, upstreamHeaders);
    }

    if (!upstream.ok && upstream.status !== 206) {
      return new Response(`Upstream error: ${upstream.status}`, {
        status: upstream.status,
        headers: cors,
      });
    }

    // Store clean cache headers (without Vary: Origin) so all allowed origins & Range requests hit cache
    const cacheHeaders = new Headers();
    cacheHeaders.set('Content-Type', resolveContentType(targetUrl, upstream.headers.get('content-type')));
    cacheHeaders.set('Cache-Control', 'public, max-age=31536000, immutable');
    for (const h of ['content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
      const val = upstream.headers.get(h);
      if (val) cacheHeaders.set(h, val);
    }

    const contentLength = Number(upstream.headers.get('content-length') || 0);
    const shouldCache = Boolean(
      cache &&
      method === 'GET' &&
      upstream.status === 200 &&
      contentLength <= MAX_CACHEABLE_BYTES
    );

    if (shouldCache) {
      const cacheable = new Response(upstream.body, {
        status: 200,
        headers: cacheHeaders,
      });
      const clientCopy = cacheable.clone();
      const putPromise = cache.put(new Request(cacheKeyUrl, { method: 'GET' }), cacheable).catch(() => {});
      if (ctx && typeof ctx.waitUntil === 'function') {
        ctx.waitUntil(putPromise);
      }
      return new Response(clientCopy.body, {
        status: 200,
        headers: applyProxyResponseHeaders(clientCopy.headers, cors, 'MISS'),
      });
    }

    return new Response(method === 'HEAD' ? null : upstream.body, {
      status: upstream.status,
      headers: applyProxyResponseHeaders(cacheHeaders, cors, 'BYPASS'),
    });
  } catch (err) {
    return new Response(`SWF Proxy Error: ${err.message}`, {
      status: 502,
      headers: cors,
    });
  }
}

function isAllowedFeedbackRequest(request) {
  const origin = request.headers.get('origin');
  if (origin) return isAllowedBrowserOrigin(origin);

  const referer = request.headers.get('referer');
  if (referer) {
    try {
      return isAllowedBrowserOrigin(new URL(referer).origin);
    } catch {
      return false;
    }
  }
  return false;
}

function checkMemoryRateLimit(ip) {
  const now = Date.now();
  const windowMs = 5 * 60 * 1000;
  const maxHits = 3;
  const arr = (ipHits.get(ip) || []).filter((ts) => now - ts < windowMs);
  if (arr.length >= maxHits) return false;
  arr.push(now);
  ipHits.set(ip, arr);
  if (ipHits.size > 500) {
    for (const [k, v] of ipHits.entries()) {
      if (!v.some((ts) => now - ts < windowMs)) ipHits.delete(k);
    }
  }
  return true;
}

function formatMessageText(data) {
  const kind = String(data.kind || data.tur || 'Bildirim').trim().slice(0, 40);
  const subject = String(data.subject || data.konu || '-').trim().slice(0, 100);
  const msg = String(data.message || data.mesaj || '-').trim().slice(0, 400);
  const contact = String(data.contact || data.iletisim || 'Misafir').trim().slice(0, 60);
  return `[Gekkotari ${kind}]\nKonu: ${subject}\nKim: ${contact}\nMesaj: ${msg}`;
}

function encodeBasicAuth(user, pass) {
  const bytes = new TextEncoder().encode(`${user}:${pass}`);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function sendTwilioSms(text, env) {
  const sid = env?.TWILIO_ACCOUNT_SID;
  const token = env?.TWILIO_AUTH_TOKEN;
  const from = env?.TWILIO_FROM_NUMBER;
  const to = env?.NOTIFY_SMS_TO;
  if (!sid || !token || !from || !to) return null;

  const body = new URLSearchParams({ To: to, From: from, Body: text });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${encodeBasicAuth(sid, token)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Twilio ${res.status}: ${errText.slice(0, 120)}`);
  }
  return 'twilio';
}

async function sendNetgsmSms(text, env) {
  const usercode = env?.NETGSM_USERCODE;
  const password = env?.NETGSM_PASSWORD;
  const msgheader = env?.NETGSM_MSGHEADER;
  const gsm = env?.NOTIFY_SMS_TO;
  if (!usercode || !password || !msgheader || !gsm) return null;

  const cleanPhone = gsm.replace(/^\+?90/, '').replace(/\D/g, '');
  const safeText = text.replace(/]]>/g, ']]&gt;');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<mainbody>
  <header>
    <company dil="TR">Netgsm</company>
    <usercode>${usercode}</usercode>
    <password>${password}</password>
    <type>1:n</type>
    <msgheader>${msgheader}</msgheader>
  </header>
  <body>
    <msg><![CDATA[${safeText}]]></msg>
    <no>${cleanPhone}</no>
  </body>
</mainbody>`;

  const res = await fetch('https://api.netgsm.com.tr/sms/send/xml', {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
    body: xml,
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Netgsm ${res.status}`);
  return 'netgsm';
}

async function sendTelegramPush(text, env) {
  const botToken = env?.TELEGRAM_BOT_TOKEN;
  const chatId = env?.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return null;

  const res = await fetch(`https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Telegram ${res.status}`);
  return 'telegram';
}

async function sendNtfyPush(text, env) {
  const topic = env?.NTFY_TOPIC;
  if (!topic) return null;

  const res = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
    method: 'POST',
    headers: {
      Title: 'Gekkotari Yeni Bildirim',
      Priority: 'high',
    },
    body: text,
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`ntfy ${res.status}`);
  return 'ntfy';
}

export async function handleNotifyFeedback(request, env) {
  if (request.method === 'OPTIONS') {
    if (!isAllowedFeedbackRequest(request)) {
      return new Response('Forbidden origin', { status: 403 });
    }
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': request.headers.get('origin') || 'https://gekkotari.com',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, x-webhook-secret',
        Vary: 'Origin',
      },
    });
  }

  if (request.method !== 'POST') {
    return Response.json({ ok: false, error: 'Method Not Allowed' }, { status: 405 });
  }

  const webhookSecret = env?.FEEDBACK_WEBHOOK_SECRET;
  const providedSecret = request.headers.get('x-webhook-secret');
  const isWebhook = Boolean(webhookSecret && providedSecret === webhookSecret);

  if (!isWebhook && !isAllowedFeedbackRequest(request)) {
    return Response.json({ ok: false, error: 'Forbidden origin' }, { status: 403 });
  }

  const clientIp = (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for') ||
    'local'
  ).split(',')[0].trim();

  if (!isWebhook && !checkMemoryRateLimit(clientIp)) {
    return Response.json({ ok: false, error: 'Rate limit exceeded' }, { status: 429 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const data = (body && body.record && typeof body.record === 'object') ? body.record : body;
  if (!data || (!data.subject && !data.konu && !data.message && !data.mesaj)) {
    return Response.json({ ok: false, error: 'Missing feedback content' }, { status: 400 });
  }

  const text = formatMessageText(data);
  const channels = [sendTwilioSms, sendNetgsmSms, sendTelegramPush, sendNtfyPush];
  const delivered = [];
  const errors = [];

  for (const sender of channels) {
    try {
      const ch = await sender(text, env);
      if (ch) delivered.push(ch);
    } catch (err) {
      errors.push(err.message);
    }
  }

  if (!delivered.length && !errors.length) {
    return Response.json({
      ok: true,
      configured: false,
      message: 'SMS/Push provider env vars are not configured yet.',
    }, { status: 202 });
  }

  return Response.json({
    ok: delivered.length > 0,
    configured: true,
    delivered,
    errors: errors.length ? errors : undefined,
  }, { status: delivered.length > 0 ? 200 : 502 });
}

async function fetchStaticAsset(request, env, pathnameOverride, searchOverride) {
  if (!env?.ASSETS || typeof env.ASSETS.fetch !== 'function') {
    return null;
  }
  const target = new URL(request.url);
  if (pathnameOverride) target.pathname = pathnameOverride;
  if (searchOverride !== undefined) target.search = searchOverride;
  return env.ASSETS.fetch(new Request(target.toString(), { method: request.method === 'HEAD' ? 'HEAD' : 'GET' }));
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (
      pathname === '/api/swf-proxy' ||
      pathname === '/swf_proxy.php' ||
      pathname.startsWith('/p/')
    ) {
      return handleSwfProxy(request, env, ctx);
    }

    if (pathname === '/api/notify-feedback') {
      return handleNotifyFeedback(request, env);
    }

    if (pathname === '/rastgele.php') {
      const res = await fetchStaticAsset(request, env, '/oyun.html', '?random=1');
      if (res) return res;
    }

    const legacyTarget = LEGACY_ASSET_REWRITES[pathname];
    if (legacyTarget) {
      const res = await fetchStaticAsset(request, env, legacyTarget);
      if (res) return res;
    }

    if (pathname.startsWith('/oyun/')) {
      const key = decodeURIComponent(pathname.slice('/oyun/'.length)).replace(/^\/+|\/+$/g, '');
      const slugById = GAME_ID_TO_SLUG[key];
      if (slugById) {
        return Response.redirect(`${url.origin}/oyun/${slugById}`, 301);
      }
      // Also support `/oyun/51` or `/oyun.html` fallback if requested without static match
      const idQuery = url.searchParams.get('id');
      if (!key && idQuery && GAME_ID_TO_SLUG[idQuery]) {
        return Response.redirect(`${url.origin}/oyun/${GAME_ID_TO_SLUG[idQuery]}`, 301);
      }
    }

    // Fallback: serve 404.html with HTTP 404 when no static asset or route matched
    const notFoundAsset = await fetchStaticAsset(request, env, '/404.html', '');
    if (notFoundAsset && notFoundAsset.ok) {
      const headers = new Headers(notFoundAsset.headers);
      headers.set('Content-Type', 'text/html; charset=utf-8');
      headers.set('Cache-Control', 'public, max-age=60');
      return new Response(request.method === 'HEAD' ? null : notFoundAsset.body, {
        status: 404,
        headers,
      });
    }

    return new Response('Sayfa Bulunamadı', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  },
};
