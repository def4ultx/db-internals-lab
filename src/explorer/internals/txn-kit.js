// Shared helpers for the txn.js views (internals-E1). Not a view file.
import * as THREE from 'three';

export const C = {
  bg: 0x0b0d14, panel: 0x1a1e30, edge: 0x3b4261, text: '#e6e9f5', dim: '#8a93b8',
  red: 0xf7768e, green: 0x9ece6a, blue: 0x7aa2f7, yellow: 0xe0af68, purple: 0xbb9af7,
  cyan: 0x2ac3de, orange: 0xff9e64, grey: 0x565f89,
};
export const H = n => '#' + n.toString(16).padStart(6, '0');

/** Tracks every geometry/material/texture created so dispose() is complete. */
export class Kit {
  constructor(ctx) {
    this.ctx = ctx; this.group = new THREE.Group(); this.disposables = []; this.anims = [];
    this.timers = []; // {t, fn}
    this.clock = 0;
  }
  track(o) { this.disposables.push(o); return o; }
  add(o, parent) { (parent || this.group).add(o); return o; }
  label(text, x, y, z = 0, o = {}, parent) {
    const s = this.ctx.makeLabel(text, { size: 0.5, color: C.text, ...o });
    s.position.set(x, y, z); (parent || this.group).add(s); this.disposables.push(s.material, s.material.map); return s;
  }
  setLabel(sprite, text, o = {}) { // replace texture of an existing label
    const n = this.ctx.makeLabel(text, { size: 0.5, color: C.text, ...o });
    sprite.material.map?.dispose(); sprite.material.dispose();
    sprite.material = n.material; sprite.scale.copy(n.scale);
    this.disposables.push(n.material, n.material.map);
  }
  box(w, h, d, color, x = 0, y = 0, z = 0, o = {}, parent) {
    const g = new THREE.BoxGeometry(w, h, d);
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05, transparent: o.opacity != null, opacity: o.opacity ?? 1, emissive: o.emissive ?? 0x000000, emissiveIntensity: o.ei ?? 0.6 });
    const me = new THREE.Mesh(g, m); me.position.set(x, y, z); (parent || this.group).add(me);
    this.disposables.push(g, m); return me;
  }
  sphere(r, color, x, y, z, parent) {
    const g = new THREE.SphereGeometry(r, 16, 12); const m = new THREE.MeshStandardMaterial({ color, roughness: 0.5, emissive: color, emissiveIntensity: 0.25 });
    const me = new THREE.Mesh(g, m); me.position.set(x, y, z); (parent || this.group).add(me); this.disposables.push(g, m); return me;
  }
  line(pts, color = C.edge, parent) {
    const g = new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(...p)));
    const m = new THREE.LineBasicMaterial({ color }); const l = new THREE.Line(g, m);
    (parent || this.group).add(l); this.disposables.push(g, m); return l;
  }
  /** Arrow as thin line + cone */
  arrow(a, b, color = C.edge, parent) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), dir = B.clone().sub(A), len = dir.length();
    const grp = new THREE.Group(); (parent || this.group).add(grp);
    const cg = new THREE.CylinderGeometry(0.04, 0.04, len - 0.35, 6); const m = new THREE.MeshBasicMaterial({ color });
    const cyl = new THREE.Mesh(cg, m); cyl.position.copy(A.clone().add(B).multiplyScalar(0.5).sub(dir.clone().normalize().multiplyScalar(0.17)));
    const hg = new THREE.ConeGeometry(0.14, 0.35, 8); const head = new THREE.Mesh(hg, m);
    head.position.copy(B.clone().sub(dir.clone().normalize().multiplyScalar(0.175)));
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    cyl.quaternion.copy(q); head.quaternion.copy(q); grp.add(cyl, head); this.disposables.push(cg, hg, m);
    grp.userData.setColor = c => m.color.setHex(c); return grp;
  }
  /** Schedule fn at absolute timeline time (seconds since reset) */
  at(t, fn) { this.timers.push({ t, fn, done: false }); }
  resetTimers() { this.clock = 0; this.timers.forEach(x => x.done = false); }
  tick(dt) {
    this.clock += dt;
    for (const x of this.timers) if (!x.done && this.clock >= x.t) { x.done = true; x.fn(); }
    this.anims = this.anims.filter(a => { a.t += dt; const k = Math.min(1, a.t / a.dur); a.fn(k * k * (3 - 2 * k), k); return k < 1; });
  }
  /** tween with smoothstep easing: fn(eased, raw) */
  tween(dur, fn) { this.anims.push({ t: 0, dur, fn }); }
  move(obj, to, dur = 0.6) { const f = obj.position.clone(); const T = new THREE.Vector3(...to); this.tween(dur, k => obj.position.lerpVectors(f, T, k)); }
  dispose() {
    this.disposables.forEach(d => d && d.dispose && d.dispose());
    this.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => { m.map?.dispose(); m.dispose(); }); } });
    this.disposables = [];
  }
}

/** Flat text table drawn on a canvas plane. rows: array of arrays of strings; cellColors: fn(r,c)->css|null */
export function tablePlane(kit, rows, o = {}) {
  const cw = o.cellW ?? 150, ch = o.cellH ?? 46, fs = o.font ?? 24;
  const cols = Math.max(...rows.map(r => r.length));
  const c = document.createElement('canvas'); c.width = cols * cw + 4; c.height = rows.length * ch + 4;
  const draw = (rowsNow, colorFn) => {
    const g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height);
    g.font = `${fs}px ui-monospace, Menlo, monospace`; g.textAlign = 'center'; g.textBaseline = 'middle';
    rowsNow.forEach((r, i) => r.forEach((t, j) => {
      const bg = colorFn && colorFn(i, j, t);
      g.fillStyle = bg || (i === 0 || j === 0 && o.headCol ? '#2a3050' : '#171a2a'); g.fillRect(2 + j * cw, 2 + i * ch, cw - 3, ch - 3);
      g.fillStyle = bg ? '#0b0d14' : '#e6e9f5'; g.fillText(String(t), 2 + j * cw + cw / 2, 2 + i * ch + ch / 2);
    }));
    tex.needsUpdate = true;
  };
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter;
  const scale = o.scale ?? 0.012;
  const geo = new THREE.PlaneGeometry(c.width * scale, c.height * scale);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
  const mesh = new THREE.Mesh(geo, mat); kit.disposables.push(geo, mat, tex);
  draw(rows, o.color);
  mesh.userData.redraw = (r, cf) => draw(r || rows, cf || o.color);
  mesh.userData.size = [c.width * scale, c.height * scale];
  return mesh;
}

export function mkView(buildFn, controls = []) {
  return { build: buildFn, controls };
}
/** Standard pause/step helper for config-driven slots */
export const cfg = (ctx, slot, def) => (ctx.config && ctx.config[slot]) || def;
