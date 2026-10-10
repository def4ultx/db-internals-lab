// Tiny DOM helpers shared by all chapter demos. No framework.
export function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs && typeof attrs === 'object' && !(attrs instanceof Node) && !Array.isArray(attrs)) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) e.setAttribute(k, v);
    }
  } else if (attrs != null) kids.unshift(attrs);
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}
export const btn = (label, onclick, cls = '') => h('button', { class: 'dbtn ' + cls, onclick }, label);
// slider with live value readout: returns {el, get, set}
export function slider({ label, min, max, step = 1, value, fmt = (v) => v, onInput }) {
  const out = h('span', { class: 'val' }, fmt(value));
  const inp = h('input', { type: 'range', min, max, step, value });
  inp.addEventListener('input', () => { out.textContent = fmt(+inp.value); onInput && onInput(+inp.value); });
  return { el: h('label', { class: 'ctl' }, h('span', { class: 'lbl' }, label), inp, out), get: () => +inp.value, set: (v) => { inp.value = v; out.textContent = fmt(v); } };
}
export function toggle({ label, value = false, onChange }) {
  const inp = h('input', { type: 'checkbox' }); inp.checked = value;
  inp.addEventListener('change', () => onChange && onChange(inp.checked));
  return { el: h('label', { class: 'ctl' }, inp, h('span', { class: 'lbl' }, label)), get: () => inp.checked };
}
// HiDPI canvas: returns {cv, ctx, w, h}; draw in CSS pixels.
export function canvas(w, hgt) {
  const cv = h('canvas', { class: 'dcanvas' });
  const dpr = window.devicePixelRatio || 1;
  cv.width = w * dpr; cv.height = hgt * dpr; cv.style.width = '100%'; cv.style.maxWidth = w + 'px'; cv.style.aspectRatio = `${w}/${hgt}`;
  const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
  return { cv, ctx, w, h: hgt };
}
export const C = { fg: '#d7def5', dim: '#8a93b5', line: '#2a3350', panel: '#171d2e', accent: '#7aa2f7', good: '#9ece6a', warn: '#e0af68', bad: '#f7768e', cyan: '#2ac3de', purple: '#bb9af7', orange: '#ff9e64' };
