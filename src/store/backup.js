// Encrypted backup export/import.
//
// Flow:
//   export:  DB bytes -> encryptBlob(passphrase) -> download .portefeuille file
//   import:  upload .portefeuille -> decryptBlob(passphrase) -> DB bytes -> save()
//
// The file extension `.portefeuille` is gitignored at the repo level to prevent
// accidental commits.

import { encryptBlob, decryptBlob } from './crypto.js';

const FILE_EXT = 'portefeuille';

export async function exportEncrypted(dbBytes, passphrase) {
  const blob = await encryptBlob(dbBytes, passphrase);
  return blob;
}

export async function importEncrypted(blob, passphrase) {
  return decryptBlob(blob, passphrase);
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
