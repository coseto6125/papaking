// ECPay 直播主收款 ReturnURL helpers: CheckMacValue and AES-128-CBC Data payload.
// Spec: https://developers.ecpay.com.tw/41030/ (ReturnURL), /41032/ (AES), /41068/ (CheckMacValue)
const te = new TextEncoder();
const td = new TextDecoder();

// ECPay hashes the RFC 3986 form (PHP rawurlencode / .NET Uri.EscapeDataString);
// encodeURIComponent leaves !'()* bare, so encode them by hand.
export const rfc3986 = (s) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export async function checkMac(hashKey, plainData, hashIV) {
  const digest = await crypto.subtle.digest('SHA-256', te.encode(rfc3986(hashKey + plainData + hashIV).toLowerCase()));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

const aesKey = (hashKey, usage) => crypto.subtle.importKey('raw', te.encode(hashKey), 'AES-CBC', false, [usage]);

export async function decryptData(hashKey, hashIV, base64) {
  const key = await aesKey(hashKey, 'decrypt');
  const cipher = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const plain = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: te.encode(hashIV) }, key, cipher);
  return decodeURIComponent(td.decode(plain));
}

export async function encryptData(hashKey, hashIV, plain) {
  const key = await aesKey(hashKey, 'encrypt');
  const cipher = await crypto.subtle.encrypt({ name: 'AES-CBC', iv: te.encode(hashIV) }, key, te.encode(rfc3986(plain)));
  return btoa(String.fromCharCode(...new Uint8Array(cipher)));
}
