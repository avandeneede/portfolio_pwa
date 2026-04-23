// AES-GCM + PBKDF2 helpers over WebCrypto.
//
// Parameters match OWASP 2023 recommendations:
//   - PBKDF2-SHA256, 600_000 iterations, 16-byte random salt
//   - AES-GCM 256-bit, 12-byte random IV
//
// Blob format (for encrypted backups):
//   bytes 0..3    : magic "PORT"
//   bytes 4..4    : version (u8, currently 1)
//   bytes 5..20   : salt (16 bytes)
//   bytes 21..32  : iv (12 bytes)
//   bytes 33..    : ciphertext (includes GCM auth tag appended by WebCrypto)
//
// Works in browser (globalThis.crypto) and Node ≥ 20 (globalThis.crypto).

const MAGIC = new TextEncoder().encode('PORT'); // 4 bytes
const VERSION = 1;
const PBKDF2_ITERATIONS = 600_000;
const SALT_LEN = 16;
const IV_LEN = 12;

function getCrypto() {
  if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.subtle) {
    throw new Error('WebCrypto not available in this runtime');
  }
  return globalThis.crypto;
}

export function randomBytes(n) {
  const out = new Uint8Array(n);
  getCrypto().getRandomValues(out);
  return out;
}

export async function deriveKey(passphrase, salt, iterations = PBKDF2_ITERATIONS) {
  const crypto = getCrypto();
  const enc = new TextEncoder();
  const pwKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    pwKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptBlob(plaintext, passphrase) {
  const crypto = getCrypto();
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = await deriveKey(passphrase, salt);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
  );

  const out = new Uint8Array(MAGIC.length + 1 + SALT_LEN + IV_LEN + ct.length);
  out.set(MAGIC, 0);
  out[MAGIC.length] = VERSION;
  out.set(salt, MAGIC.length + 1);
  out.set(iv, MAGIC.length + 1 + SALT_LEN);
  out.set(ct, MAGIC.length + 1 + SALT_LEN + IV_LEN);
  return out;
}

export async function decryptBlob(blob, passphrase) {
  const crypto = getCrypto();
  if (blob.length < MAGIC.length + 1 + SALT_LEN + IV_LEN + 16) {
    throw new Error('Blob too short to be valid');
  }
  for (let i = 0; i < MAGIC.length; i++) {
    if (blob[i] !== MAGIC[i]) throw new Error('Invalid blob magic (not a Portefeuille backup)');
  }
  const version = blob[MAGIC.length];
  if (version !== VERSION) throw new Error(`Unsupported backup version: ${version}`);
  const salt = blob.slice(MAGIC.length + 1, MAGIC.length + 1 + SALT_LEN);
  const iv = blob.slice(MAGIC.length + 1 + SALT_LEN, MAGIC.length + 1 + SALT_LEN + IV_LEN);
  const ct = blob.slice(MAGIC.length + 1 + SALT_LEN + IV_LEN);
  const key = await deriveKey(passphrase, salt);
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return new Uint8Array(pt);
  } catch {
    throw new Error('Decryption failed (wrong passphrase or corrupt blob)');
  }
}
