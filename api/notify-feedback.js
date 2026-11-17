const ALLOWED_ORIGINS = new Set([
  'https://gekkotari.com',
  'https://www.gekkotari.com',
  'https://gekotari.vercel.app',
  'http://localhost:8765',
  'http://127.0.0.1:8765',
]);

// Lightweight per-instance cooldown map (defense-in-depth alongside Supabase rate limits)
const ipHits = new Map();

function isAllowedOrigin(request) {
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  if (origin) {
    return ALLOWED_ORIGINS.has(origin) || /^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}$/i.test(origin);
  }
  if (referer) {
    try {
      const refOrigin = new URL(referer).origin;
      return ALLOWED_ORIGINS.has(refOrigin);
    } catch {
      return false;
    }
  }
  return false;
}

function checkMemoryRateLimit(ip) {
  const now = Date.now();
  const windowMs = 5 * 60 * 1000;
  const maxHits = 3;
  const arr = (ipHits.get(ip) || []).filter((ts) => now - ts < windowMs);
  if (arr.length >= maxHits) return false;
  arr.push(now);
  ipHits.set(ip, arr);
  if (ipHits.size > 500) {
    for (const [k, v] of ipHits.entries()) {
      if (!v.some((ts) => now - ts < windowMs)) ipHits.delete(k);
    }
  }
  return true;
}

function formatMessageText(data) {
  const kind = String(data.kind || data.tur || 'Bildirim').trim().slice(0, 40);
  const subject = String(data.subject || data.konu || '-').trim().slice(0, 100);
  const msg = String(data.message || data.mesaj || '-').trim().slice(0, 400);
  const contact = String(data.contact || data.iletisim || 'Misafir').trim().slice(0, 60);
  return `[Gekkotari ${kind}]\nKonu: ${subject}\nKim: ${contact}\nMesaj: ${msg}`;
}

async function sendTwilioSms(text) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  const to = process.env.NOTIFY_SMS_TO;
  if (!sid || !token || !from || !to) return null;

  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const body = new URLSearchParams({ To: to, From: from, Body: text });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Twilio ${res.status}: ${errText.slice(0, 120)}`);
  }
  return 'twilio';
}

async function sendNetgsmSms(text) {
  const usercode = process.env.NETGSM_USERCODE;
  const password = process.env.NETGSM_PASSWORD;
  const msgheader = process.env.NETGSM_MSGHEADER;
  const gsm = process.env.NOTIFY_SMS_TO;
  if (!usercode || !password || !msgheader || !gsm) return null;

  const cleanPhone = gsm.replace(/^\+?90/, '').replace(/\D/g, '');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<mainbody>
  <header>
    <company dil="TR">Netgsm</company>
    <usercode>${usercode}</usercode>
    <password>${password}</password>
    <type>1:n</type>
    <msgheader>${msgheader}</msgheader>
  </header>
  <body>
    <msg><![CDATA[${text}]]></msg>
    <no>${cleanPhone}</no>
  </body>
</mainbody>`;

  const res = await fetch('https://api.netgsm.com.tr/sms/send/xml', {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
    body: xml,
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Netgsm ${res.status}`);
  return 'netgsm';
}

async function sendTelegramPush(text) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return null;

  const res = await fetch(`https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Telegram ${res.status}`);
  return 'telegram';
}

async function sendNtfyPush(text) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return null;

  const res = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
    method: 'POST',
    headers: {
      Title: 'Gekkotari Yeni Bildirim',
      Priority: 'high',
    },
    body: text,
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`ntfy ${res.status}`);
  return 'ntfy';
}

export async function POST(request) {
  const webhookSecret = process.env.FEEDBACK_WEBHOOK_SECRET;
  const providedSecret = request.headers.get('x-webhook-secret');
  const isWebhook = Boolean(webhookSecret && providedSecret === webhookSecret);

  if (!isWebhook && !isAllowedOrigin(request)) {
    return Response.json({ ok: false, error: 'Forbidden origin' }, { status: 403 });
  }

  const clientIp = (request.headers.get('x-forwarded-for') || 'local').split(',')[0].trim();
  if (!isWebhook && !checkMemoryRateLimit(clientIp)) {
    return Response.json({ ok: false, error: 'Rate limit exceeded' }, { status: 429 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  // Support both Supabase DB webhook payload (`{ record: {...} }`) and direct frontend entry
  const data = (body && body.record && typeof body.record === 'object') ? body.record : body;
  if (!data || (!data.subject && !data.konu && !data.message && !data.mesaj)) {
    return Response.json({ ok: false, error: 'Missing feedback content' }, { status: 400 });
  }

  const text = formatMessageText(data);
  const channels = [sendTwilioSms, sendNetgsmSms, sendTelegramPush, sendNtfyPush];
  const delivered = [];
  const errors = [];

  for (const sender of channels) {
    try {
      const ch = await sender(text);
      if (ch) delivered.push(ch);
    } catch (err) {
      errors.push(err.message);
    }
  }

  if (!delivered.length && !errors.length) {
    return Response.json({
      ok: true,
      configured: false,
      message: 'SMS/Push provider env vars are not configured yet.',
    }, { status: 202 });
  }

  return Response.json({
    ok: delivered.length > 0,
    configured: true,
    delivered,
    errors: errors.length ? errors : undefined,
  }, { status: delivered.length > 0 ? 200 : 502 });
}
