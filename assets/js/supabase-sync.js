/**
 * GEKKOTARİ - SUPABASE GERÇEK ZAMANLI VERİTABANI SENKRONİZASYONU
 * -----------------------------------------------------------------
 * Cihazlar arası ortak oynanma sayacı, gerçek puanlar, ortak yorumlar
 * ve geri bildirimleri sıfır ekstra kütüphane yüküyle (saf fetch) yönetir.
 */
(function (window) {
    const SB_URL = 'https://rltpodnczpcwnefovitz.supabase.co';
    const SB_KEY = 'sb_publishable_CWqdH2KzKlaBgINVJwCafQ_iEh3zsUU';
    const CACHE_KEY = 'gekkotari_stats_cache_v1';
    const CACHE_TTL_MS = 15000;

    async function sbFetch(path, opts = {}) {
        const headers = Object.assign({
            apikey: SB_KEY,
            'Content-Type': 'application/json'
        }, opts.headers || {});
        const res = await fetch(SB_URL + path, Object.assign({}, opts, { headers }));
        if (!res.ok) {
            const errTxt = await res.text().catch(() => '');
            throw new Error(`Supabase ${res.status}: ${errTxt}`);
        }
        const ct = res.headers.get('content-type') || '';
        return ct.includes('application/json') ? res.json() : null;
    }

    function rowsToMap(rows) {
        const map = {};
        if (!Array.isArray(rows)) return map;
        for (const r of rows) {
            const id = String(r.game_id);
            const cnt = Number(r.rating_count || 0);
            const sum = Number(r.rating_sum || 0);
            map[id] = {
                plays: Number(r.plays || 0),
                ratingCount: cnt,
                rating: cnt > 0 ? Number((sum / cnt).toFixed(1)) : 0
            };
        }
        return map;
    }

    function getCachedStatsMap() {
        try {
            const raw = sessionStorage.getItem(CACHE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (Date.now() - parsed.ts < CACHE_TTL_MS) return parsed.map;
        } catch (e) {}
        return null;
    }

    function setCachedStatsMap(map) {
        try {
            sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), map }));
        } catch (e) {}
    }

    function invalidateStatsCache() {
        try { sessionStorage.removeItem(CACHE_KEY); } catch (e) {}
    }

    async function fetchAllGameStats(forceFresh = false) {
        if (!forceFresh) {
            const cached = getCachedStatsMap();
            if (cached) return cached;
        }
        const rows = await sbFetch('/rest/v1/game_stats?select=game_id,plays,rating_sum,rating_count');
        const map = rowsToMap(rows);
        setCachedStatsMap(map);
        return map;
    }

    async function recordRemotePlay(gameId) {
        const idNum = parseInt(gameId, 10);
        if (!idNum || idNum < 1 || idNum > 9999) return null;
        invalidateStatsCache();
        const rows = await sbFetch('/rest/v1/rpc/increment_game_play', {
            method: 'POST',
            body: JSON.stringify({ p_game_id: idNum })
        });
        const row = Array.isArray(rows) ? rows[0] : rows;
        if (!row) return null;
        const cnt = Number(row.rating_count || 0);
        const sum = Number(row.rating_sum || 0);
        return {
            plays: Number(row.plays || 0),
            ratingCount: cnt,
            rating: cnt > 0 ? Number((sum / cnt).toFixed(1)) : 0
        };
    }

    async function submitRemoteRating(gameId, score) {
        const idNum = parseInt(gameId, 10);
        const sNum = Math.round(Number(score));
        if (!idNum || sNum < 1 || sNum > 5) return null;
        invalidateStatsCache();
        const rows = await sbFetch('/rest/v1/rpc/submit_game_rating', {
            method: 'POST',
            body: JSON.stringify({ p_game_id: idNum, p_score: sNum })
        });
        const row = Array.isArray(rows) ? rows[0] : rows;
        if (!row) return null;
        const cnt = Number(row.rating_count || 0);
        const sum = Number(row.rating_sum || 0);
        return {
            plays: Number(row.plays || 0),
            ratingCount: cnt,
            rating: cnt > 0 ? Number((sum / cnt).toFixed(1)) : 0
        };
    }

    async function fetchRemoteComments(gameId) {
        const idNum = parseInt(gameId, 10);
        if (!idNum) return [];
        const rows = await sbFetch(`/rest/v1/game_comments?game_id=eq.${idNum}&select=id,author,body,created_at&order=created_at.desc&limit=50`);
        return Array.isArray(rows) ? rows : [];
    }

    async function postRemoteComment(gameId, author, body) {
        const idNum = parseInt(gameId, 10);
        if (!idNum) return null;
        return sbFetch('/rest/v1/game_comments', {
            method: 'POST',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify({
                game_id: idNum,
                author: String(author || 'Misafir').trim().slice(0, 60),
                body: String(body || '').trim().slice(0, 500)
            })
        });
    }

    async function submitRemoteFeedback(entry) {
        return sbFetch('/rest/v1/game_feedback', {
            method: 'POST',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({
                kind: String(entry.tur || 'Oneri').trim().slice(0, 40),
                subject: String(entry.konu || '').trim().slice(0, 120),
                message: String(entry.mesaj || '').trim().slice(0, 1000),
                contact: String(entry.iletisim || 'Misafir').trim().slice(0, 120),
                page_url: String(entry.sayfa || window.location.href).slice(0, 400)
            })
        });
    }

    function applyLiveStatsToDom(map) {
        if (!map) return;
        document.querySelectorAll('[data-game-plays]').forEach(el => {
            const st = map[el.getAttribute('data-game-plays')];
            if (st) el.textContent = st.plays.toLocaleString('tr-TR');
        });
        document.querySelectorAll('[data-game-rating]').forEach(el => {
            const st = map[el.getAttribute('data-game-rating')];
            if (st && st.rating > 0) {
                el.innerHTML = `<i class="fas fa-star"></i> ${st.rating.toFixed(1)}`;
                el.style.display = '';
            }
        });
    }

    window.GekkotariDB = {
        fetchAllGameStats,
        recordRemotePlay,
        submitRemoteRating,
        fetchRemoteComments,
        postRemoteComment,
        submitRemoteFeedback,
        applyLiveStatsToDom,
        invalidateStatsCache
    };
})(window);
