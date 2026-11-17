const ALLOWED_BROWSER_ORIGINS = new Set([
  'https://gekkotari.com',
  'https://www.gekkotari.com',
  'https://gekotari.vercel.app',
  'http://localhost:8765',
  'http://127.0.0.1:8765',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);

const ALLOWED_UPSTREAM_SUFFIXES = [
  'archive.org',
  'archive-it.org',
];

function buildCorsHeaders(request) {
  const origin = request ? request.headers.get('origin') : null;
  let allowOrigin = 'https://gekkotari.com';
  if (origin) {
    if (ALLOWED_BROWSER_ORIGINS.has(origin) || /^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}$/i.test(origin)) {
      allowOrigin = origin;
    } else if (/^https:\/\/gekotari-[a-z0-9-]+\.vercel\.app$/i.test(origin)) {
      allowOrigin = origin;
    } else {
      return null;
    }
  }
  return {
    'Access-Control-Allow-Origin': allowOrigin,
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
    // Block localhost, IPv6/IPv4 literals, and any non-allowlisted host
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

export async function OPTIONS(request) {
  const cors = buildCorsHeaders(request);
  if (!cors) {
    return new Response('Forbidden origin', { status: 403 });
  }
  return new Response(null, { status: 204, headers: cors });
}

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

async function proxySwf(request) {
  const cors = buildCorsHeaders(request);
  if (!cors) {
    return new Response('Origin not allowed', { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const rawUrl = searchParams.get('url');
  const rawPath = searchParams.get('path');

  if (!rawUrl && !rawPath) {
    return new Response('Missing url parameter', { status: 400, headers: cors });
  }

  let targetUrl = '';
  if (rawUrl) {
    targetUrl = rawUrl.trim().replace(/ /g, '%20');
  } else {
    targetUrl = rawPath.trim().replace(/^https\/+/i, 'https://').replace(/ /g, '%20');
  }

  if (!isAllowedUpstreamUrl(targetUrl)) {
    return new Response('Invalid or disallowed upstream URL', { status: 400, headers: cors });
  }

  const upstreamHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    Accept: '*/*',
  };
  const rangeHeader = request.headers.get('range');
  if (rangeHeader) {
    upstreamHeaders.Range = rangeHeader;
  }

  const method = request.method === 'HEAD' ? 'HEAD' : 'GET';

  try {
    let upstream = await fetchWithSafeRedirects(targetUrl, method, upstreamHeaders);
    if (upstream.status >= 502 && upstream.status <= 504) {
      upstream = await fetchWithSafeRedirects(targetUrl, method, upstreamHeaders);
    }

    if (!upstream.ok && upstream.status !== 206) {
      console.error('SWF proxy upstream status:', upstream.status, targetUrl);
      return new Response('Upstream error: ' + upstream.status, {
        status: upstream.status,
        headers: cors,
      });
    }

    const headers = new Headers(cors);
    headers.set('Content-Type', resolveContentType(targetUrl, upstream.headers.get('content-type')));
    headers.set('Cache-Control', 'public, s-maxage=31536000, max-age=31536000, immutable');
    headers.set('X-Content-Type-Options', 'nosniff');

    for (const h of ['content-length', 'content-range', 'accept-ranges']) {
      const val = upstream.headers.get(h);
      if (val) headers.set(h, val);
    }

    return new Response(method === 'HEAD' ? null : upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (err) {
    console.error('SWF proxy fetch error:', err.message, targetUrl);
    return new Response('SWF Proxy Error: ' + err.message, {
      status: 502,
      headers: cors,
    });
  }
}

export async function GET(request) {
  return proxySwf(request);
}

export async function HEAD(request) {
  return proxySwf(request);
}
