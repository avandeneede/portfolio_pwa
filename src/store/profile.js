// Local profile: user identity + portfolio-holder (company) info.
//
// Stored as a plain JSON blob in localStorage (key 'portfolio.profile').
// Unlike snapshot data, this is the user's own identity — not client PII —
// so it's kept outside the encrypted SQLite DB for convenience (no passphrase
// prompt to read your own name + company).
//
// Shape:
//   {
//     user: { name, email, phone, position },
//     company: { name, vat, address, logo },     // logo = data URL
//     locale: 'fr' | 'nl' | 'en',
//   }

const STORAGE_KEY = 'portfolio.profile';

const DEFAULT_PROFILE = Object.freeze({
  user: { name: '', email: '', phone: '', position: '' },
  company: { name: '', vat: '', address: '', logo: '' },
  locale: '',
});

function cloneDefault() {
  return JSON.parse(JSON.stringify(DEFAULT_PROFILE));
}

// Read the profile. Always returns a fully-shaped object (missing keys are
// filled from defaults) so callers never need to null-check deep paths.
export function loadProfile() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return cloneDefault();
    const parsed = JSON.parse(raw);
    const out = cloneDefault();
    if (parsed && typeof parsed === 'object') {
      if (parsed.user && typeof parsed.user === 'object') {
        Object.assign(out.user, parsed.user);
      }
      if (parsed.company && typeof parsed.company === 'object') {
        Object.assign(out.company, parsed.company);
      }
      if (typeof parsed.locale === 'string') out.locale = parsed.locale;
    }
    return out;
  } catch (_) {
    return cloneDefault();
  }
}

// Write the whole profile back to localStorage. Accepts a partial update
// (deep-merged with the existing value) so callers can do one-field saves:
//   saveProfile({ user: { name: 'X' } })
export function saveProfile(patch) {
  const cur = loadProfile();
  if (patch && typeof patch === 'object') {
    if (patch.user && typeof patch.user === 'object') {
      Object.assign(cur.user, patch.user);
    }
    if (patch.company && typeof patch.company === 'object') {
      Object.assign(cur.company, patch.company);
    }
    if (typeof patch.locale === 'string') cur.locale = patch.locale;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cur));
  } catch (e) {
    console.warn('[profile] save failed', e);
  }
  return cur;
}

// Shorthand for the sidebar: the display name shown next to the logo.
export function profileDisplayName(profile) {
  const p = profile || loadProfile();
  return (p.company && p.company.name) || (p.user && p.user.name) || '';
}
