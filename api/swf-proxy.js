const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

function isAllowedUpstreamUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    // Block localhost / private IP literals to prevent SSRF
    if (
      host === 'localhost' ||
      host === '0.0.0.0' ||
      host.startsWith('127.') ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      host.startsWith('169.254.') ||
      host === '::1'
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
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

async function proxySwf(request) {
  const { searchParams } = new URL(request.url);
  const rawUrl = searchParams.get('url');
  const rawPath = searchParams.get('path');

  if (!rawUrl && !rawPath) {
    return new Response('Missing url parameter', { status: 400, headers: CORS_HEADERS });
  }

  let targetUrl = '';
  if (rawUrl) {
    targetUrl = rawUrl.trim().replace(/ /g, '%20');
  } else {
    targetUrl = rawPath.trim().replace(/^https\/+/i, 'https://').replace(/ /g, '%20');
  }

  if (!isAllowedUpstreamUrl(targetUrl)) {
    return new Response('Invalid or disallowed upstream URL', { status: 400, headers: CORS_HEADERS });
  }

  try {
    const upstreamHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      Accept: '*/*',
    };
    const rangeHeader = request.headers.get('range');
    if (rangeHeader) {
      upstreamHeaders.Range = rangeHeader;
    }

    const upstream = await fetch(targetUrl, {
      method: request.method === 'HEAD' ? 'HEAD' : 'GET',
      redirect: 'follow',
      headers: upstreamHeaders,
    });

    if (!upstream.ok && upstream.status !== 206) {
      console.error('SWF proxy upstream status:', upstream.status, targetUrl);
      return new Response('Upstream error: ' + upstream.status, {
        status: upstream.status,
        headers: CORS_HEADERS,
      });
    }

    const headers = new Headers(CORS_HEADERS);
    headers.set('Content-Type', resolveContentType(targetUrl, upstream.headers.get('content-type')));
    headers.set('Cache-Control', 'public, s-maxage=31536000, max-age=31536000, immutable');

    for (const h of ['content-length', 'content-range', 'accept-ranges']) {
      const val = upstream.headers.get(h);
      if (val) headers.set(h, val);
    }

    return new Response(request.method === 'HEAD' ? null : upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (err) {
    console.error('SWF proxy fetch error:', err.message, targetUrl);
    return new Response('SWF Proxy Error: ' + err.message, {
      status: 502,
      headers: CORS_HEADERS,
    });
  }
}

export async function GET(request) {
  return proxySwf(request);
}

export async function HEAD(request) {
  return proxySwf(request);
}
