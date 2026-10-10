// Cached-primitive helper for views that rebuild their scene on every operation (owned by internals-C).
import * as THREE from 'three';

export function makeLib() {
  const boxG = new THREE.BoxGeometry(1, 1, 1), coneG = new THREE.ConeGeometry(0.5, 1, 10);
  const mats = new Map(), labs = new Map();
  const L = {
    mat(color, ei = 0.35, opacity = 1) {
      const k = `${color}:${ei}:${opacity}`; let m = mats.get(k);
      if (!m) { m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: ei, roughness: 0.6, metalness: 0.05, transparent: opacity < 1, opacity }); mats.set(k, m); }
      return m;
    },
    mesh(parent, w, h, d, color, x = 0, y = 0, z = 0, ei = 0.35, opacity = 1) {
      const m = new THREE.Mesh(boxG, L.mat(color, ei, opacity)); m.scale.set(w, h, d); m.position.set(x, y, z); parent.add(m); return m;
    },
    lab(parent, text, color = '#c0caf5', h = 0.5, x = 0, y = 0, z = 0, wide = false) {
      const key = `${text}|${color}|${wide}`; let m = labs.get(key);
      const W = wide ? 1536 : 256, H = 64;
      if (!m) {
        const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d');
        c.font = 'bold 40px ui-monospace, Menlo, monospace'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = color; c.fillText(String(text), W / 2, H / 2 + 2, W - 8);
        const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
        m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }); labs.set(key, m);
      }
      const s = new THREE.Sprite(m); s.scale.set(h * W / H, h, 1); s.position.set(x, y, z); parent.add(s); return s;
    },
    seg(parent, a, b, color, t = 0.06, ei = 0.5, opacity = 1) {
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 0.001;
      const m = L.mesh(parent, len, t, t, color, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, a[2] || 0, ei, opacity); m.rotation.z = Math.atan2(dy, dx); return m;
    },
    head(parent, x, y, z, ang, color, s = 0.24) {
      const m = new THREE.Mesh(coneG, L.mat(color, 0.5)); m.scale.set(s, s * 1.4, s); m.position.set(x, y, z); m.rotation.z = ang - Math.PI / 2; parent.add(m); return m;
    },
    arrow(parent, a, b, color, t = 0.06) {
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), s = 0.24;
      const e = [b[0] - Math.cos(ang) * s * 0.6, b[1] - Math.sin(ang) * s * 0.6, b[2] || 0];
      L.seg(parent, a, e, color, t); L.head(parent, b[0] - Math.cos(ang) * s * 0.5, b[1] - Math.sin(ang) * s * 0.5, b[2] || 0, ang, color, s);
    },
    inst(parent, n, color) { const im = new THREE.InstancedMesh(boxG, L.mat(color, 0.1), n); parent.add(im); return im; },
    clear(g) { g.traverse((o) => { if (o.isInstancedMesh) o.dispose(); }); g.clear(); },
    dispose() { boxG.dispose(); coneG.dispose(); mats.forEach((m) => m.dispose()); labs.forEach((m) => { m.map.dispose(); m.dispose(); }); mats.clear(); labs.clear(); },
  };
  return L;
}
export const PAL = { leaf: 0x1d5f78, leafCell: 0x2ac3de, inner: 0x4a3a86, innerCell: 0xbb9af7, empty: 0x0f1428, hi: 0xe0af68, ok: 0x9ece6a, bad: 0xf7768e, link: 0x7dcfff, ovf: 0xff9e64, ghost: 0xf7768e };
export function wrap(text, n = 60) {
  const words = String(text).split(' '); const lines = ['']; for (const w of words) { const l = lines[lines.length - 1]; if ((l + ' ' + w).length > n && l) lines.push(w); else lines[lines.length - 1] = l ? l + ' ' + w : w; }
  return lines.slice(0, 2).join('\n');
}
