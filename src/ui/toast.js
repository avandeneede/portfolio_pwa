// Simple toast notifications. Creates DOM nodes, auto-dismisses after 4s.

const HOST_ID = 'toast-host';

function getHost() {
  let host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = HOST_ID;
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  return host;
}

export function toast(message, kind = 'info', durationMs = 4000) {
  const host = getHost();
  const node = document.createElement('div');
  node.className = `toast ${kind === 'info' ? '' : kind}`.trim();
  node.textContent = message;
  host.appendChild(node);
  setTimeout(() => {
    node.style.transition = 'opacity .25s';
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 250);
  }, durationMs);
}
