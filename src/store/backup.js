// Encrypted backup export/import.
//
// Flow:
//   export:  { dbBytes, profile? } -> payload -> encryptBlob(passphrase) -> .ptf file
//   import:  upload .ptf -> decryptBlob(passphrase) -> parsePayload
//            -> { db, profile }
//
// Payload format, carried inside the AES-GCM plaintext:
//   bytes 0..3   : magic "PTFP" (Portefeuille Payload)
//   byte  4      : payload version (u8, currently 1)
//   byte  5      : flags (bit 0 = profile present)
//   bytes 6..9   : dbLen (u32 big-endian)
//   bytes 10..   : db bytes, then UTF-8 JSON profile (if flag set)

import { encryptBlob, decryptBlob } from './crypto.js';

const FILE_EXT = 'ptf';
const PAYLOAD_MAGIC = new TextEncoder().encode('PTFP'); // 4 bytes
const PAYLOAD_VERSION = 1;
const HEADER_LEN = PAYLOAD_MAGIC.length + 1 + 1 + 4; // magic+version+flags+dbLen

function buildPayload(dbBytes, profile) {
  const hasProfile = profile != null;
  const profileBytes = hasProfile
    ? new TextEncoder().encode(JSON.stringify(profile))
    : new Uint8Array(0);
  const out = new Uint8Array(HEADER_LEN + dbBytes.length + profileBytes.length);
  out.set(PAYLOAD_MAGIC, 0);
  out[4] = PAYLOAD_VERSION;
  out[5] = hasProfile ? 1 : 0;
  // u32 big-endian dbLen. Use a DataView on a fresh buffer view; we can't use
  // out.buffer directly because out may share a buffer with other data (it
  // doesn't here, but this is defensive and cheap).
  const view = new DataView(out.buffer, out.byteOffset, HEADER_LEN);
  view.setUint32(6, dbBytes.length, false);
  out.set(dbBytes, HEADER_LEN);
  if (hasProfile) out.set(profileBytes, HEADER_LEN + dbBytes.length);
  return out;
}

function parsePayload(bytes) {
  if (bytes.length < HEADER_LEN
      || bytes[0] !== PAYLOAD_MAGIC[0]
      || bytes[1] !== PAYLOAD_MAGIC[1]
      || bytes[2] !== PAYLOAD_MAGIC[2]
      || bytes[3] !== PAYLOAD_MAGIC[3]) {
    throw new Error('Invalid payload: missing PTFP magic');
  }
  const version = bytes[4];
  if (version !== PAYLOAD_VERSION) {
    throw new Error(`Unsupported payload version: ${version}`);
  }
  const flags = bytes[5];
  const hasProfile = (flags & 1) === 1;
  const view = new DataView(bytes.buffer, bytes.byteOffset, HEADER_LEN);
  const dbLen = view.getUint32(6, false);
  if (HEADER_LEN + dbLen > bytes.length) {
    throw new Error('Payload truncated: dbLen exceeds blob');
  }
  const db = bytes.slice(HEADER_LEN, HEADER_LEN + dbLen);
  let profile = null;
  if (hasProfile) {
    const profBytes = bytes.slice(HEADER_LEN + dbLen);
    try {
      profile = JSON.parse(new TextDecoder().decode(profBytes));
    } catch (_) {
      profile = null;
    }
  }
  return { db, profile };
}

// Export. `opts.profile`, when non-null, is embedded in the encrypted payload.
export async function exportEncrypted(dbBytes, passphrase, opts = {}) {
  const profile = opts.profile ?? null;
  const payload = buildPayload(dbBytes, profile);
  return encryptBlob(payload, passphrase);
}

// Import. Returns `{ db, profile }` (profile may be null if the backup was
// exported without one).
export async function importEncrypted(blob, passphrase) {
  const pt = await decryptBlob(blob, passphrase);
  return parsePayload(pt);
}

export function buildFilename(label, date = new Date()) {
  const stamp = date.toISOString().slice(0, 10).replaceAll('-', '');
  const clean = String(label ?? 'snapshot').replace(/[^a-zA-Z0-9_-]/g, '_');
  return `portefeuille_${clean}_${stamp}.${FILE_EXT}`;
}

export function downloadBlob(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const BACKUP_EXT = FILE_EXT;
