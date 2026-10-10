// Shared helpers for internals-D views (pages, slotted pages, column store, compression, secondary index).
// Strategy: real byte-level state in JS; rendered through canvas-texture panels + InstancedMesh cells in three.js.
import * as THREE from 'three';

export const C = {
  bg: '#0d1220', panel: '#121829', line: '#2a3350', fg: '#d7def5', dim: '#8a93b5',
  blue: '#7aa2f7', purple: '#bb9af7', yellow: '#e0af68', green: '#9ece6a', red: '#f7768e',
  cyan: '#2ac3de', orange: '#ff9e64', pink: '#f5a3d7', free: '#1a2238',
};
export const MONO = 'ui-monospace, Menlo, Consolas, monospace';
export const SANS = 'Inter, system-ui, -apple-system, Segoe UI, sans-serif';

// ---- canvas panel: a plane whose texture you redraw with 2D canvas calls. 1 unit = ppu pixels.
export function panel(wU, hU, ppu = 100, opts = {}) {
  const cv = document.createElement('canvas');
  cv.width = Math.round(wU * ppu); cv.height = Math.round(hU * ppu);
  const g = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, toneMapped: false, depthWrite: opts.depthWrite ?? true });
  const geo = new THREE.PlaneGeometry(wU, hU);
  const mesh = new THREE.Mesh(geo, mat);
  const p = {
    mesh, g, cv, tex, ppu, W: cv.width, H: cv.height, wU, hU,
    clear(bg = null) { g.clearRect(0, 0, cv.width, cv.height); if (bg) { g.fillStyle = bg; g.fillRect(0, 0, cv.width, cv.height); } },
    done() { tex.needsUpdate = true; },
    dispose() { tex.dispose(); mat.dispose(); geo.dispose(); },
  };
  return p;
}

// drawing helpers (all in canvas pixel coords)
export function rr(g, x, y, w, h, r = 6) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
export function box(g, x, y, w, h, fill, stroke, r = 6, lw = 1.5) {
  rr(g, x, y, w, h, r);
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); }
}
export function text(g, s, x, y, o = {}) {
  g.font = `${o.weight || ''} ${o.size || 22}px ${o.font || SANS}`.trim();
  g.fillStyle = o.color || C.fg; g.textAlign = o.align || 'left'; g.textBaseline = o.base || 'middle';
  g.fillText(String(s), x, y);
}
export function mono(g, s, x, y, o = {}) { text(g, s, x, y, { font: MONO, ...o }); }
export function line(g, x1, y1, x2, y2, color = C.line, lw = 2, dash = null) {
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.strokeStyle = color; g.lineWidth = lw;
  g.setLineDash(dash || []); g.stroke(); g.setLineDash([]);
}
export function arrow(g, x1, y1, x2, y2, color = C.dim, lw = 2) {
  line(g, x1, y1, x2, y2, color, lw);
  const a = Math.atan2(y2 - y1, x2 - x1), s = 10;
  g.beginPath(); g.moveTo(x2, y2); g.lineTo(x2 - s * Math.cos(a - 0.4), y2 - s * Math.sin(a - 0.4));
  g.lineTo(x2 - s * Math.cos(a + 0.4), y2 - s * Math.sin(a + 0.4)); g.closePath(); g.fillStyle = color; g.fill();
}
// word-wrapped paragraph; returns y after last line
export function para(g, s, x, y, maxW, o = {}) {
  const size = o.size || 20, lh = o.lh || size * 1.35;
  g.font = `${o.weight || ''} ${size}px ${o.font || SANS}`.trim();
  g.fillStyle = o.color || C.dim; g.textAlign = 'left'; g.textBaseline = 'top';
  let ln = '';
  for (const w of String(s).split(/\s+/)) {
    const t = ln ? ln + ' ' + w : w;
    if (g.measureText(t).width > maxW && ln) { g.fillText(ln, x, y); y += lh; ln = w; } else ln = t;
  }
  if (ln) { g.fillText(ln, x, y); y += lh; }
  return y;
}

// ---- number / byte helpers
export const hex = (n, w = 2) => (n >>> 0).toString(16).toUpperCase().padStart(w, '0');
export const bin = (n, w = 8) => (n >>> 0).toString(2).padStart(w, '0');
export function wr(buf, off, width, val, le = true) {   // write unsigned int of `width` bytes
  let v = BigInt.asUintN(width * 8, BigInt(val));
  for (let i = 0; i < width; i++) { const b = Number(v & 0xffn); v >>= 8n; buf[le ? off + i : off + width - 1 - i] = b; }
}
export function rd(buf, off, width, le = true) {
  let v = 0n;
  for (let i = 0; i < width; i++) { const b = buf[le ? off + width - 1 - i : off + i]; v = (v << 8n) | BigInt(b); }
  return Number(v);
}
let _crcT = null;
export function crc32c(buf, from = 0, to = buf.length, skip = null) { // Castagnoli, reflected poly 0x82F63B78
  if (!_crcT) { _crcT = new Uint32Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0x82F63B78 : c >>> 1; _crcT[i] = c >>> 0; } }
  let c = 0xFFFFFFFF;
  for (let i = from; i < to; i++) { const b = skip && i >= skip[0] && i < skip[1] ? 0 : buf[i]; c = _crcT[(c ^ b) & 0xFF] ^ (c >>> 8); }
  return (c ^ 0xFFFFFFFF) >>> 0;
}
// deterministic PRNG
export function rng(seed = 1) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
export const ascii = (s) => Array.from(s).map((c) => c.charCodeAt(0) & 0xff);

// ---- instanced cell grid (flat bars facing the camera, +z)
export function cellGrid(cols, rows, cw, ch, depth = 0.12) {
  const n = cols * rows;
  const geo = new THREE.BoxGeometry(cw * 0.94, ch * 0.9, depth);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.1 });
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  const m = new THREE.Matrix4(), col = new THREE.Color();
  const h = new Float32Array(n).fill(1);
  const api = {
    mesh, cols, rows, cw, ch, depth,
    pos(i) { const c = i % cols, r = (i / cols) | 0; return [(c + 0.5) * cw, -(r + 0.5) * ch]; },
    set(i, color, height = 1) {
      const [x, y] = api.pos(i); h[i] = height;
      m.makeScale(1, 1, height); m.setPosition(x, y, (depth * height) / 2); mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, col.set(color));
    },
    commit() { mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; },
    dispose() { geo.dispose(); mat.dispose(); mesh.dispose(); },
  };
  for (let i = 0; i < n; i++) api.set(i, C.free, 0.3);
  api.commit();
  return api;
}

export function lights(group) {
  group.add(new THREE.AmbientLight(0xffffff, 1.6));
  const d = new THREE.DirectionalLight(0xffffff, 1.6); d.position.set(-6, 10, 14); group.add(d);
}

// Simple view scaffold to reduce boilerplate: returns {group, track(disposable)}
export function scaffold() {
  const group = new THREE.Group(); lights(group);
  const disposables = [];
  return {
    group, track(d) { disposables.push(d); return d; },
    dispose() { disposables.forEach((d) => d.dispose && d.dispose()); group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((m) => { m.map && m.map.dispose(); m.dispose(); }); } }); },
  };
}

// Slot-driven helper: read current option with default
export const opt = (config, slot, dflt) => (config && config[slot]) || dflt;
