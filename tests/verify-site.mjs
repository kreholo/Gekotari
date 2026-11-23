import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import worker, {
  handleNotifyFeedback,
  handleSwfProxy,
  isAllowedUpstreamUrl,
} from '../src/worker.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');

function loadCatalog() {
  const ctx = { window: {} };
  const raw = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'games-data.js'), 'utf8');
  vm.runInNewContext(raw, ctx);
  return ctx.window.GEKKOTARI_DEFAULT_DATA;
}

function assertValidJsSyntax(relPath) {
  const full = path.join(ROOT, relPath);
  const code = fs.readFileSync(full, 'utf8');
  new vm.Script(code, { filename: relPath });
}

function createDistAssetsEnv() {
  return {
    ASSETS: {
      async fetch(req) {
        const url = new URL(req.url);
        let rel = url.pathname.replace(/^\/+/, '');
        if (!rel) rel = 'index.html';
        let filePath = path.join(DIST, rel);
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          filePath = path.join(DIST, `${rel}.html`);
        }
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          return new Response('Not Found', { status: 404 });
        }
        const ext = path.extname(filePath).toLowerCase();
        const type = ext === '.html' ? 'text/html; charset=utf-8' : 'application/octet-stream';
        return new Response(fs.readFileSync(filePath), {
          status: 200,
          headers: { 'Content-Type': type },
        });
      },
    },
  };
}

async function runTests() {
  // 1. Catalog integrity checks
  const data = loadCatalog();
  assert.ok(Array.isArray(data.oyunlar), 'oyunlar array missing');
  assert.ok(data.oyunlar.length >= 785, `Expected >= 785 games, got ${data.oyunlar.length}`);
  const fistPunch = data.oyunlar.find((g) => String(g.id) === '109');
  assert.ok(
    fistPunch && fistPunch.oyun_linki.includes('regular-show-fist-punch/Fist%20Punch.zip/b7a892a0/b7a892a0.swf'),
    'Regular Show Fist Punch (#109) must use complete zip package entrypoint'
  );

  const ids = new Set();
  const slugs = new Set();
  const validCats = new Set(data.kategoriler.map((c) => c.kategori_adi));

  for (const g of data.oyunlar) {
    const id = String(g.id);
    assert.ok(!ids.has(id), `Duplicate game id: ${id}`);
    ids.add(id);

    assert.ok(g.slug && /^[a-z0-9-]+$/.test(g.slug), `Invalid slug for #${id}: ${g.slug}`);
    assert.ok(!slugs.has(g.slug), `Duplicate slug: ${g.slug}`);
    slugs.add(g.slug);

    assert.ok(validCats.has(g.kategori_adi), `Unknown category on #${id}: ${g.kategori_adi}`);
    assert.ok(g.aciklama && g.aciklama.length >= 30, `Description too short on #${id}`);
    assert.ok(!g.aciklama.includes('Ruffle emülatörü ile'), `Generic template desc left on #${id}`);
    assert.ok(!String(g.oyun_linki).includes('gamedistribution.com'), `GD embed left on #${id}`);
    assert.ok(g.gorsel && g.gorsel !== 'default_game.png', `Missing cover on #${id}`);
    assert.ok(!String(g.gorsel).includes('gamedistribution.com'), `External GD thumbnail left on #${id}`);
    assert.ok(!String(g.gorsel).startsWith('http'), `External slow/unreliable thumbnail URL left on #${id}: ${g.gorsel}`);

    const localImg = path.join(ROOT, String(g.gorsel).split('?')[0]);
    assert.ok(fs.existsSync(localImg), `Missing local cover file on #${id}: ${g.gorsel}`);
    assert.ok(fs.statSync(localImg).size >= 500, `Cover file suspiciously small on #${id}: ${g.gorsel}`);
    if (!String(g.oyun_linki).startsWith('http')) {
      const localGame = path.join(ROOT, g.oyun_linki);
      assert.ok(fs.existsSync(localGame), `Missing local game HTML on #${id}: ${g.oyun_linki}`);
    }
  }
  console.log(`[PASS] Catalog integrity verified (${data.oyunlar.length} games, unique IDs/slugs, 0 GD URLs, 0 missing covers)`);

  // 2. Required files, icons, SEO domain consistency, Cloudflare config
  const requiredFiles = [
    '404.html',
    'ads.txt',
    'favicon.ico',
    'manifest.json',
    'robots.txt',
    'sitemap.xml',
    'sw.js',
    'wrangler.jsonc',
    'src/worker.js',
    'assets/icon-192.png',
    'assets/icon-512.png',
    'assets/apple-touch-icon.png',
    'assets/favicon-32.png',
  ];
  for (const rel of requiredFiles) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `Missing required asset/file: ${rel}`);
  }

  for (const htmlFile of ['index.html', 'kategori.html', 'oyun.html', 'sayfa.html', 'robots.txt', 'sitemap.xml']) {
    const txt = fs.readFileSync(path.join(ROOT, htmlFile), 'utf8');
    assert.ok(!txt.includes('gekotari.vercel.app'), `Stale vercel.app domain reference found in ${htmlFile}`);
    assert.ok(!txt.includes('/_vercel/'), `Stale /_vercel/ reference found in ${htmlFile}`);
  }
  const adsTxt = fs.readFileSync(path.join(ROOT, 'ads.txt'), 'utf8');
  assert.ok(adsTxt.includes('pub-7220337370405776'), 'ads.txt publisher ID missing');
  const indexTxt = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(indexTxt.includes('ca-pub-7220337370405776'), 'index.html AdSense tag missing');
  const commonTxt = fs.readFileSync(path.join(ROOT, 'assets/js/common.js'), 'utf8');
  assert.ok(!commonTxt.includes('Admin123'), 'Hardcoded Admin123 password must not exist in common.js');
  assert.ok(!commonTxt.includes('/_vercel/insights/script.js'), 'Vercel analytics script injection must be removed');

  for (const jsRel of ['assets/js/ads-config.js', 'assets/js/supabase-sync.js', 'assets/js/common.js', 'assets/js/games-data.js']) {
    assertValidJsSyntax(jsRel);
  }
  console.log('[PASS] Required PWA/SEO files, JS syntax, and security checks passed');

  // 3. Unit tests for Cloudflare Worker SWF proxy allowlist & SSRF defenses
  assert.equal(isAllowedUpstreamUrl('https://archive.org/download/stick-war/Stick%20War.swf'), true);
  assert.equal(isAllowedUpstreamUrl('https://ia801900.us.archive.org/12/items/test/a.swf'), true);
  assert.equal(isAllowedUpstreamUrl('http://archive.org/download/a.swf'), false, 'Must block plaintext HTTP');
  assert.equal(isAllowedUpstreamUrl('https://127.0.0.1/secret'), false, 'Must block loopback IP');
  assert.equal(isAllowedUpstreamUrl('https://169.254.169.254/latest/meta-data/'), false, 'Must block metadata IP');
  assert.equal(isAllowedUpstreamUrl('https://evil.example.com/payload.swf'), false, 'Must block non-allowlisted domain');

  const evilOriginRes = await handleSwfProxy(
    new Request('https://gekkotari.com/api/swf-proxy?url=https://archive.org/download/x/y.swf', {
      headers: { origin: 'https://evil-leecher.com' },
    })
  );
  assert.equal(evilOriginRes.status, 403, 'Must reject third-party browser Origin CORS');

  const preflightRes = await handleSwfProxy(
    new Request('https://gekkotari.com/api/swf-proxy', {
      method: 'OPTIONS',
      headers: { origin: 'https://gekkotari.workers.dev' },
    })
  );
  assert.equal(preflightRes.status, 204, 'OPTIONS preflight must succeed for *.workers.dev');
  assert.equal(preflightRes.headers.get('access-control-allow-origin'), 'https://gekkotari.workers.dev');

  const ssrfRes = await handleSwfProxy(
    new Request('https://gekkotari.com/api/swf-proxy?url=https://example.com/test.swf')
  );
  assert.equal(ssrfRes.status, 400, 'Must reject disallowed upstream domain');

  const pSsrfRes = await worker.fetch(
    new Request('https://gekkotari.com/p/https/evil.example.com/payload.swf'),
    createDistAssetsEnv()
  );
  assert.equal(pSsrfRes.status, 400, '/p/* route must enforce upstream allowlist');
  console.log('[PASS] Worker SWF Proxy SSRF / allowlist / CORS unit tests passed');

  // 4. Static pre-rendered dist/oyun/*.html checks & Worker routing fallback tests
  assert.ok(fs.existsSync(path.join(DIST, '_headers')), 'dist/_headers missing');
  assert.ok(fs.existsSync(path.join(DIST, 'sitemap.xml')), 'dist/sitemap.xml missing');

  const waterHtmlPath = path.join(DIST, 'oyun', 'water-sort-puzzle-3.html');
  assert.ok(fs.existsSync(waterHtmlPath), 'Pre-rendered water-sort-puzzle-3.html missing');
  const gameHtml = fs.readFileSync(waterHtmlPath, 'utf8');
  assert.ok(gameHtml.includes('<title>Water Sort Puzzle 3 Oyna - Gekkotari</title>'), 'Pre-rendered title missing');
  assert.ok(gameHtml.includes('<meta property="og:title" content="Water Sort Puzzle 3 Oyna - Gekkotari">'), 'Pre-rendered og:title missing');
  assert.ok(gameHtml.includes('https://gekkotari.com/oyun/water-sort-puzzle-3'), 'Pre-rendered canonical URL missing');
  assert.ok(gameHtml.includes('"@type":"BreadcrumbList"'), 'Pre-rendered BreadcrumbList schema missing');
  assert.ok(gameHtml.includes('"@type":"VideoGame"'), 'Pre-rendered VideoGame schema missing');
  assert.ok(gameHtml.includes('https://gekkotari.com/assets/icon-512.png'), 'Pre-rendered SVG cover must fall back to icon-512.png');

  const rasterHtmlPath = path.join(DIST, 'oyun', 'bad-ice-cream-2-kotu-dondurma-2.html');
  assert.ok(fs.existsSync(rasterHtmlPath), 'Pre-rendered bad-ice-cream-2-kotu-dondurma-2.html missing');
  const rasterHtml = fs.readFileSync(rasterHtmlPath, 'utf8');
  assert.ok(
    rasterHtml.includes('https://gekkotari.com/assets/img/covers/bad-ice-cream-2-kotu-dondurma-2.png'),
    'Pre-rendered raster cover og:image missing'
  );

  const testEnv = createDistAssetsEnv();
  const redirectRes = await worker.fetch(new Request('https://gekkotari.com/oyun/51'), testEnv);
  assert.equal(redirectRes.status, 301, 'Numeric game ID /oyun/51 must 301 redirect to slug');
  assert.equal(redirectRes.headers.get('location'), 'https://gekkotari.com/oyun/ates-ve-su-1-orman-tapinagi');

  const adminRes = await worker.fetch(new Request('https://gekkotari.com/admin'), testEnv);
  assert.equal(adminRes.status, 200, 'Legacy /admin route must serve admin.html');

  const notFoundRes = await worker.fetch(new Request('https://gekkotari.com/oyun/olmayan-bir-oyun-xyz'), testEnv);
  assert.equal(notFoundRes.status, 404, 'Unknown game slug must return HTTP 404');
  console.log(`[PASS] Pre-rendered ${data.oyunlar.length} static game pages, 301 ID redirects, & 404 Worker fallback passed`);

  // 5. Unit tests for Worker notify-feedback origin guard & unconfigured safe status
  const badNotify = await handleNotifyFeedback(
    new Request('https://gekkotari.com/api/notify-feedback', {
      method: 'POST',
      headers: { origin: 'https://evil-spam.example', 'content-type': 'application/json' },
      body: JSON.stringify({ konu: 'Test', mesaj: 'Deneme' }),
    }),
    {}
  );
  assert.equal(badNotify.status, 403, 'Notify endpoint must reject foreign origin');

  const validNotify = await handleNotifyFeedback(
    new Request('https://gekkotari.com/api/notify-feedback', {
      method: 'POST',
      headers: { origin: 'https://gekkotari.com', 'content-type': 'application/json' },
      body: JSON.stringify({ tur: 'Oyun İste', konu: 'Test Oyunu', mesaj: 'Merhaba' }),
    }),
    {}
  );
  assert.equal(validNotify.status, 202, 'Notify endpoint must return 202 safely when env secrets are unset');
  console.log('[PASS] Worker feedback notify API origin guard & safe fallback unit tests passed');
}

runTests().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});
