// Cloudflare Worker: receives ECPay 直播主收款 payment notifications, records them in D1, pushes a LINE message.
import { checkMac, decryptData } from './ecpay.js';

const text = (body, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });

const ACK = '1|OK'; // exact body ECPay expects; anything else triggers retries (5-15 min apart, 4/day)

const sponsorMessage = ({ PatronName, PatronNote, SimulatePaid, OrderInfo: o }) =>
  [
    `${SimulatePaid === 1 ? '🧪 測試 ' : '💰 '}收到贊助 NT$${o.TradeAmt}（手續費 ${o.ChargeFee ?? '?'}，實拿 ${o.TradeAmt - (o.ChargeFee ?? 0)}）`,
    `👤 ${PatronName || '匿名'}`,
    PatronNote ? `💬 ${PatronNote}` : null,
    `💳 ${o.PaymentType} · ${o.PaymentDate}`,
  ]
    .filter(Boolean)
    .join('\n');

async function pushLine(env, message) {
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
    body: JSON.stringify({ to: env.LINE_TO, messages: [{ type: 'text', text: message }] }),
  });
  if (!res.ok) throw new Error(`LINE push ${res.status}: ${await res.text()}`);
}

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return text('papaking sponsor webhook', 404);

    let body;
    try {
      body = await request.json();
    } catch {
      return text('bad json', 400);
    }
    if (body.MerchantID !== env.ECPAY_MERCHANT_ID) return text('merchant mismatch', 403);

    let plain;
    try {
      plain = await decryptData(env.ECPAY_HASH_KEY, env.ECPAY_HASH_IV, body.Data);
    } catch {
      return text('bad data', 400);
    }
    if ((await checkMac(env.ECPAY_HASH_KEY, plain, env.ECPAY_HASH_IV)) !== body.CheckMacValue) return text('bad mac', 403);

    const data = JSON.parse(plain);
    const o = data.OrderInfo;
    if (data.RtnCode !== 1 || o.TradeStatus !== 1) return text(ACK); // failed / unpaid: ack, nothing to record

    const seen = await env.DB.prepare('SELECT 1 FROM sponsors WHERE merchant_trade_no = ?').bind(o.MerchantTradeNo).first();
    if (seen) return text(ACK); // ECPay retry of an order already handled

    try {
      await pushLine(env, sponsorMessage(data));
    } catch (err) {
      console.error(err.message);
      return text('notify failed', 502); // no ack -> ECPay retries, so the notification is not lost
    }

    await env.DB.prepare(
      `INSERT OR IGNORE INTO sponsors
         (merchant_trade_no, trade_no, amount, fee, patron_name, patron_note, payment_type, payment_date, simulated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(o.MerchantTradeNo, o.TradeNo, o.TradeAmt, o.ChargeFee ?? null, data.PatronName ?? null,
            data.PatronNote ?? null, o.PaymentType ?? null, o.PaymentDate ?? null, data.SimulatePaid === 1 ? 1 : 0)
      .run();
    return text(ACK);
  },
};
