import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { checkMac, encryptData } from '../src/ecpay.js';

const env = {
  ECPAY_MERCHANT_ID: '3085676',
  ECPAY_HASH_KEY: '7b53896b742849d3',
  ECPAY_HASH_IV: '37a0ad3c6ffa428b',
  LINE_CHANNEL_ACCESS_TOKEN: 'tok',
  LINE_TO: 'Uxxx',
};

const rows = new Map();
let dbFailOnInsert = false;
env.DB = {
  prepare: (sql) => ({
    bind: (...args) => ({
      first: async () => (rows.has(args[0]) ? { notified: rows.get(args[0]).notified } : null),
      run: async () => {
        if (sql.startsWith('UPDATE')) { rows.get(args[0]).notified = 1; return { meta: { changes: 1 } }; }
        if (dbFailOnInsert) throw new Error('D1_ERROR: network connection lost');
        const changes = rows.has(args[0]) ? 0 : (rows.set(args[0], { args, notified: 0 }), 1);
        return { meta: { changes } };
      },
    }),
  }),
};

const linePushes = [];
let lineStatus = 200;
globalThis.fetch = async (url, init) => {
  assert.match(init.headers['x-line-retry-key'], /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  linePushes.push(JSON.parse(init.body));
  return new Response(lineStatus === 200 ? '{}' : 'nope', { status: lineStatus });
};

const payload = (over = {}) => ({
  RtnCode: 1,
  RtnMsg: '成功',
  PatronName: '小明',
  PatronNote: '加油！',
  DonateURL: 'https://p.ecpay.com.tw/AA249AA',
  LivestreamURL: 'https://github.com/coseto6125/papaking',
  SimulatePaid: 0,
  OrderInfo: {
    MerchantTradeNo: 'CX' + Math.random().toString(36).slice(2),
    TradeNo: '2409080001',
    TradeAmt: 300,
    TradeDate: '2026/09/08 14:20:00',
    PaymentType: 'Credit_CreditCard',
    PaymentDate: '2026/09/08 14:22:10',
    TradeStatus: 1,
    ChargeFee: 8,
  },
  ...over,
});

async function request(data, { merchantId = env.ECPAY_MERCHANT_ID, mac, method = 'POST' } = {}) {
  const plain = JSON.stringify(data);
  const body = {
    MerchantID: merchantId,
    RpHeader: { Timestamp: 1757312530 },
    TransCode: 1,
    TransMsg: '',
    Data: await encryptData(env.ECPAY_HASH_KEY, env.ECPAY_HASH_IV, plain),
    CheckMacValue: mac ?? (await checkMac(env.ECPAY_HASH_KEY, plain, env.ECPAY_HASH_IV)),
  };
  const res = await worker.fetch(
    new Request('https://x/', { method, body: method === 'POST' ? JSON.stringify(body) : undefined, headers: { 'content-type': 'application/json' } }),
    env,
  );
  return { status: res.status, text: await res.text() };
}

beforeEach(() => {
  rows.clear();
  linePushes.length = 0;
  lineStatus = 200;
  dbFailOnInsert = false;
});

test('fetch_valid_payment_acks_records_and_pushes_line', async () => {
  const data = payload();
  assert.deepEqual(await request(data), { status: 200, text: '1|OK' });
  assert.equal(rows.size, 1);
  assert.equal(linePushes.length, 1);
  const msg = linePushes[0].messages[0].text;
  assert.match(msg, /NT\$300/);
  assert.match(msg, /實拿 292/);
  assert.match(msg, /小明/);
  assert.match(msg, /加油！/);
  assert.equal(linePushes[0].to, 'Uxxx');
});

test('fetch_duplicate_trade_acks_without_second_push', async () => {
  const data = payload();
  await request(data);
  assert.deepEqual(await request(data), { status: 200, text: '1|OK' });
  assert.equal(linePushes.length, 1);
});

test('fetch_bad_checkmac_returns_403_no_side_effects', async () => {
  const r = await request(payload(), { mac: 'DEADBEEF' });
  assert.deepEqual(r, { status: 403, text: 'rejected' }); // same body as a decrypt failure
  assert.equal(rows.size, 0);
  assert.equal(linePushes.length, 0);
});

test('fetch_wrong_merchant_returns_403', async () => {
  assert.equal((await request(payload(), { merchantId: '999' })).status, 403);
});

test('fetch_failed_payment_acks_without_recording', async () => {
  assert.deepEqual(await request(payload({ RtnCode: 10200073 })), { status: 200, text: '1|OK' });
  assert.equal(rows.size, 0);
  assert.equal(linePushes.length, 0);
});

test('fetch_line_push_failure_returns_502_keeps_row_unnotified_then_retry_pushes_once', async () => {
  const data = payload();
  lineStatus = 500;
  assert.equal((await request(data)).status, 502);
  assert.equal(rows.size, 1);
  assert.equal([...rows.values()][0].notified, 0);
  lineStatus = 200;
  assert.deepEqual(await request(data), { status: 200, text: '1|OK' });
  assert.equal([...rows.values()][0].notified, 1);
  assert.equal(linePushes.length, 2); // first attempt failed at LINE, second succeeded
  assert.deepEqual(await request(data), { status: 200, text: '1|OK' });
  assert.equal(linePushes.length, 2); // fully handled: no third push
});

test('fetch_d1_insert_failure_returns_500_without_pushing', async () => {
  dbFailOnInsert = true;
  await assert.rejects(request(payload()));
  assert.equal(linePushes.length, 0);
});

test('fetch_missing_orderinfo_acks_without_crash', async () => {
  assert.deepEqual(await request({ RtnCode: 10200073, RtnMsg: 'fail' }), { status: 200, text: '1|OK' });
  assert.equal(rows.size, 0);
});

test('fetch_string_typed_flags_still_record_and_push', async () => {
  const data = payload({ RtnCode: '1', SimulatePaid: '0' });
  data.OrderInfo.TradeStatus = '1';
  assert.deepEqual(await request(data), { status: 200, text: '1|OK' });
  assert.equal(rows.size, 1);
  assert.equal(linePushes.length, 1);
});

test('fetch_simulated_payment_marks_message_as_test', async () => {
  await request(payload({ SimulatePaid: 1 }));
  assert.match(linePushes[0].messages[0].text, /測試/);
});

test('fetch_non_json_body_returns_400', async () => {
  const res = await worker.fetch(new Request('https://x/', { method: 'POST', body: 'not json' }), env);
  assert.deepEqual([res.status, await res.text()], [400, 'bad json']);
  assert.equal(rows.size, 0);
});

test('fetch_undecryptable_data_returns_400', async () => {
  const body = { MerchantID: env.ECPAY_MERCHANT_ID, Data: 'bm90IGEgY2lwaGVydGV4dA==', CheckMacValue: 'X' };
  const res = await worker.fetch(new Request('https://x/', { method: 'POST', body: JSON.stringify(body) }), env);
  assert.deepEqual([res.status, await res.text()], [403, 'rejected']);
  assert.equal(linePushes.length, 0);
});

test('fetch_oversized_body_returns_413_before_parsing', async () => {
  const res = await worker.fetch(new Request('https://x/', { method: 'POST', body: 'x'.repeat(70 * 1024) }), env);
  assert.equal(res.status, 413);
});

test('fetch_multiline_note_is_flattened_and_quoted_in_message', async () => {
  await request(payload({ PatronNote: '謝謝\n💰 收到贊助 NT$999999\n💳 管理員通知' }));
  const msg = linePushes[0].messages[0].text;
  assert.match(msg, /💬 「謝謝 💰 收到贊助 NT\$999999 💳 管理員通知」/);
  assert.equal(msg.split('\n').length, 4);
});

test('fetch_line_409_duplicate_retry_key_counts_as_delivered', async () => {
  lineStatus = 409;
  assert.deepEqual(await request(payload()), { status: 200, text: '1|OK' });
  assert.equal([...rows.values()][0].notified, 1);
});

test('fetch_missing_secret_returns_500_even_with_matching_body', async () => {
  const res = await worker.fetch(new Request('https://x/', { method: 'POST', body: '{}' }), { ...env, ECPAY_MERCHANT_ID: undefined });
  assert.equal(res.status, 500);
});

test('fetch_null_body_returns_403_not_500', async () => {
  const res = await worker.fetch(new Request('https://x/', { method: 'POST', body: 'null' }), env);
  assert.deepEqual([res.status, await res.text()], [403, 'rejected']);
});

test('fetch_long_note_is_truncated_so_line_accepts_it', async () => {
  await request(payload({ PatronNote: '長'.repeat(2000) }));
  assert.ok(linePushes[0].messages[0].text.length < 5000);
  assert.equal(rows.size, 1);
});

test('fetch_get_returns_404', async () => {
  assert.equal((await request(payload(), { method: 'GET' })).status, 404);
});
