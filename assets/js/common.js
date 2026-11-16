/**
 * GEKKOTARİ - ORTAK SİSTEM VE VERİ YÖNETİMİ (Common JS v8)
 * Hafif Bellek Veri Okuma + Supabase Canlı Senkronizasyon + Tek-Sekme Semantik Kartlar
 */

const DATA_VERSION = 'gekkotari_v9_2026_11';

function initGekkotariStore() {
    const currentVer = localStorage.getItem('gekkotari_version');
    if (currentVer !== DATA_VERSION) {
        // Eski şişkin localStorage kopyalarını temizle (RAM'deki GEKKOTARI_DEFAULT_DATA doğrudan kullanılır)
        localStorage.removeItem('gekkotari_games');
        localStorage.removeItem('gekkotari_categories');
        localStorage.removeItem('gekkotari_sliders');
        localStorage.removeItem('gekkotari_pages');
        localStorage.setItem('gekkotari_version', DATA_VERSION);
    }

    if (!localStorage.getItem('gekkotari_users')) {
        const defaultUsers = [
            {
                id: 1,
                ad_soyad: 'Site Yöneticisi',
                kullanici_adi: 'admin',
                email: 'admin@gekkotari.com',
                sifre: 'Admin123',
                rol_adi: 'super_admin',
                olusturma_tarihi: '2026-05-01 12:00:00'
            }
        ];
        localStorage.setItem('gekkotari_users', JSON.stringify(defaultUsers));
    }
}

initGekkotariStore();

function getGames() {
    try {
        const customRaw = localStorage.getItem('gekkotari_custom_games');
        if (customRaw) return JSON.parse(customRaw);
    } catch (e) {}
    return (window.GEKKOTARI_DEFAULT_DATA && window.GEKKOTARI_DEFAULT_DATA.oyunlar) || [];
}

function saveGames(games) {
    try {
        localStorage.setItem('gekkotari_custom_games', JSON.stringify(games));
    } catch (e) {}
}

function getCategories() {
    return (window.GEKKOTARI_DEFAULT_DATA && window.GEKKOTARI_DEFAULT_DATA.kategoriler) || [];
}

function getSliders() {
    return (window.GEKKOTARI_DEFAULT_DATA && window.GEKKOTARI_DEFAULT_DATA.slider) || [];
}

function getPages() {
    return (window.GEKKOTARI_DEFAULT_DATA && window.GEKKOTARI_DEFAULT_DATA.sayfalar) || [];
}

function getUsers() {
    try {
        const raw = localStorage.getItem('gekkotari_users');
        if (raw) return JSON.parse(raw);
    } catch (e) {}
    return [];
}

function saveUsers(users) {
    localStorage.setItem('gekkotari_users', JSON.stringify(users));
}

function getActiveUser() {
    try {
        const raw = localStorage.getItem('aktifOturum');
        if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null;
}

function setActiveUser(user) {
    localStorage.setItem('aktifOturum', JSON.stringify(user));
}

function logoutUser() {
    localStorage.removeItem('aktifOturum');
    showToast('info', 'Başarıyla çıkış yapıldı.');
    setTimeout(() => {
        window.location.href = 'index.html';
    }, 450);
}

function normalizeTr(str) {
    if (!str) return '';
    return String(str)
        .replace(/İ/g, 'i')
        .replace(/I/g, 'i')
        .toLowerCase()
        .replace(/ı/g, 'i')
        .replace(/ğ/g, 'g')
        .replace(/ü/g, 'u')
        .replace(/ş/g, 's')
        .replace(/ö/g, 'o')
        .replace(/ç/g, 'c')
        .replace(/['’`]/g, '');
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatNumber(num) {
    const n = parseInt(num, 10) || 0;
    return n.toLocaleString('tr-TR');
}

function showToast(tip, mesaj) {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'toast-container position-fixed top-0 end-0 p-3';
        container.style.zIndex = '9999';
        document.body.appendChild(container);
    }
    const ikonMap = {
        success: 'fas fa-check-circle',
        danger: 'fas fa-exclamation-triangle',
        warning: 'fas fa-exclamation-circle',
        info: 'fas fa-info-circle'
    };
    const ikon = ikonMap[tip] || 'fas fa-bell';
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
        <div class="alert alert-${tip} alert-dismissible fade show d-flex align-items-center shadow-sm mb-2" role="alert" style="animation: slideDown 0.3s ease-out;">
            <i class="${ikon} me-2 fs-5"></i>
            <div>${mesaj}</div>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="alert"></button>
        </div>
    `;
    container.appendChild(wrapper);
    setTimeout(() => {
        if (wrapper && wrapper.parentNode) wrapper.remove();
    }, 3500);
}

// --- SUPABASE CANLI İSTATİSTİK SENKRONİZASYONU ---
async function syncPortalLiveStats(onStatsReady) {
    if (!window.GekkotariDB) return null;
    try {
        const stats = await window.GekkotariDB.fetchAllGameStats();
        window.GEKKOTARI_LIVE_STATS = stats;
        window.GekkotariDB.applyLiveStatsToDom(stats);
        if (typeof onStatsReady === 'function') onStatsReady(stats);
        return stats;
    } catch (e) {
        return null;
    }
}

function getGameLiveStat(oyun) {
    const map = window.GEKKOTARI_LIVE_STATS || {};
    const live = map[String(oyun.id)];
    if (live) return live;
    return {
        plays: parseInt(oyun.oynama_sayisi || 0, 10) || 0,
        rating: Number(oyun.puan || 0) || 0,
        ratingCount: parseInt(oyun.puan_sayisi || 0, 10) || 0
    };
}

// --- SON OYNANANLAR & GÜNÜN OYUNU ---
function recordRecentPlay(oyunId) {
    try {
        const idStr = String(oyunId);
        let list = JSON.parse(localStorage.getItem('gekkotari_recent') || '[]');
        list = list.filter(x => String(x.id) !== idStr);
        list.unshift({ id: idStr, ts: Date.now() });
        localStorage.setItem('gekkotari_recent', JSON.stringify(list.slice(0, 12)));
    } catch (e) {}
}

function getRecentGames(limit = 5) {
    try {
        const list = JSON.parse(localStorage.getItem('gekkotari_recent') || '[]');
        const all = getGames();
        return list
            .map(item => all.find(g => String(g.id) === String(item.id)))
            .filter(Boolean)
            .slice(0, limit);
    } catch (e) {
        return [];
    }
}

function getDailyGame(games) {
    if (!games || !games.length) return null;
    const now = new Date();
    const seed = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
    return games[seed % games.length];
}

// --- REKLAM ALANI YÖNETİCİSİ ---
function renderAdSlot(mountId, slotId) {
    const el = document.getElementById(mountId);
    if (!el) return;
    const cfg = window.GEKKOTARI_ADS || { enabled: false, slots: {} };
    if (!cfg.enabled) {
        el.style.display = 'none';
        return;
    }
    const slot = (cfg.slots && cfg.slots[slotId]) || null;
    if (!slot) {
        el.style.display = 'none';
        return;
    }

    if (slot.html && slot.html.trim()) {
        el.innerHTML = `<div class="ad-slot-wrap"><div class="${escapeHtml(slot.sizeClass)}"></div></div>`;
        const box = el.querySelector('.' + slot.sizeClass);
        const frag = document.createRange().createContextualFragment(slot.html);
        box.appendChild(frag);
        return;
    }

    if (!cfg.showPlaceholderWhenEmpty) {
        el.style.display = 'none';
        return;
    }

    el.innerHTML = `
        <div class="ad-slot-wrap">
            <div class="${escapeHtml(slot.sizeClass)}">
                <div class="ad-placeholder-inner">
                    <span class="ad-placeholder-badge">${escapeHtml(slot.label)}</span>
                    <div>Gekkotari Destek & Sponsorluk Alanı</div>
                    <a href="#" onclick="openFeedbackModal('Oneri', ''); return false;" style="color:var(--primary);font-size:0.74rem;">
                        <i class="fas fa-bullhorn me-1"></i>Sponsorluk / İletişim
                    </a>
                </div>
            </div>
        </div>
    `;
}

// --- GERİ BİLDİRİM & OYUN İSTE MODALI ---
function ensureFeedbackModal() {
    if (document.getElementById('gekkotariFeedbackModal')) return;
    const modalHtml = `
    <div class="modal fade" id="gekkotariFeedbackModal" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title fw-bold">
                        <i class="fas fa-paper-plane me-2" style="color:var(--primary);"></i>Öneri, Oyun İsteği & Bildirim
                    </h5>
                    <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Kapat"></button>
                </div>
                <form id="gekkotariFeedbackForm">
                    <div class="modal-body">
                        <div class="mb-3">
                            <label class="form-label" for="fbTur">Bildirim Türü</label>
                            <select id="fbTur" class="form-select">
                                <option value="Oyun İste">Yeni Oyun İste</option>
                                <option value="Sorun Bildir">Açılmayan / Bozuk Oyun Bildir</option>
                                <option value="Oneri">Site Önerisi & Telif/İletişim</option>
                            </select>
                        </div>
                        <div class="mb-3">
                            <label class="form-label" for="fbKonu">Oyun Adı veya Konu</label>
                            <input type="text" id="fbKonu" class="form-control" placeholder="Örn: Red Ball 4 eklensin / Ses çalışmıyor" required>
                        </div>
                        <div class="mb-3">
                            <label class="form-label" for="fbMesaj">Mesajın</label>
                            <textarea id="fbMesaj" class="form-control" rows="3" placeholder="Detayı buraya yazabilirsin..." required></textarea>
                        </div>
                        <div class="mb-2">
                            <label class="form-label" for="fbIletisim">Rumuz veya E-posta (İsteğe bağlı)</label>
                            <input type="text" id="fbIletisim" class="form-control" placeholder="Oyuncu adın veya e-postan">
                        </div>
                    </div>
                    <div class="modal-footer justify-content-between">
                        <a id="fbMailtoLink" href="mailto:info@gekkotari.com" class="btn btn-outline-secondary btn-sm">
                            <i class="fas fa-envelope me-1"></i>E-posta ile Gönder
                        </a>
                        <button type="submit" class="btn btn-primary-custom px-4">
                            <i class="fas fa-check me-1"></i>Gönder
                        </button>
                    </div>
                </form>
            </div>
        </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    document.getElementById('gekkotariFeedbackForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const tur = document.getElementById('fbTur').value;
        const konu = document.getElementById('fbKonu').value.trim();
        const mesaj = document.getElementById('fbMesaj').value.trim();
        const iletisim = document.getElementById('fbIletisim').value.trim() || 'Misafir';

        const entry = {
            id: Date.now(),
            tur,
            konu,
            mesaj,
            iletisim,
            sayfa: window.location.href,
            tarih: new Date().toLocaleString('tr-TR')
        };

        try {
            const list = JSON.parse(localStorage.getItem('gekkotari_feedback') || '[]');
            list.unshift(entry);
            localStorage.setItem('gekkotari_feedback', JSON.stringify(list.slice(0, 100)));
        } catch (err) {}

        if (window.GekkotariDB) {
            try { await window.GekkotariDB.submitRemoteFeedback(entry); } catch (err) {}
        }

        const fbCfg = window.GEKKOTARI_FEEDBACK_CONFIG || {};
        if (fbCfg.discordWebhookUrl) {
            try {
                await fetch(fbCfg.discordWebhookUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        content: `**[Gekkotari - ${tur}]**\n**Konu:** ${konu}\n**Gönderen:** ${iletisim}\n**Mesaj:** ${mesaj}\n**Sayfa:** ${window.location.href}`
                    })
                });
            } catch (err) {}
        }

        if (fbCfg.web3formsAccessKey) {
            try {
                await fetch('https://api.web3forms.com/submit', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        access_key: fbCfg.web3formsAccessKey,
                        subject: `[Gekkotari ${tur}] ${konu}`,
                        from_name: iletisim,
                        message: `${mesaj}\n\nSayfa: ${window.location.href}`
                    })
                });
            } catch (err) {}
        }

        bootstrap.Modal.getInstance(document.getElementById('gekkotariFeedbackModal')).hide();
        document.getElementById('gekkotariFeedbackForm').reset();
        showToast('success', 'Geri bildirimin veritabanına kaydedildi, teşekkürler!');
    });
}

function openFeedbackModal(defaultTur = 'Oyun İste', defaultKonu = '') {
    ensureFeedbackModal();
    const turSel = document.getElementById('fbTur');
    const konuInp = document.getElementById('fbKonu');
    if (defaultTur) turSel.value = defaultTur;
    if (defaultKonu) konuInp.value = defaultKonu;
    const mailto = document.getElementById('fbMailtoLink');
    const email = (window.GEKKOTARI_FEEDBACK_CONFIG && window.GEKKOTARI_FEEDBACK_CONFIG.contactEmail) || 'info@gekkotari.com';
    mailto.href = `mailto:${email}?subject=${encodeURIComponent('[Gekkotari] ' + (defaultKonu || defaultTur))}`;
    new bootstrap.Modal(document.getElementById('gekkotariFeedbackModal')).show();
}

// --- İKON & KART YARDIMCILARI ---
function getGameIcon(oyun) {
    if (oyun.ikon && parseInt(oyun.id, 10) >= 100) return oyun.ikon;
    const name = (oyun.oyun_adi || '').toLowerCase();
    if (name.includes('ateş ve su') || name.includes('fireboy')) return 'fas fa-fire-alt';
    if (name.includes('savaş') || name.includes('war') || name.includes('strike') || name.includes('knights') || name.includes('tank')) return 'fas fa-shield-alt';
    if (name.includes('zombie') || name.includes('moto') || name.includes('racing') || name.includes('traffic')) return 'fas fa-motorcycle';
    if (name.includes('penguin') || name.includes('mix')) return 'fas fa-utensils';
    if (name.includes('snail') || name.includes('ant')) return 'fas fa-paw';
    if (name.includes('cursed') || name.includes('siege') || name.includes('castle')) return 'fas fa-chess-rook';
    if (name.includes('bob') || name.includes('vex') || name.includes('ovo') || name.includes('fancy')) return 'fas fa-running';
    return oyun.ikon || 'fas fa-gamepad';
}

function getCategoryColor(katAdi) {
    const map = {
        'Aksiyon': '#e55353',
        'Macera': '#f59e0b',
        'Strateji': '#38bdf8',
        'RPG': '#a855f7',
        'Spor': '#2ee57a',
        'Yarış': '#fb923c',
        'Korku': '#dc2626',
        'Klasik': '#14b8a6',
        'Simülasyon': '#64748b',
        'Bulmaca': '#10b981'
    };
    return map[katAdi] || '#2EE57A';
}

function renderGameCard(oyun, colClass = 'col') {
    const gorsel = oyun.gorsel || 'default_game.png';
    const renk = oyun.renk || getCategoryColor(oyun.kategori_adi);
    const ikon = getGameIcon(oyun);
    const hasImage = gorsel && gorsel !== 'default_game.png' && (gorsel.startsWith('http') || gorsel.startsWith('assets/'));
    const isSwf = (oyun.oyun_linki || '').toLowerCase().endsWith('.swf');
    const is2P = Array.isArray(oyun.modlar) && oyun.modlar.includes('2 Kişilik');
    const stat = getGameLiveStat(oyun);
    const gameUrl = `oyun.html?id=${oyun.id}`;

    let badgeColor = 'info text-dark';
    if (is2P || oyun.etiket === '2 Kişilik') badgeColor = 'success';
    else if (oyun.etiket === 'Popüler') badgeColor = 'warning text-dark';
    else if (oyun.etiket === 'Efsane') badgeColor = 'danger';
    else if (oyun.etiket === 'Yeni') badgeColor = 'success';

    const typePill = isSwf
        ? `<span class="badge bg-dark border border-secondary" style="position:absolute;bottom:7px;left:7px;z-index:2;font-size:0.64rem;opacity:0.92;"><i class="fas fa-bolt me-1 text-warning"></i>Flash</span>`
        : `<span class="badge bg-dark border border-secondary" style="position:absolute;bottom:7px;left:7px;z-index:2;font-size:0.64rem;opacity:0.92;"><i class="fab fa-html5 me-1 text-info"></i>HTML5</span>`;

    const posterHtml = hasImage
        ? `<div style="width:100%; height:100%; position:relative; background:linear-gradient(135deg, ${renk}55, var(--bg-darker)); display:flex; align-items:center; justify-content:center;">
               <img src="${escapeHtml(gorsel)}" alt="${escapeHtml(oyun.oyun_adi)}" loading="lazy" class="game-thumb"
                    style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:1;"
                    onerror="this.style.display='none';">
               <div class="d-flex flex-column align-items-center justify-content:center text-center p-2" style="z-index:0;">
                   <i class="${escapeHtml(ikon)} fa-2x mb-1" style="color:rgba(255,255,255,0.75);"></i>
                   <span class="fw-bold text-white small px-1">${escapeHtml(oyun.oyun_adi)}</span>
               </div>
           </div>`
        : `<div class="d-flex flex-column align-items-center justify-content:center text-center p-3"
                style="width:100%; height:100%; background:radial-gradient(circle at 30% 25%, ${renk}bb, #0d1512 85%);">
               <div style="width:46px;height:46px;border-radius:12px;background:rgba(255,255,255,0.12);display:flex;align-items:center;justify-content:center;margin-bottom:6px;border:1px solid rgba(255,255,255,0.18);">
                   <i class="${escapeHtml(ikon)} fa-lg text-white"></i>
               </div>
               <span class="fw-bold text-white" style="font-size:0.8rem;line-height:1.25;">${escapeHtml(oyun.oyun_adi)}</span>
           </div>`;

    return `
    <article class="${colClass}">
        <div class="game-card h-100 d-flex flex-column">
            <a href="${gameUrl}" class="d-block game-thumb-wrapper text-decoration-none">
                ${posterHtml}
                ${(is2P || oyun.etiket) ? `<span class="game-badge bg-${badgeColor}">${escapeHtml(is2P ? '2 Kişilik' : oyun.etiket)}</span>` : ''}
                <span class="game-rating" data-game-rating="${oyun.id}" style="${stat.rating > 0 ? '' : 'display:none;'}"><i class="fas fa-star"></i> ${stat.rating > 0 ? stat.rating.toFixed(1) : ''}</span>
                ${typePill}
            </a>
            <div class="game-info d-flex flex-column flex-grow-1">
                <a href="${gameUrl}" class="text-decoration-none">
                    <h4 class="game-title" title="${escapeHtml(oyun.oyun_adi)}">${escapeHtml(oyun.oyun_adi)}</h4>
                </a>
                <div class="game-stats mb-2">
                    <span class="game-category"><i class="${escapeHtml(oyun.ikon || 'fas fa-gamepad')} me-1"></i>${escapeHtml(oyun.kategori_adi)}</span>
                    <span><i class="fas fa-play me-1"></i><span data-game-plays="${oyun.id}">${formatNumber(stat.plays)}</span></span>
                </div>
                <div class="d-flex gap-1 mt-auto">
                    <a href="${gameUrl}" class="btn btn-play flex-grow-1 text-center">
                        <i class="fas fa-play me-1"></i>Oyna
                    </a>
                    <button type="button" onclick="kutuphaneyeEkle(${oyun.id})" class="btn btn-add-library-icon" title="Kütüphaneye Ekle">
                        <i class="fas fa-bookmark"></i>
                    </button>
                </div>
            </div>
        </div>
    </article>`;
}

// --- KÜTÜPHANE ---
function getKutuphaneKey() {
    const user = getActiveUser();
    return 'gekkotari_kutuphane_' + (user ? user.kullanici_adi : 'misafir');
}

function getKutuphane() {
    try {
        return JSON.parse(localStorage.getItem(getKutuphaneKey())) || [];
    } catch (e) {
        return [];
    }
}

function kutuphaneyeEkle(oyunId) {
    const list = getKutuphane();
    const idStr = String(oyunId);
    if (list.some(item => String(item.oyun_id) === idStr)) {
        showToast('warning', 'Bu oyun zaten kütüphanende mevcut!');
        return;
    }
    list.unshift({
        oyun_id: idStr,
        ekleme_tarihi: new Date().toISOString()
    });
    localStorage.setItem(getKutuphaneKey(), JSON.stringify(list));
    showToast('success', 'Oyun kütüphanene eklendi!');
}

function kutuphanedenKaldir(oyunId) {
    let list = getKutuphane();
    const idStr = String(oyunId);
    list = list.filter(item => String(item.oyun_id) !== idStr);
    localStorage.setItem(getKutuphaneKey(), JSON.stringify(list));
    showToast('info', 'Oyun kütüphaneden kaldırıldı.');
}

function rastgeleOyunAc() {
    const games = getGames();
    if (!games.length) return;
    const randomGame = games[Math.floor(Math.random() * games.length)];
    window.location.href = 'oyun.html?id=' + randomGame.id;
}

// --- HEADER & FOOTER ---
function renderHeader(activePage = 'index.html') {
    const user = getActiveUser();
    const categories = getCategories();

    let userHtml = '';
    if (user) {
        const isAdmin = ['super_admin', 'editor', 'moderator', 'admin'].includes(user.rol_adi) || user.email === 'admin@gekkotari.com';
        userHtml = `
            <div class="dropdown user-dropdown d-inline-block">
                <button class="btn btn-user-menu dropdown-toggle" type="button" id="userMenu" data-bs-toggle="dropdown" aria-expanded="false">
                    <div class="user-avatar"><i class="fas fa-user"></i></div>
                    <span class="d-none d-md-inline">${escapeHtml(user.kullanici_adi)}</span>
                </button>
                <ul class="dropdown-menu dropdown-menu-end dropdown-menu-dark shadow-lg" aria-labelledby="userMenu">
                    <li class="dropdown-header">
                        <div class="d-flex align-items-center gap-2">
                            <div class="user-avatar-sm"><i class="fas fa-user"></i></div>
                            <div>
                                <strong>${escapeHtml(user.ad_soyad || user.kullanici_adi)}</strong>
                                <br><small class="text-muted">${escapeHtml(user.email)}</small>
                            </div>
                        </div>
                    </li>
                    <li><hr class="dropdown-divider border-secondary"></li>
                    ${isAdmin ? `
                    <li>
                        <a class="dropdown-item text-warning fw-bold" href="admin.html">
                            <i class="fas fa-lock me-2"></i> Yönetim Paneli
                        </a>
                    </li>
                    <li><hr class="dropdown-divider border-secondary"></li>
                    ` : ''}
                    <li>
                        <a class="dropdown-item" href="kutuphane.html">
                            <i class="fas fa-bookmark me-2 text-success"></i> Kütüphanem
                        </a>
                    </li>
                    <li><hr class="dropdown-divider border-secondary"></li>
                    <li>
                        <a class="dropdown-item text-danger" href="#" onclick="logoutUser(); return false;">
                            <i class="fas fa-sign-out-alt me-2"></i> Çıkış Yap
                        </a>
                    </li>
                </ul>
            </div>
        `;
    } else {
        userHtml = `
            <a href="giris.html" class="btn btn-outline-light btn-sm me-2 btn-auth">
                <i class="fas fa-sign-in-alt"></i> <span class="d-none d-sm-inline">Giriş</span>
            </a>
            <a href="kayit.html" class="btn btn-primary-custom btn-sm btn-auth">
                <i class="fas fa-user-plus"></i> <span class="d-none d-sm-inline">Kayıt Ol</span>
            </a>
        `;
    }

    const catDropdownItems = categories.map(k =>
        `<li><a class="dropdown-item" href="kategori.html?tur=${encodeURIComponent(k.kategori_adi)}"><i class="${escapeHtml(k.ikon)} me-2"></i>${escapeHtml(k.kategori_adi)}</a></li>`
    ).join('');

    const headerEl = document.getElementById('siteHeaderMount');
    if (!headerEl) return;

    headerEl.innerHTML = `
    <header class="site-header">
        <div class="container-xl">
            <div class="row align-items-center g-2">
                <div class="col-lg-3 col-md-4 col-6">
                    <a class="brand-logo" href="index.html">
                        <i class="fas fa-gamepad"></i>
                        <span>Gekkotari</span>
                    </a>
                </div>
                <div class="col-lg-5 col-md-4 d-none d-md-block">
                    <form class="search-form" action="kategori.html" method="GET">
                        <div class="search-wrapper">
                            <input type="text" name="arama" class="search-input" placeholder="${getGames().length} doğrulanmış oyunda ara (Papa's Pizzeria, Stick War, Feodalizm, Earn to Die...)" autocomplete="off">
                            <button type="submit" class="search-btn" aria-label="Ara"><i class="fas fa-search"></i></button>
                        </div>
                    </form>
                </div>
                <div class="col-lg-4 col-md-4 col-6 text-end" id="userArea">
                    ${userHtml}
                </div>
            </div>
        </div>
    </header>

    <nav class="navbar navbar-expand-lg site-nav sticky-top">
        <div class="container-xl">
            <button class="navbar-toggler border-secondary" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNav">
                <span class="navbar-toggler-icon" style="filter:invert(1);"></span>
            </button>
            <div class="collapse navbar-collapse" id="navbarNav">
                <ul class="navbar-nav me-auto">
                    <li class="nav-item">
                        <a class="nav-link ${activePage === 'index.html' ? 'active' : ''}" href="index.html">
                            <i class="fas fa-home me-1"></i> Ana Sayfa
                        </a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link ${activePage === 'kategori.html' ? 'active' : ''}" href="kategori.html">
                            <i class="fas fa-th-large me-1"></i> Tüm Oyunlar
                        </a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link" href="kategori.html?mod=${encodeURIComponent('2 Kişilik')}">
                            <i class="fas fa-user-friends me-1"></i> 2 Kişilik
                        </a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link ${activePage === 'kutuphane.html' ? 'active' : ''}" href="kutuphane.html">
                            <i class="fas fa-bookmark me-1"></i> Kütüphanem
                        </a>
                    </li>
                    <li class="nav-item dropdown">
                        <a class="nav-link dropdown-toggle" href="#" role="button" data-bs-toggle="dropdown">
                            <i class="fas fa-list me-1"></i> Kategoriler
                        </a>
                        <ul class="dropdown-menu dropdown-menu-dark">
                            ${catDropdownItems}
                        </ul>
                    </li>
                </ul>
                <ul class="navbar-nav ms-auto d-flex align-items-lg-center">
                    <li class="nav-item">
                        <a class="nav-link nav-feedback-pill" href="#" onclick="openFeedbackModal('Oyun İste', ''); return false;">
                            <i class="fas fa-comment-medical me-1"></i> Oyun İste / Öneri
                        </a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link" href="#" onclick="rastgeleOyunAc(); return false;" title="Rastgele Oyun Aç">
                            <i class="fas fa-dice me-1" style="color:var(--primary);"></i> Rastgele
                        </a>
                    </li>
                </ul>
            </div>
        </div>
    </nav>
    `;
}

function renderFooter() {
    const footerEl = document.getElementById('siteFooterMount');
    if (!footerEl) return;

    footerEl.innerHTML = `
    <footer class="site-footer">
        <div class="container-xl">
            <div class="row g-4">
                <div class="col-lg-4 col-md-6">
                    <div class="footer-brand">
                        <a href="index.html" class="brand-logo">
                            <i class="fas fa-gamepad"></i>
                            <span>Gekkotari</span>
                        </a>
                        <p class="mt-3 text-muted small">Kurulum gerektirmeyen, tek tek oynanış testinden geçmiş efsane Flash klasikleri ve modern HTML5 oyunları tek adreste.</p>
                    </div>
                </div>
                <div class="col-lg-2 col-md-6">
                    <h6 class="footer-title">Keşfet</h6>
                    <ul class="footer-links">
                        <li><a href="index.html">Ana Sayfa</a></li>
                        <li><a href="kategori.html">Tüm Oyunlar</a></li>
                        <li><a href="kategori.html?mod=${encodeURIComponent('2 Kişilik')}">2 Kişilik Oyunlar</a></li>
                        <li><a href="kutuphane.html">Kütüphanem</a></li>
                    </ul>
                </div>
                <div class="col-lg-3 col-md-6">
                    <h6 class="footer-title">Kurumsal & Yasal</h6>
                    <ul class="footer-links">
                        <li><a href="sayfa.html?slug=hakkimizda">Hakkımızda</a></li>
                        <li><a href="sayfa.html?slug=gizlilik">Gizlilik & Çerez Politikası</a></li>
                        <li><a href="sayfa.html?slug=kullanim-sartlari">Kullanım Şartları</a></li>
                        <li><a href="sayfa.html?slug=telif-dmca">Telif Hakları / DMCA</a></li>
                    </ul>
                </div>
                <div class="col-lg-3 col-md-6">
                    <h6 class="footer-title">Destek & İstek</h6>
                    <ul class="footer-contact">
                        <li><i class="fas fa-envelope"></i> info@gekkotari.com</li>
                        <li><i class="fas fa-map-marker-alt"></i> Türkiye • Web Oyun Portalı</li>
                    </ul>
                    <button onclick="openFeedbackModal('Oyun İste', '')" class="btn btn-sm btn-outline-success mt-1">
                        <i class="fas fa-paper-plane me-1"></i> Oyun İste / Sorun Bildir
                    </button>
                </div>
            </div>
            <hr class="border-secondary my-4" style="opacity:0.25;">
            <div class="d-flex justify-content-between align-items-center flex-wrap gap-2">
                <p class="text-muted small mb-0">© 2026 Gekkotari Oyun Portalı. Tüm oyun markaları ilgili yapımcılarına aittir.</p>
                <a href="admin.html" class="text-muted small"><i class="fas fa-shield-alt me-1"></i>Yönetim</a>
            </div>
        </div>
    </footer>
    `;
}
