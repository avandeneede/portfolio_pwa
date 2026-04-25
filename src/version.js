// App version. Bumped in lockstep with `CACHE_VERSION` in sw.js — both must
// match so the SW serves new code AND the client knows to auto-reparse stored
// snapshots from their saved XLSX bytes.
//
// On every release: bump CACHE_VERSION in sw.js *and* APP_VERSION here.
//
// The auto-reparse trigger lives in main.js: when bootstrap sees that the
// version stored in the DB's `kv` table differs from this constant, it runs
// reparseAllSnapshots once and writes the new version back.
export const APP_VERSION = 'v41';
