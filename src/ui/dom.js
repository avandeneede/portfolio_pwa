// Tiny DOM helpers. No framework. Never innerHTML for user data (CSP/XSS).

export function h(tag, props = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') throw new Error('Use children, not html, to avoid XSS');
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  appendChildren(el, children);
  return el;
}

function appendChildren(parent, children) {
  if (children == null || children === false) return;
  if (Array.isArray(children)) {
    for (const c of children) appendChildren(parent, c);
    return;
  }
  if (children instanceof Node) parent.appendChild(children);
  else parent.appendChild(document.createTextNode(String(children)));
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function mount(container, ...nodes) {
  clear(container);
  for (const n of nodes) {
    if (n != null && n !== false) container.appendChild(n instanceof Node ? n : document.createTextNode(String(n)));
  }
}
