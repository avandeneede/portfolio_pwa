// Hash-based router. Keeps the app single-page on GitHub Pages
// without needing redirect rules.
//
// Routes:
//   #/              -> home (snapshots list)
//   #/upload        -> upload flow
//   #/snapshot/:id  -> dashboard
//   #/settings      -> settings
//
// Unknown routes fall back to home.

const handlers = [];

export function addRoute(pattern, handler) {
  const regex = patternToRegex(pattern);
  handlers.push({ pattern, regex, handler });
}

function patternToRegex(pattern) {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\:(\w+)/g, '(?<$1>[^/]+)');
  return new RegExp(`^${escaped}$`);
}

function parseHash() {
  const raw = (location.hash || '#/').slice(1) || '/';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

export function navigate(path) {
  if (!path.startsWith('/')) path = `/${path}`;
  location.hash = path === '/' ? '' : path;
}

export function start(notFound) {
  const run = () => {
    const path = parseHash();
    for (const { regex, handler } of handlers) {
      const m = regex.exec(path);
      if (m) return handler({ params: m.groups ?? {}, path });
    }
    return notFound?.({ path });
  };
  window.addEventListener('hashchange', run);
  run();
}

export function currentPath() { return parseHash(); }
