import { TEMPLATE_HTML, NOT_FOUND_HTML, GAMES_META } from './_ssr-data.js';

const BASE_URL = 'https://gekkotari.com';

function escapeAttr(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeJsonScript(obj) {
  return JSON.stringify(obj).replace(/<\//g, '<\\/');
}

const bySlug = new Map();
const byId = new Map();
for (const g of GAMES_META) {
  bySlug.set(g.slug, g);
  byId.set(String(g.id), g);
}

export function renderGamePageHtml(game) {
  const canonicalUrl = `${BASE_URL}/oyun/${game.slug}`;
  const title = `${game.name} Oyna - Gekkotari`;
  const desc = game.desc || `${game.name} oyununu Gekkotari üzerinde ücretsiz ve reklamsız oyna!`;
  // Social bots (WhatsApp, Discord) require PNG/JPEG/WebP for og:image; use local or remote raster cover when available, PNG fallback for SVG covers
  const rawImg = String(game.image || '');
  const cleanImg = rawImg.split('?')[0].toLowerCase();
  const isRasterImg = /\.(png|jpe?g|webp)$/i.test(cleanImg);
  const ogImage = isRasterImg
    ? (rawImg.startsWith('http') ? rawImg : `${BASE_URL}/${rawImg.replace(/^\/+/, '')}`)
    : `${BASE_URL}/assets/icon-512.png`;

  const videoGameSchema = {
    '@context': 'https://schema.org',
    '@type': 'VideoGame',
    name: game.name,
    description: desc,
    genre: game.cat,
    playMode: game.is2P ? 'MultiPlayer' : 'SinglePlayer',
    gamePlatform: ['Web Browser', game.isSwf ? 'Flash (Ruffle WebAssembly)' : 'HTML5'],
    image: ogImage,
    url: canonicalUrl,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'TRY', availability: 'https://schema.org/InStock' },
  };

  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Ana Sayfa', item: `${BASE_URL}/` },
      { '@type': 'ListItem', position: 2, name: game.cat, item: `${BASE_URL}/kategori.html?tur=${encodeURIComponent(game.cat)}` },
      { '@type': 'ListItem', position: 3, name: game.name, item: canonicalUrl },
    ],
  };

  const headInject = `<base href="/">
    <script>window.__INITIAL_GAME_ID__ = ${JSON.stringify(String(game.id))};</script>
    <script type="application/ld+json">${escapeJsonScript(videoGameSchema)}</script>
    <script type="application/ld+json">${escapeJsonScript(breadcrumbSchema)}</script>`;

  return TEMPLATE_HTML
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${escapeAttr(desc)}">`)
    .replace(/<meta name="keywords" content="[^"]*">/, `<meta name="keywords" content="${escapeAttr(game.keywords || game.name)}">`)
    .replace(/<link rel="canonical" id="canonicalLink" href="[^"]*">/, `<link rel="canonical" id="canonicalLink" href="${escapeAttr(canonicalUrl)}">`)
    .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${escapeAttr(title)}">`)
    .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${escapeAttr(desc)}">`)
    .replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${escapeAttr(canonicalUrl)}">`)
    .replace(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${escapeAttr(ogImage)}">`)
    .replace(/<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${escapeAttr(title)}">`)
    .replace(/<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${escapeAttr(desc)}">`)
    .replace(/<meta name="twitter:image" content="[^"]*">/, `<meta name="twitter:image" content="${escapeAttr(ogImage)}">`)
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeAttr(title)}</title>`)
    .replace('<!--SSR_HEAD_SLOT-->', headInject);
}

export async function GET(request) {
  const url = new URL(request.url);
  let slug = url.searchParams.get('slug') || '';
  if (!slug && url.pathname.startsWith('/oyun/')) {
    slug = decodeURIComponent(url.pathname.slice('/oyun/'.length));
  }
  slug = slug.replace(/^\/+|\/+$/g, '');

  const idParam = url.searchParams.get('id');
  const game = (slug && bySlug.get(slug)) || (idParam && byId.get(String(idParam))) || (slug && byId.get(slug));

  if (!game) {
    return new Response(NOT_FOUND_HTML, {
      status: 404,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=60',
      },
    });
  }

  // Canonical redirect if visited by raw numeric slug `/oyun/16`
  if (slug && slug === String(game.id) && slug !== game.slug) {
    return Response.redirect(`${BASE_URL}/oyun/${game.slug}`, 301);
  }

  return new Response(renderGamePageHtml(game), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
