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

// Official vectors from https://developers.ecpay.com.tw/41032/ (two ciphertexts, one plaintext)
test('decryptData_official_vectors_decode_to_documented_json', async () => {
  for (const ct of [
    'o4TJSHkQBM1bogbn5BNFRofCVTfsQjoqv/TX8DKn757fe5AoYzoalYmrMsGXTiwxGpI8NsE2vu4tScAwISx8kw==',
    '5/2ZKxAmcnaUHMUv67dYpSSg5J9m0r4Lrxgznl4DHffjASG04O0ENFHm/qhTvQ8gHrzIWuJr5iGQlrHBF1OFGw==',
  ]) assert.equal(await decryptData('pwFHCqoQZGmho4w6', 'EkRm7iFT261dpevs', ct), '{"Name":"Test","ID":"A123456789"}');
});

test('decryptData_plus_encoded_space_decodes_to_space', async () => {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(KEY), 'AES-CBC', false, ['encrypt']);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-CBC', iv: new TextEncoder().encode(IV) }, key,
    new TextEncoder().encode('%7B%22PaymentDate%22%3A%222026%2F09%2F08+14%3A22%3A10%22%7D'));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(cipher)));
  assert.equal(await decryptData(KEY, IV, b64), '{"PaymentDate":"2026/09/08 14:22:10"}');
});
