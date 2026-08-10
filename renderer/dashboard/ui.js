// Tiny DOM helpers shared by dashboard pages.

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  for (const child of children.flat()) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(child));
  }
  return node;
}

export function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

let toastEl = null;
let toastTimer = null;
export function toast(message) {
  if (!toastEl) {
    toastEl = el('div', { id: 'toast' });
    document.body.append(toastEl);
  }
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

export function openModal(contentEl, { onClose } = {}) {
  const root = document.getElementById('modal-root');
  const scrim = el('div', { class: 'scrim' });
  scrim.append(contentEl);
  const close = () => {
    scrim.remove();
    document.removeEventListener('keydown', onKey);
    onClose && onClose();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) close(); });
  document.addEventListener('keydown', onKey);
  root.append(scrim);
  return close;
}

export function timeLabel(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yest = new Date(today.getTime() - 86400000);
  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  if (sameDay(d, today)) return 'TODAY';
  if (sameDay(d, yest)) return 'YESTERDAY';
  return d.toLocaleDateString([], { month: 'long', day: 'numeric' }).toUpperCase();
}

export function abbreviateCount(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 10000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}
