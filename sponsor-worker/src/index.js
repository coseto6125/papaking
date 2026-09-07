// Cloudflare Worker: receives ECPay 直播主收款 payment notifications, records them in D1, pushes a LINE message.
import { checkMac, decryptData } from './ecpay.js';

const text = (body, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });

const ACK = '1|OK'; // exact body ECPay expects; anything else triggers retries (5-15 min apart, 4/day)
const MAX_BODY = 64 * 1024; // a real callback is a few hundred bytes
const SECRETS = ['ECPAY_MERCHANT_ID', 'ECPAY_HASH_KEY', 'ECPAY_HASH_IV', 'LINE_CHANNEL_ACCESS_TOKEN', 'LINE_TO'];

// Read the stream up to `limit` bytes; null when it is longer. Content-Length alone is not trusted.
async function readBounded(stream, limit) {
  if (!stream) return '';
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.byteLength;
    if (size > limit) return null;
    chunks.push(chunk);
  }
  return new TextDecoder().decode(await new Blob(chunks).arrayBuffer());
}

// One line, control characters stripped, so a note cannot masquerade as another line of the notification
const oneLine = (v) => String(v ?? '').replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]+/g, ' ').trim().slice(0, 300); // ECPay caps both at 100; LINE text at 5000

// Deterministic UUID per order so LINE dedups our retries too (X-Line-Retry-Key, valid 24h)
async function retryKey(tradeNo) {
  const h = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(tradeNo)))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const sponsorMessage = ({ PatronName, PatronNote, SimulatePaid, OrderInfo: o }) =>
  [
    `${Number(SimulatePaid) === 1 ? '🧪 測試 ' : '💰 '}收到贊助 NT$${o.TradeAmt}（手續費 ${o.ChargeFee ?? '?'}，實拿 ${o.TradeAmt - (o.ChargeFee ?? 0)}）`,
    `👤 ${oneLine(PatronName) || '匿名'}`,
    oneLine(PatronNote) ? `💬 「${oneLine(PatronNote)}」` : null,
    `💳 ${o.PaymentType} · ${o.PaymentDate}`,
  ]
    .filter(Boolean)
    .join('\n');

async function pushLine(env, message, tradeNo) {
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
      'x-line-retry-key': await retryKey(tradeNo),
    },
    body: JSON.stringify({ to: env.LINE_TO, messages: [{ type: 'text', text: message }] }),
  });
  if (!res.ok && res.status !== 409) throw new Error(`LINE push ${res.status}: ${await res.text()}`); // 409 = LINE already accepted this retry key
}

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return text('papaking sponsor webhook', 404);
    if (SECRETS.some((k) => !env[k])) return text('misconfigured', 500); // never fail open on a missing secret

    const raw = await readBounded(request.body, MAX_BODY);
    if (raw === null) return text('too large', 413);
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return text('bad json', 400);
    }
    if (!body || body.MerchantID !== env.ECPAY_MERCHANT_ID) return text('rejected', 403);

    // decrypt failure and MAC failure share one response so an outsider cannot tell them apart (padding-oracle hygiene)
    let plain;
    try {
      plain = await decryptData(env.ECPAY_HASH_KEY, env.ECPAY_HASH_IV, String(body.Data));
    } catch {
      return text('rejected', 403);
    }
    if ((await checkMac(env.ECPAY_HASH_KEY, plain, env.ECPAY_HASH_IV)) !== body.CheckMacValue) return text('rejected', 403);

    const data = JSON.parse(plain);
    const o = data.OrderInfo ?? {};
    // spec says ints; Number() also covers a "1" string so a paid order is never silently dropped
    if (Number(data.RtnCode) !== 1 || Number(o.TradeStatus) !== 1) return text(ACK); // failed / unpaid: ack, nothing to record

    // insert first so dedup is atomic; notified=0 rows come from a delivery whose LINE push failed
    const ins = await env.DB.prepare(
      `INSERT INTO sponsors
         (merchant_trade_no, trade_no, amount, fee, patron_name, patron_note, payment_type, payment_date, simulated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(merchant_trade_no) DO NOTHING`,
    )
      .bind(o.MerchantTradeNo, o.TradeNo, o.TradeAmt, o.ChargeFee ?? null, oneLine(data.PatronName) || null,
            oneLine(data.PatronNote) || null, o.PaymentType ?? null, o.PaymentDate ?? null, Number(data.SimulatePaid) === 1 ? 1 : 0)
      .run();
    if (ins.meta.changes === 0) {
      const row = await env.DB.prepare('SELECT notified FROM sponsors WHERE merchant_trade_no = ?').bind(o.MerchantTradeNo).first();
      if (row?.notified) return text(ACK); // ECPay retry of an order already handled
    }

    try {
      await pushLine(env, sponsorMessage(data), o.MerchantTradeNo);
    } catch (err) {
      console.error(err.message);
      return text('notify failed', 502); // no ack -> ECPay retries; the row stays with notified=0
    }
    await env.DB.prepare('UPDATE sponsors SET notified = 1 WHERE merchant_trade_no = ?').bind(o.MerchantTradeNo).run();
    return text(ACK);
  },
};
