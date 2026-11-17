import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { GET as handleGamePage } from '../api/game-page.js';
import { GET as handleSwfProxy, isAllowedUpstreamUrl } from '../api/swf-proxy.js';

const ROOT = path.resolve(import.meta.dirname, '..');

function loadCatalog() {
  const ctx = { window: {} };
  const raw = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'games-data.js'), 'utf8');
  vm.runInNewContext(raw, ctx);
  return ctx.window.GEKKOTARI_DEFAULT_DATA;
}

function assertValidJsSyntax(relPath) {
  const full = path.join(ROOT, relPath);
  const code = fs.readFileSync(full, 'utf8');
  // Parse syntax safely without executing browser globals
  new vm.Script(code, { filename: relPath });
}

async function runTests() {
  // 1. Catalog integrity checks
  const data = loadCatalog();
  assert.ok(Array.isArray(data.oyunlar), 'oyunlar array missing');
  assert.ok(data.oyunlar.length >= 200, `Expected >= 200 games, got ${data.oyunlar.length}`);

  const ids = new Set();
  const slugs = new Set();
  const validCats = new Set(data.kategoriler.map(c => c.kategori_adi));

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

    if (!String(g.gorsel).startsWith('http')) {
      const localImg = path.join(ROOT, String(g.gorsel).split('?')[0]);
      assert.ok(fs.existsSync(localImg), `Missing local cover file on #${id}: ${g.gorsel}`);
    }
    if (!String(g.oyun_linki).startsWith('http')) {
      const localGame = path.join(ROOT, g.oyun_linki);
      assert.ok(fs.existsSync(localGame), `Missing local game HTML on #${id}: ${g.oyun_linki}`);
    }
  }
  console.log(`[PASS] Catalog integrity verified (${data.oyunlar.length} games, unique IDs/slugs, 0 GD URLs, 0 missing covers)`);

  // 2. Required files, icons, SEO domain consistency
  const requiredFiles = [
    '404.html',
    'ads.txt',
    'favicon.ico',
    'manifest.json',
    'robots.txt',
    'sitemap.xml',
    'sw.js',
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
  }
  const commonTxt = fs.readFileSync(path.join(ROOT, 'assets/js/common.js'), 'utf8');
  assert.ok(!commonTxt.includes('Admin123'), 'Hardcoded Admin123 password must not exist in common.js');

  for (const jsRel of ['assets/js/ads-config.js', 'assets/js/supabase-sync.js', 'assets/js/common.js', 'assets/js/games-data.js']) {
    assertValidJsSyntax(jsRel);
  }
  console.log('[PASS] Required PWA/SEO files, JS syntax, and security checks passed');

  // 3. Unit tests for api/swf-proxy.js allowlist & SSRF defenses
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

  const ssrfRes = await handleSwfProxy(
    new Request('https://gekkotari.com/api/swf-proxy?url=https://example.com/test.swf')
  );
  assert.equal(ssrfRes.status, 400, 'Must reject disallowed upstream domain');
  console.log('[PASS] SWF Proxy SSRF / allowlist / CORS unit tests passed');

  // 4. Unit tests for SSR Game Page (/api/game-page.js)
  const gameRes = await handleGamePage(new Request('https://gekkotari.com/oyun/water-sort-puzzle-3'));
  assert.equal(gameRes.status, 200);
  const gameHtml = await gameRes.text();
  assert.ok(gameHtml.includes('<title>Water Sort Puzzle 3 Oyna - Gekkotari</title>'), 'SSR title missing');
  assert.ok(gameHtml.includes('<meta property="og:title" content="Water Sort Puzzle 3 Oyna - Gekkotari">'), 'SSR og:title missing');
  assert.ok(gameHtml.includes('https://gekkotari.com/oyun/water-sort-puzzle-3'), 'SSR canonical URL missing');
  assert.ok(gameHtml.includes('"@type":"BreadcrumbList"'), 'SSR BreadcrumbList schema missing');
  assert.ok(gameHtml.includes('"@type":"VideoGame"'), 'SSR VideoGame schema missing');

  const notFoundRes = await handleGamePage(new Request('https://gekkotari.com/oyun/olmayan-bir-oyun-xyz'));
  assert.equal(notFoundRes.status, 404, 'Unknown game slug must return HTTP 404');
  console.log('[PASS] SSR game page & 404 unit tests passed');
}

runTests().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});
