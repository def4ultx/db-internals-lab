// Shared helpers for storage views (owned by internals-C). Not a view file itself.
import * as THREE from 'three';

export const C = {
  bg: 0x0b1020, panel: 0x151b30, line: 0x3a4468, text: '#c0caf5', dim: '#7f8bb3',
  cyan: 0x2ac3de, green: 0x9ece6a, red: 0xf7768e, yellow: 0xe0af68, purple: 0xbb9af7,
  blue: 0x7aa2f7, orange: 0xff9e64, white: 0xe6ebff, grey: 0x56607f,
};
export const hex = (n) => '#' + new THREE.Color(n).getHexString();

// Kit: tracks every geometry/material for disposal, provides tweens + a delayed-action queue.
export function makeKit(ctx) {
  const group = new THREE.Group();
  const disposables = [];
  const tweens = [];
  const timers = [];
  let now = 0;
  const K = {
    group, now: () => now,
    track(x) { disposables.push(x); return x; },
    mat(color, o = {}) {
      const m = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1, transparent: o.opacity != null && o.opacity < 1, opacity: o.opacity ?? 1, emissive: o.emissive ?? 0x000000, emissiveIntensity: o.ei ?? 0.6 });
      disposables.push(m); return m;
    },
    // box centred at x,y,z. returns Mesh. parent defaults to group
    box(w, h, d, color, x = 0, y = 0, z = 0, o = {}) {
      const g = new THREE.BoxGeometry(w, h, d); disposables.push(g);
      const m = new THREE.Mesh(g, K.mat(color, o)); m.position.set(x, y, z);
      (o.parent || group).add(m); return m;
    },
    cyl(r, h, color, x = 0, y = 0, z = 0, o = {}) {
      const g = new THREE.CylinderGeometry(r, r, h, o.seg || 24); disposables.push(g);
      const m = new THREE.Mesh(g, K.mat(color, o)); m.position.set(x, y, z); (o.parent || group).add(m); return m;
    },
    sphere(r, color, x = 0, y = 0, z = 0, o = {}) {
      const g = new THREE.SphereGeometry(r, 16, 12); disposables.push(g);
      const m = new THREE.Mesh(g, K.mat(color, o)); m.position.set(x, y, z); (o.parent || group).add(m); return m;
    },
    // line segments between pairs [[x,y,z],[x,y,z],...] (flat list of points, pairs)
    lines(points, color = C.line, o = {}) {
      const g = new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(...p))); disposables.push(g);
      const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity: o.opacity ?? 1 }); disposables.push(m);
      const l = new THREE.LineSegments(g, m); (o.parent || group).add(l); return l;
    },
    // arrow-ish thin line (strip of 2 points) with a cone head
    arrow(from, to, color = C.cyan, o = {}) {
      const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
      const dir = b.clone().sub(a); const len = dir.length(); dir.normalize();
      const g = new THREE.Group();
      const sh = new THREE.CylinderGeometry(0.04, 0.04, Math.max(len - 0.3, 0.01), 6); disposables.push(sh);
      const mt = K.mat(color, { emissive: color, ei: 0.4, opacity: o.opacity }); const s = new THREE.Mesh(sh, mt);
      s.position.copy(a).addScaledVector(dir, (len - 0.3) / 2);
      s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      const hg = new THREE.ConeGeometry(0.14, 0.3, 8); disposables.push(hg);
      const h = new THREE.Mesh(hg, mt); h.position.copy(b).addScaledVector(dir, -0.15); h.quaternion.copy(s.quaternion);
      g.add(s, h); (o.parent || group).add(g); return g;
    },
    // static label via ctx.makeLabel when available
    label(text, x = 0, y = 0, z = 0, o = {}) {
      const s = K.dyn(text, o); s.position.set(x, y, z); (o.parent || group).add(s); return s;
    },
    // dynamic canvas-text sprite with .setText(text). o: {size(world height), color, bg, w(px width), align}
    dyn(text, o = {}) {
      const px = o.px || 48, W = o.w || 512, H = Math.round(px * (o.lines || 1) * 1.25 + 14);
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter;
      const m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: o.depthTest ?? true });
      disposables.push(tex, m);
      const sp = new THREE.Sprite(m); const hh = o.size || 0.5; sp.scale.set(hh * W / H, hh, 1);
      sp.userData.opts = o;
      sp.setText = (t, color) => {
        const c = cv.getContext('2d'); c.clearRect(0, 0, W, H);
        if (o.bg) { c.fillStyle = o.bg; c.beginPath(); c.roundRect(2, 2, W - 4, H - 4, 12); c.fill(); }
        c.font = `${o.bold ? 'bold ' : ''}${px}px ui-monospace, Menlo, monospace`; c.textBaseline = 'middle';
        c.fillStyle = color || o.color || C.text; c.textAlign = o.align || 'center';
        const lines = String(t).split('\n'); const lh = px * 1.25;
        lines.forEach((ln, i) => c.fillText(ln, (o.align === 'left' ? 12 : o.align === 'right' ? W - 12 : W / 2), H / 2 + (i - (lines.length - 1) / 2) * lh, W - 16));
        tex.needsUpdate = true;
      };
      sp.setText(text); return sp;
    },
    // tween numeric props of obj (or Vector3 etc) over dur seconds
    tween(obj, to, dur = 0.5, o = {}) {
      const from = {}; for (const k in to) from[k] = obj[k];
      const tw = { obj, from, to, dur, t: 0, ease: o.ease || ((x) => x * x * (3 - 2 * x)), done: o.done };
      tweens.push(tw); return tw;
    },
    move(obj, x, y, z, dur = 0.5, done) {
      const p = obj.position; const tw = { obj: p, from: { x: p.x, y: p.y, z: p.z }, to: { x, y, z }, dur, t: 0, ease: (v) => v * v * (3 - 2 * v), done };
      tweens.push(tw); return tw;
    },
    after(sec, fn) { timers.push({ at: now + sec, fn }); },
    // run a list of [delaySeconds, fn] sequentially (delays relative to previous)
    seq(list) { let t = 0; for (const [d, fn] of list) { t += d; K.after(t, fn); } return t; },
    clearAnim() { tweens.length = 0; timers.length = 0; },
    tick(dt) {
      now += dt;
      for (let i = tweens.length - 1; i >= 0; i--) {
        const tw = tweens[i]; tw.t += dt; const u = Math.min(1, tw.t / tw.dur), e = tw.ease(u);
        for (const k in tw.to) tw.obj[k] = tw.from[k] + (tw.to[k] - tw.from[k]) * e;
        if (u >= 1) { tweens.splice(i, 1); tw.done && tw.done(); }
      }
      for (let i = 0; i < timers.length; i++) { if (timers[i].at <= now) { const t = timers.splice(i, 1)[0]; i--; t.fn(); } }
    },
    // remove & dispose a sub-group's meshes created via kit (geometries are tracked globally; just detach)
    clear(g) { while (g.children.length) g.remove(g.children[0]); },
    info(html) { ctx && ctx.onInfo && ctx.onInfo(html); },
    dispose() { disposables.forEach((d) => d.dispose && d.dispose()); disposables.length = 0; tweens.length = 0; timers.length = 0; },
  };
  // lights are provided by the explorer scene; add a soft fill so views never look black in isolation
  return K;
}

export function setColor(mesh, color, emissive = true) {
  mesh.material.color.setHex(color); if (emissive && mesh.material.emissive) mesh.material.emissive.setHex(color).multiplyScalar(0.35);
}
export function flash(K, mesh, color, dur = 0.8, back) {
  const prev = back ?? mesh.material.color.getHex(); setColor(mesh, color); K.after(dur, () => setColor(mesh, prev));
}
// seeded RNG so demos are reproducible
export function rng(seed = 1) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
