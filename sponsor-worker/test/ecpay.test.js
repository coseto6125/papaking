import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkMac, decryptData, encryptData, rfc3986 } from '../src/ecpay.js';

// Official sample from https://developers.ecpay.com.tw/41068/
const KEY = '7b53896b742849d3';
const IV = '37a0ad3c6ffa428b';
const SAMPLE = '{"MerchantID":"3085676","MerchantTradeNo":"CX202202221540568521"}';

test('checkMac_official_sample_matches_documented_value', async () => {
  assert.equal(await checkMac(KEY, SAMPLE, IV), 'CE67BBD259EE38BA1C7FB7CC88C3BD91D3F082B46EAEBD4E4E5F2184CB23349A');
});

test('rfc3986_encodes_chars_encodeURIComponent_leaves_bare', () => {
  assert.equal(rfc3986("a!'()*~-_. b"), 'a%21%27%28%29%2A~-_.%20b');
});

test('encryptData_decryptData_roundtrip_preserves_unicode_json', async () => {
  const plain = '{"PatronName":"小明","PatronNote":"加油！(test)"}';
  assert.equal(await decryptData(KEY, IV, await encryptData(KEY, IV, plain)), plain);
});

test('decryptData_wrong_key_throws', async () => {
  const cipher = await encryptData(KEY, IV, '{"a":1}');
  await assert.rejects(decryptData('0000000000000000', IV, cipher));
});
