import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');
const SITE = 'https://gekkotari.com';

const ROOT_STATIC_FILES = [
  '404.html',
  'admin.html',
  'ads.txt',
  'favicon.ico',
  'giris.html',
  'index.html',
  'kategori.html',
  'kayit.html',
  'kutuphane.html',
  'manifest.json',
  'oyun.html',
  'robots.txt',
  'sayfa.html',
  'sw.js',
];

const STATIC_DIRS = ['assets', 'games'];

const HEADERS_FILE = `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  X-Frame-Options: SAMEORIGIN

/sw.js
  Cache-Control: public, max-age=0, must-revalidate

/assets/stub.swf
  Cache-Control: public, max-age=31536000, immutable

/assets/stub-as2.swf
  Cache-Control: public, max-age=31536000, immutable

/assets/stub.flv
  Cache-Control: public, max-age=31536000, immutable

/assets/stub.txt
  Cache-Control: public, max-age=31536000, immutable

/assets/icon-192.png
  Cache-Control: public, max-age=31536000, immutable

/assets/icon-512.png
  Cache-Control: public, max-age=31536000, immutable

/assets/icon-192.svg
  Cache-Control: public, max-age=31536000, immutable

/assets/apple-touch-icon.png
  Cache-Control: public, max-age=31536000, immutable

/assets/favicon-32.png
  Cache-Control: public, max-age=31536000, immutable

/assets/img/*
  Cache-Control: public, max-age=3600, stale-while-revalidate=86400

/assets/css/*
  Cache-Control: public, max-age=3600, stale-while-revalidate=86400

/assets/js/*
  Cache-Control: public, max-age=3600, stale-while-revalidate=86400
`;

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

function loadCatalog() {
  const ctx = { window: {} };
  const raw = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'games-data.js'), 'utf8');
  vm.runInNewContext(raw, ctx);
  return ctx.window.GEKKOTARI_DEFAULT_DATA;
}

function renderGamePageHtml(game, templateHtml) {
  const canonicalUrl = `${SITE}/oyun/${game.slug}`;
  const title = `${game.name} Oyna - Gekkotari`;
  const desc = game.desc || `${game.name} oyununu Gekkotari üzerinde ücretsiz ve reklamsız oyna!`;

  // Social crawlers (WhatsApp, Discord, OpenGraph) require raster PNG/JPEG/WebP images
  const rawImg = String(game.image || '');
  const cleanImg = rawImg.split('?')[0].toLowerCase();
  const isRasterImg = /\.(png|jpe?g|webp)$/i.test(cleanImg);
  const ogImage = isRasterImg
    ? (rawImg.startsWith('http') ? rawImg : `${SITE}/${rawImg.replace(/^\/+/, '')}`)
    : `${SITE}/assets/icon-512.png`;

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
      { '@type': 'ListItem', position: 1, name: 'Ana Sayfa', item: `${SITE}/` },
      { '@type': 'ListItem', position: 2, name: game.cat, item: `${SITE}/kategori.html?tur=${encodeURIComponent(game.cat)}` },
      { '@type': 'ListItem', position: 3, name: game.name, item: canonicalUrl },
    ],
  };

  const headInject = `<base href="/">
    <script>window.__INITIAL_GAME_ID__ = ${JSON.stringify(String(game.id))};</script>
    <script type="application/ld+json">${escapeJsonScript(videoGameSchema)}</script>
    <script type="application/ld+json">${escapeJsonScript(breadcrumbSchema)}</script>`;

  return templateHtml
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

function buildSitemapXml(categories, gamesMeta) {
  const urls = [
    { loc: `${SITE}/`, changefreq: 'daily', priority: '1.0' },
    { loc: `${SITE}/index.html`, changefreq: 'daily', priority: '1.0' },
    { loc: `${SITE}/kategori.html`, changefreq: 'daily', priority: '0.9' },
    { loc: `${SITE}/sayfa.html?slug=hakkimizda`, changefreq: 'monthly', priority: '0.5' },
    { loc: `${SITE}/sayfa.html?slug=gizlilik`, changefreq: 'monthly', priority: '0.5' },
    { loc: `${SITE}/sayfa.html?slug=kullanim-sartlari`, changefreq: 'monthly', priority: '0.4' },
    { loc: `${SITE}/sayfa.html?slug=telif-dmca`, changefreq: 'monthly', priority: '0.4' },
  ];

  for (const k of categories) {
    urls.push({
      loc: `${SITE}/kategori.html?tur=${encodeURIComponent(k.kategori_adi)}`,
      changefreq: 'weekly',
      priority: '0.8',
    });
  }

  for (const g of gamesMeta) {
    urls.push({
      loc: `${SITE}/oyun/${g.slug}`,
      changefreq: 'weekly',
      priority: '0.8',
    });
  }

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemap.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${u.loc}</loc><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`).join('\n') +
    `\n</urlset>\n`
  );
}

function main() {
  const data = loadCatalog();
  const templateHtml = fs.readFileSync(path.join(ROOT, 'oyun.html'), 'utf8');

  const gamesMeta = data.oyunlar.map((g) => ({
    id: String(g.id),
    slug: g.slug,
    name: g.oyun_adi,
    desc: g.aciklama,
    cat: g.kategori_adi,
    keywords: g.anahtar_kelimeler || '',
    image: g.gorsel || '',
    isSwf: String(g.oyun_linki || '').toLowerCase().endsWith('.swf'),
    is2P: Array.isArray(g.modlar) && g.modlar.includes('2 Kişilik'),
  }));

  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(path.join(DIST, 'oyun'), { recursive: true });

  for (const rel of ROOT_STATIC_FILES) {
    const src = path.join(ROOT, rel);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(DIST, rel));
    }
  }

  for (const dir of STATIC_DIRS) {
    const srcDir = path.join(ROOT, dir);
    if (fs.existsSync(srcDir)) {
      fs.cpSync(srcDir, path.join(DIST, dir), { recursive: true });
    }
  }

  const idToSlug = {};
  for (const game of gamesMeta) {
    const html = renderGamePageHtml(game, templateHtml);
    fs.writeFileSync(path.join(DIST, 'oyun', `${game.slug}.html`), html, 'utf8');
    if (game.id !== game.slug) {
      idToSlug[game.id] = game.slug;
    }
  }

  const sitemapXml = buildSitemapXml(data.kategoriler, gamesMeta);
  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), sitemapXml, 'utf8');
  fs.writeFileSync(path.join(DIST, 'sitemap.xml'), sitemapXml, 'utf8');
  fs.writeFileSync(path.join(DIST, '_headers'), HEADERS_FILE, 'utf8');

  fs.mkdirSync(path.join(ROOT, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, 'src', 'game-redirects.js'),
    `// Auto-generated by scripts/build-cf.mjs — numeric ID -> slug redirects\nexport const GAME_ID_TO_SLUG = ${JSON.stringify(idToSlug)};\n`,
    'utf8'
  );

  console.log(`Built Cloudflare dist/: ${gamesMeta.length} pre-rendered /oyun/*.html pages + static assets + _headers.`);
}

main();
