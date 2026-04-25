// Simple toast notifications. Creates DOM nodes, auto-dismisses after 4s.
//
// `toast(message, kind, duration)` is the legacy ergonomic call.
// `toast(message, { kind, duration, action })` is the new shape: pass
// `{action: {label, onClick}}` to render a button inside the toast — used by
// danger toasts to offer a "Retry" affordance instead of forcing the user to
// retrigger the failed action through the UI.

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

// Accept legacy 3-arg signature OR a single options object as the second arg.
function normalizeOpts(arg2, arg3) {
  if (arg2 && typeof arg2 === 'object') {
    return {
      kind: arg2.kind || 'info',
      durationMs: arg2.duration ?? arg2.durationMs ?? 4000,
      action: arg2.action || null,
    };
  }
  return { kind: arg2 || 'info', durationMs: arg3 ?? 4000, action: null };
}

/**
 * @typedef {{ kind?: string, duration?: number, durationMs?: number, action?: { label?: string, onClick: () => any }|null }} ToastOpts
 *
 * @param {string} message
 * @param {string|ToastOpts} [arg2] kind string ("info"/"danger"/...) or full opts object
 * @param {number} [arg3] legacy duration when arg2 is a kind string
 */
export function toast(message, arg2 = 'info', arg3 = 4000) {
  const { kind, durationMs, action } = normalizeOpts(arg2, arg3);
  const host = getHost();
  const node = document.createElement('div');
  node.className = `toast ${kind === 'info' ? '' : kind}`.trim();

  // Wrap message in a span so we can append an action button beside it.
  const msg = document.createElement('span');
  msg.className = 'toast-msg';
  msg.textContent = message;
  node.appendChild(msg);

  // Fade-out helper. Triggered by the auto-dismiss timer or by clicking the
  // action button (so the toast disappears as soon as the retry is handed off).
  let removed = false;
  function dismiss() {
    if (removed) return;
    removed = true;
    node.classList.add('fading');
    setTimeout(() => node.remove(), 250);
  }

  if (action && typeof action.onClick === 'function') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action';
    btn.textContent = action.label || 'Retry';
    btn.addEventListener('click', () => {
      try { action.onClick(); }
      finally { dismiss(); }
    });
    node.appendChild(btn);
  }

  host.appendChild(node);
  // Fade-out is purely class-driven. The .toast.fading rule owns the
  // transition + opacity:0 — keeping it in CSS lets a strict
  // `style-src 'self'` (no 'unsafe-inline') stay green.
  setTimeout(dismiss, durationMs);
}
