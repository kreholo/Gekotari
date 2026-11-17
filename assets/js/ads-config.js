/**
 * GEKKOTARI - MERKEZİ REKLAM VE GERİ BİLDİRİM YAPILANDIRMASI
 * ---------------------------------------------------------
 * Reklam ağı onaylandığında (Google AdSense, Monetag, Adsterra veya özel sponsor)
 * ilgili slotun `html` alanına reklam kodunu yapıştırman yeterlidir.
 * `showPlaceholderWhenEmpty: false` yaparsan kodu eklemeden önce boş kutu görünmez.
 */
window.GEKKOTARI_ADS = {
    enabled: true,
    showPlaceholderWhenEmpty: false,
    vercelAnalytics: true,
    contactNote: 'Reklam & Sponsorluk: info@gekkotari.com',
    slots: {
        home_leaderboard: {
            label: 'Reklam Alanı • 728×90',
            sizeClass: 'ad-slot-leaderboard',
            html: ''
        },
        category_leaderboard: {
            label: 'Reklam Alanı • 728×90',
            sizeClass: 'ad-slot-leaderboard',
            html: ''
        },
        player_bottom: {
            label: 'Sponsorlu Alan • 728×90',
            sizeClass: 'ad-slot-leaderboard',
            html: ''
        },
        player_sidebar: {
            label: 'Sponsorlu Alan • 300×250',
            sizeClass: 'ad-slot-rect',
            html: ''
        }
    }
};

/**
 * İstek / Sorun Bildirimi için opsiyonel dış uç nokta:
 * - Discord Webhook URL eklersen mesaj anında Discord sunucuna düşer.
 * - Web3Forms kullanmak istersen web3formsAccessKey doldurabilirsin.
 * Boş bırakıldığında bildirimler tarayıcı içi Gelen Kutusu'na (ve Admin paneline) kaydedilir.
 */
window.GEKKOTARI_FEEDBACK_CONFIG = {
    discordWebhookUrl: '',
    web3formsAccessKey: '',
    contactEmail: 'info@gekkotari.com'
};
