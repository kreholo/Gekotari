/**
 * GEKKOTARI - SUPABASE VERİTABANI, AUTH, LİDERLİK & YÖNETİM SENKRONİZASYONU
 * --------------------------------------------------------------------------
 * Saf fetch + REST/Auth API kullanarak oyun sayaçları, puanlar, yorumlar,
 * liderlik tablosu, cihazlar arası kütüphane, katalog güncellemeleri ve
 * rol tabanlı yönetici işlemlerini sıfır ek kütüphane maliyetiyle yürütür.
 */
(function (window) {
    const SB_URL = 'https://rltpodnczpcwnefovitz.supabase.co';
    const SB_KEY = 'sb_publishable_CWqdH2KzKlaBgINVJwCafQ_iEh3zsUU';
    const STATS_CACHE_KEY = 'gekkotari_stats_cache_v2';
    const STATS_TTL_MS = 15000;
    const OVERRIDES_CACHE_KEY = 'gekkotari_overrides_cache_v1';
    const OVERRIDES_TTL_MS = 30000;
    const AUTH_STORAGE_KEY = 'gekkotari_sb_session_v1';

    function readStoredSession() {
        try {
            const raw = localStorage.getItem(AUTH_STORAGE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    }

    function writeStoredSession(sessionObj) {
        try {
            if (!sessionObj) {
                localStorage.removeItem(AUTH_STORAGE_KEY);
                return;
            }
            localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(sessionObj));
        } catch {}
    }

    function mapAuthUserToLocal(user) {
        if (!user) return null;
        const meta = user.user_metadata || {};
        const appMeta = user.app_metadata || {};
        const username = meta.username || meta.kullanici_adi || (user.email ? user.email.split('@')[0] : 'oyuncu');
        const fullName = meta.full_name || meta.ad_soyad || username;
        const role = appMeta.role || 'user';
        return {
            id: user.id,
            email: user.email || '',
            kullanici_adi: username,
            ad_soyad: fullName,
            rol_adi: role,
            isAdmin: role === 'admin'
        };
    }

    function syncActiveUserCache(user) {
        try {
            const mapped = mapAuthUserToLocal(user);
            if (mapped) {
                localStorage.setItem('aktifOturum', JSON.stringify(mapped));
            } else {
                localStorage.removeItem('aktifOturum');
            }
            return mapped;
        } catch {
            return null;
        }
    }

    async function sbRequest(path, opts = {}) {
        const { authToken, headers: customHeaders, ...rest } = opts;
        const headers = Object.assign({
            apikey: SB_KEY,
            'Content-Type': 'application/json'
        }, customHeaders || {});
        if (authToken) {
            headers.Authorization = 'Bearer ' + authToken;
        }
        const res = await fetch(SB_URL + path, Object.assign({}, rest, { headers }));
        const ct = res.headers.get('content-type') || '';
        let payload = null;
        if (ct.includes('application/json')) {
            payload = await res.json().catch(() => null);
        } else {
            payload = await res.text().catch(() => '');
        }
        if (!res.ok) {
            const msg = (payload && (payload.msg || payload.error_description || payload.message || payload.hint)) ||
                (typeof payload === 'string' && payload) ||
                `Supabase ${res.status}`;
            const err = new Error(msg);
            err.status = res.status;
            err.payload = payload;
            throw err;
        }
        return payload;
    }

    async function ensureValidAccessToken() {
        const sess = readStoredSession();
        if (!sess || !sess.access_token) return null;
        const nowSec = Math.floor(Date.now() / 1000);
        if (sess.expires_at && sess.expires_at - 45 > nowSec) {
            return sess.access_token;
        }
        if (!sess.refresh_token) {
            writeStoredSession(null);
            syncActiveUserCache(null);
            return null;
        }
        try {
            const refreshed = await sbRequest('/auth/v1/token?grant_type=refresh_token', {
                method: 'POST',
                body: JSON.stringify({ refresh_token: sess.refresh_token })
            });
            if (refreshed && refreshed.access_token) {
                const updated = {
                    access_token: refreshed.access_token,
                    refresh_token: refreshed.refresh_token || sess.refresh_token,
                    expires_at: Math.floor(Date.now() / 1000) + Number(refreshed.expires_in || 3600),
                    user: refreshed.user || sess.user
                };
                writeStoredSession(updated);
                syncActiveUserCache(updated.user);
                return updated.access_token;
            }
        } catch {
            writeStoredSession(null);
            syncActiveUserCache(null);
        }
        return null;
    }

    function rowsToStatsMap(rows) {
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

    function getSessionCache(key, ttlMs) {
        try {
            const raw = sessionStorage.getItem(key);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (Date.now() - parsed.ts < ttlMs) return parsed.data;
        } catch {}
        return null;
    }

    function setSessionCache(key, data) {
        try {
            sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
        } catch {}
    }

    function invalidateStatsCache() {
        try { sessionStorage.removeItem(STATS_CACHE_KEY); } catch {}
    }

    function invalidateOverridesCache() {
        try { sessionStorage.removeItem(OVERRIDES_CACHE_KEY); } catch {}
    }

    // --- OYUN İSTATİSTİKLERİ ---
    async function fetchAllGameStats(forceFresh = false) {
        if (!forceFresh) {
            const cached = getSessionCache(STATS_CACHE_KEY, STATS_TTL_MS);
            if (cached) return cached;
        }
        const rows = await sbRequest('/rest/v1/game_stats?select=game_id,plays,rating_sum,rating_count');
        const map = rowsToStatsMap(rows);
        setSessionCache(STATS_CACHE_KEY, map);
        return map;
    }

    async function recordRemotePlay(gameId) {
        const idNum = parseInt(gameId, 10);
        if (!idNum || idNum < 1 || idNum > 99999) return null;
        invalidateStatsCache();
        const rows = await sbRequest('/rest/v1/rpc/increment_game_play', {
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
        const rows = await sbRequest('/rest/v1/rpc/submit_game_rating', {
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

    // --- YORUMLAR & GERİ BİLDİRİM ---
    async function fetchRemoteComments(gameId) {
        const idNum = parseInt(gameId, 10);
        if (!idNum) return [];
        const rows = await sbRequest(`/rest/v1/game_comments?game_id=eq.${idNum}&select=id,author,body,created_at&order=created_at.desc&limit=50`);
        return Array.isArray(rows) ? rows : [];
    }

    async function postRemoteComment(gameId, author, body) {
        const idNum = parseInt(gameId, 10);
        if (!idNum) return null;
        const token = await ensureValidAccessToken();
        return sbRequest('/rest/v1/game_comments', {
            method: 'POST',
            authToken: token,
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify({
                game_id: idNum,
                author: String(author || 'Misafir').trim().slice(0, 60),
                body: String(body || '').trim().slice(0, 500)
            })
        });
    }

    async function submitRemoteFeedback(entry) {
        const token = await ensureValidAccessToken();
        return sbRequest('/rest/v1/game_feedback', {
            method: 'POST',
            authToken: token,
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

    // --- KÜRESEL LİDERLİK TABLOSU ---
    async function fetchTopScores(gameId, limit = 10) {
        const idNum = parseInt(gameId, 10);
        if (!idNum) return [];
        const rows = await sbRequest(`/rest/v1/game_scores?game_id=eq.${idNum}&select=id,player_name,score,created_at&order=score.desc,created_at.asc&limit=${limit}`);
        return Array.isArray(rows) ? rows : [];
    }

    async function submitGameScore(gameId, playerName, score) {
        const idNum = parseInt(gameId, 10);
        const sNum = Math.round(Number(score));
        if (!idNum || !sNum || sNum < 1) return null;
        const token = await ensureValidAccessToken();
        return sbRequest('/rest/v1/game_scores', {
            method: 'POST',
            authToken: token,
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify({
                game_id: idNum,
                player_name: String(playerName || 'Misafir').trim().slice(0, 32),
                score: Math.min(10000000, sNum)
            })
        });
    }

    // --- KATALOG DÜZENLEME OVERRIDE'LARI ---
    async function fetchCatalogOverrides(forceFresh = false) {
        if (!forceFresh) {
            const cached = getSessionCache(OVERRIDES_CACHE_KEY, OVERRIDES_TTL_MS);
            if (cached) return cached;
        }
        const rows = await sbRequest('/rest/v1/catalog_overrides?select=game_id,action,payload,updated_at');
        const list = Array.isArray(rows) ? rows : [];
        setSessionCache(OVERRIDES_CACHE_KEY, list);
        return list;
    }

    // --- SONUÇSUZ ARAMA ÖLÇÜMÜ ---
    async function recordZeroSearch(query) {
        const clean = String(query || '').trim().replace(/\s+/g, ' ').slice(0, 80);
        if (clean.length < 2) return;
        const flagKey = 'gekkotari_zs_' + clean.toLowerCase();
        try {
            if (sessionStorage.getItem(flagKey)) return;
            sessionStorage.setItem(flagKey, '1');
        } catch {}
        try {
            await sbRequest('/rest/v1/rpc/record_zero_search', {
                method: 'POST',
                body: JSON.stringify({ p_query: clean })
            });
        } catch {}
    }

    // --- SUPABASE AUTH + PROFIL + BULUT KÜTÜPHANESİ ---
    async function upsertOwnProfile(user, token) {
        if (!user || !token) return;
        const meta = user.user_metadata || {};
        const username = String(meta.username || meta.kullanici_adi || (user.email ? user.email.split('@')[0] : 'oyuncu')).trim().slice(0, 40);
        const fullName = String(meta.full_name || meta.ad_soyad || username).trim().slice(0, 80);
        if (username.length < 2) return;
        try {
            await sbRequest('/rest/v1/profiles?on_conflict=user_id', {
                method: 'POST',
                authToken: token,
                headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
                body: JSON.stringify({
                    user_id: user.id,
                    username,
                    full_name: fullName
                })
            });
        } catch {}
    }

    async function authSignUp({ email, password, username, fullName }) {
        const redirectTo = window.location.origin.startsWith('http')
            ? window.location.origin + '/giris.html'
            : 'https://gekkotari.com/giris.html';
        const data = await sbRequest('/auth/v1/signup', {
            method: 'POST',
            body: JSON.stringify({
                email: String(email || '').trim(),
                password: String(password || ''),
                data: {
                    username: String(username || '').trim().slice(0, 40),
                    full_name: String(fullName || username || '').trim().slice(0, 80)
                },
                options: { emailRedirectTo: redirectTo }
            })
        });
        if (data && data.access_token && data.user) {
            const sess = {
                access_token: data.access_token,
                refresh_token: data.refresh_token,
                expires_at: Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600),
                user: data.user
            };
            writeStoredSession(sess);
            await upsertOwnProfile(data.user, data.access_token);
            await syncLocalLibraryToCloud();
            return { user: syncActiveUserCache(data.user), needsEmailConfirm: false };
        }
        return { user: data && data.user ? mapAuthUserToLocal(data.user) : null, needsEmailConfirm: true };
    }

    async function authSignIn({ email, password }) {
        const data = await sbRequest('/auth/v1/token?grant_type=password', {
            method: 'POST',
            body: JSON.stringify({
                email: String(email || '').trim(),
                password: String(password || '')
            })
        });
        if (!data || !data.access_token || !data.user) {
            throw new Error('Giriş yanıtı alınamadı.');
        }
        const sess = {
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            expires_at: Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600),
            user: data.user
        };
        writeStoredSession(sess);
        await upsertOwnProfile(data.user, data.access_token);
        const mapped = syncActiveUserCache(data.user);
        await syncLocalLibraryToCloud();
        return mapped;
    }

    async function authRecover(email) {
        const redirectTo = window.location.origin.startsWith('http')
            ? window.location.origin + '/giris.html'
            : 'https://gekkotari.com/giris.html';
        return sbRequest('/auth/v1/recover', {
            method: 'POST',
            body: JSON.stringify({
                email: String(email || '').trim(),
                options: { redirectTo }
            })
        });
    }

    async function authResendConfirm(email) {
        return sbRequest('/auth/v1/resend', {
            method: 'POST',
            body: JSON.stringify({
                type: 'signup',
                email: String(email || '').trim()
            })
        });
    }

    async function authRefreshCurrentUser() {
        const token = await ensureValidAccessToken();
        if (!token) return null;
        try {
            const user = await sbRequest('/auth/v1/user', { authToken: token });
            const sess = readStoredSession();
            if (sess) {
                sess.user = user;
                writeStoredSession(sess);
            }
            return syncActiveUserCache(user);
        } catch (err) {
            if (err.status === 401 || err.status === 403) {
                writeStoredSession(null);
                syncActiveUserCache(null);
            }
            return null;
        }
    }

    async function authSignOut() {
        const token = await ensureValidAccessToken();
        if (token) {
            try {
                await sbRequest('/auth/v1/logout', { method: 'POST', authToken: token });
            } catch {}
        }
        writeStoredSession(null);
        syncActiveUserCache(null);
    }

    async function fetchUserLibrary() {
        const token = await ensureValidAccessToken();
        if (!token) return null;
        const rows = await sbRequest('/rest/v1/user_library?select=game_id,created_at&order=created_at.desc', {
            authToken: token
        });
        return Array.isArray(rows) ? rows : [];
    }

    async function addToUserLibrary(gameId) {
        const token = await ensureValidAccessToken();
        const sess = readStoredSession();
        const idNum = parseInt(gameId, 10);
        if (!token || !sess || !sess.user || !idNum) return false;
        await sbRequest('/rest/v1/user_library?on_conflict=user_id,game_id', {
            method: 'POST',
            authToken: token,
            headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify({ user_id: sess.user.id, game_id: idNum })
        });
        return true;
    }

    async function removeFromUserLibrary(gameId) {
        const token = await ensureValidAccessToken();
        const sess = readStoredSession();
        const idNum = parseInt(gameId, 10);
        if (!token || !sess || !sess.user || !idNum) return false;
        await sbRequest(`/rest/v1/user_library?user_id=eq.${sess.user.id}&game_id=eq.${idNum}`, {
            method: 'DELETE',
            authToken: token
        });
        return true;
    }

    async function syncLocalLibraryToCloud() {
        const token = await ensureValidAccessToken();
        const sess = readStoredSession();
        if (!token || !sess || !sess.user) return null;
        try {
            const localRaw = localStorage.getItem('gekkotari_kutuphane');
            const localList = localRaw ? JSON.parse(localRaw) : [];
            const remoteRows = await fetchUserLibrary();
            const remoteSet = new Set((remoteRows || []).map(r => String(r.game_id)));
            const toUpload = [];
            for (const item of localList) {
                const gid = parseInt(item.oyun_id, 10);
                if (gid && !remoteSet.has(String(gid))) {
                    toUpload.push({ user_id: sess.user.id, game_id: gid });
                }
            }
            if (toUpload.length) {
                await sbRequest('/rest/v1/user_library?on_conflict=user_id,game_id', {
                    method: 'POST',
                    authToken: token,
                    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
                    body: JSON.stringify(toUpload)
                });
            }
            const merged = await fetchUserLibrary();
            if (Array.isArray(merged)) {
                localStorage.setItem('gekkotari_kutuphane', JSON.stringify(
                    merged.map(r => ({ oyun_id: String(r.game_id), ekleme_tarihi: r.created_at }))
                ));
            }
            return merged;
        } catch {
            return null;
        }
    }

    // --- YÖNETİCİ İŞLEMLERİ (Yalnızca admin JWT ile RLS tarafından onaylanır) ---
    async function requireAdminToken() {
        const token = await ensureValidAccessToken();
        if (!token) throw new Error('Yönetici oturumu gerekli.');
        return token;
    }

    async function adminFetchFeedback() {
        const token = await requireAdminToken();
        return sbRequest('/rest/v1/game_feedback?select=*&order=created_at.desc&limit=200', { authToken: token });
    }

    async function adminUpdateFeedback(id, patch) {
        const token = await requireAdminToken();
        return sbRequest(`/rest/v1/game_feedback?id=eq.${parseInt(id, 10)}`, {
            method: 'PATCH',
            authToken: token,
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify(patch)
        });
    }

    async function adminDeleteFeedback(id) {
        const token = await requireAdminToken();
        return sbRequest(`/rest/v1/game_feedback?id=eq.${parseInt(id, 10)}`, {
            method: 'DELETE',
            authToken: token
        });
    }

    async function adminFetchRecentComments(limit = 100) {
        const token = await requireAdminToken();
        return sbRequest(`/rest/v1/game_comments?select=id,game_id,author,body,created_at&order=created_at.desc&limit=${limit}`, {
            authToken: token
        });
    }

    async function adminDeleteComment(id) {
        const token = await requireAdminToken();
        return sbRequest(`/rest/v1/game_comments?id=eq.${parseInt(id, 10)}`, {
            method: 'DELETE',
            authToken: token
        });
    }

    async function adminFetchZeroSearches() {
        const token = await requireAdminToken();
        return sbRequest('/rest/v1/zero_result_searches?select=*&order=hits.desc,last_searched_at.desc&limit=100', {
            authToken: token
        });
    }

    async function adminDeleteZeroSearch(queryNorm) {
        const token = await requireAdminToken();
        return sbRequest(`/rest/v1/zero_result_searches?query_norm=eq.${encodeURIComponent(queryNorm)}`, {
            method: 'DELETE',
            authToken: token
        });
    }

    async function adminUpsertCatalogOverride(gameId, action, payload = {}) {
        const token = await requireAdminToken();
        const sess = readStoredSession();
        invalidateOverridesCache();
        return sbRequest('/rest/v1/catalog_overrides?on_conflict=game_id', {
            method: 'POST',
            authToken: token,
            headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
            body: JSON.stringify({
                game_id: parseInt(gameId, 10),
                action,
                payload,
                updated_at: new Date().toISOString(),
                updated_by: sess && sess.user ? sess.user.id : null
            })
        });
    }

    async function adminDeleteCatalogOverride(gameId) {
        const token = await requireAdminToken();
        invalidateOverridesCache();
        return sbRequest(`/rest/v1/catalog_overrides?game_id=eq.${parseInt(gameId, 10)}`, {
            method: 'DELETE',
            authToken: token
        });
    }

    async function adminFetchAllScores(limit = 100) {
        const token = await requireAdminToken();
        return sbRequest(`/rest/v1/game_scores?select=*&order=created_at.desc&limit=${limit}`, { authToken: token });
    }

    async function adminDeleteScore(id) {
        const token = await requireAdminToken();
        return sbRequest(`/rest/v1/game_scores?id=eq.${parseInt(id, 10)}`, {
            method: 'DELETE',
            authToken: token
        });
    }

    // --- DOM YARDIMCISI ---
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
        fetchTopScores,
        submitGameScore,
        fetchCatalogOverrides,
        recordZeroSearch,
        authSignUp,
        authSignIn,
        authRecover,
        authResendConfirm,
        authRefreshCurrentUser,
        authSignOut,
        fetchUserLibrary,
        addToUserLibrary,
        removeFromUserLibrary,
        syncLocalLibraryToCloud,
        adminFetchFeedback,
        adminUpdateFeedback,
        adminDeleteFeedback,
        adminFetchRecentComments,
        adminDeleteComment,
        adminFetchZeroSearches,
        adminDeleteZeroSearch,
        adminUpsertCatalogOverride,
        adminDeleteCatalogOverride,
        adminFetchAllScores,
        adminDeleteScore,
        applyLiveStatsToDom,
        invalidateStatsCache,
        invalidateOverridesCache
    };
})(window);
