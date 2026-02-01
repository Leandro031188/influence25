import CryptoJS from 'crypto-js';

function key() {
  const k = process.env.TOKEN_ENCRYPTION_KEY || '';
  if (k.length < 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be at least 32 chars');
  }
  return CryptoJS.enc.Utf8.parse(k.slice(0, 32));
}

export function encryptToken(token) {
  const iv = CryptoJS.lib.WordArray.random(16);
  const encrypted = CryptoJS.AES.encrypt(token, key(), { iv });
  return iv.toString(CryptoJS.enc.Hex) + ':' + encrypted.toString();
}

export function decryptToken(enc) {
  const [ivHex, cipher] = enc.split(':');
  const iv = CryptoJS.enc.Hex.parse(ivHex);
  const decrypted = CryptoJS.AES.decrypt(cipher, key(), { iv });
  return decrypted.toString(CryptoJS.enc.Utf8);
}
