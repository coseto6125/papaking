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
env.DB = {
  prepare: (sql) => ({
    bind: (...args) => ({
      first: async () => (rows.has(args[0]) ? 1 : null),
      run: async () => {
        const changes = rows.has(args[0]) ? 0 : (rows.set(args[0], args), 1);
        return { meta: { changes } };
      },
    }),
  }),
};

const linePushes = [];
let lineStatus = 200;
globalThis.fetch = async (url, init) => {
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
  assert.equal(r.status, 403);
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

test('fetch_line_push_failure_returns_502_and_leaves_no_record', async () => {
  lineStatus = 500;
  assert.equal((await request(payload())).status, 502);
  assert.equal(rows.size, 0);
});

test('fetch_simulated_payment_marks_message_as_test', async () => {
  await request(payload({ SimulatePaid: 1 }));
  assert.match(linePushes[0].messages[0].text, /測試/);
});

test('fetch_get_returns_404', async () => {
  assert.equal((await request(payload(), { method: 'GET' })).status, 404);
});
