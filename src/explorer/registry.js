// Loads the internals views defensively and provides a generic fallback view.
import * as THREE from 'three';
import { layerById } from '../shared/layers.js';

const modules = import.meta.glob('./internals/{frontend,planning,execution,storage,pages,txn,distributed}.js');
export const viewRegistry = {};
export const registryStatus = { loaded: [], failed: [] };

export async function loadViews() {
  await Promise.all(Object.entries(modules).map(async ([path, loader]) => {
    try {
      const m = await loader();
      if (m && m.views && typeof m.views === 'object') {
        Object.assign(viewRegistry, m.views);
        registryStatus.loaded.push(path);
      } else registryStatus.failed.push(path + ' (no views export)');
    } catch (e) {
      console.warn('[explorer] internals file failed:', path, e);
      registryStatus.failed.push(path);
    }
  }));
  return viewRegistry;
}

export function makeLabelFactory(track) {
  return function makeLabel(text, { size = 1, color = '#e6ecff', bg = null, weight = 600 } = {}) {
    const dpr = 2, px = 64;
    const cv = document.createElement('canvas');
    const g = cv.getContext('2d');
    g.font = `${weight} ${px}px Inter, system-ui, sans-serif`;
    const lines = String(text).split('\n');
    const w = Math.ceil(Math.max(...lines.map((l) => g.measureText(l).width))) + 24;
    const h = Math.ceil(px * 1.25 * lines.length) + 12;
    cv.width = w * dpr / 2; cv.height = h * dpr / 2;
    g.scale(dpr / 2, dpr / 2);
    g.font = `${weight} ${px}px Inter, system-ui, sans-serif`;
    g.textBaseline = 'middle'; g.textAlign = 'center';
    if (bg) { g.fillStyle = bg; g.beginPath(); g.roundRect(0, 0, w, h, 14); g.fill(); }
    g.fillStyle = color;
    lines.forEach((l, i) => g.fillText(l, w / 2, 6 + px * 0.625 + i * px * 1.25));
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    const s = new THREE.Sprite(mat);
    const hh = size * lines.length;
    s.scale.set(hh * (w / h), hh, 1);
    s.userData.dispose = () => { tex.dispose(); mat.dispose(); };
    track?.(s);
    return s;
  };
}

// Generic view built from a component's `internals` list.
export function genericView(comp) {
  return {
    generic: true,
    build(ctx) {
      const group = new THREE.Group();
      const color = new THREE.Color(layerById[comp.layer]?.color || '#7aa2f7');
      const geos = [], mats = [];
      const mk = (g, m) => { geos.push(g); mats.push(m); return new THREE.Mesh(g, m); };
      const centre = mk(new THREE.BoxGeometry(5, 2.4, 3), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.4, metalness: 0.2 }));
      group.add(centre);
      const cl = ctx.makeLabel(comp.name, { size: 0.9, color: '#fff' }); cl.position.set(0, 2.2, 0); group.add(cl);
      const items = comp.internals || [];
      const n = Math.max(items.length, 1);
      const boxes = [];
      const lineMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.45 });
      mats.push(lineMat);
      items.forEach((it, i) => {
        const a = Math.PI + (i / Math.max(n - 1, 1)) * Math.PI; // half ring in front
        const ang = n === 1 ? Math.PI * 1.5 : a;
        const x = Math.cos(ang) * 8.5, z = -Math.sin(ang) * 4.5 + 1, y = (i % 2 ? 1.5 : -1.2);
        const bm = new THREE.MeshStandardMaterial({ color: 0x1b2340, emissive: color, emissiveIntensity: 0.12, roughness: 0.5 });
        const b = mk(new THREE.BoxGeometry(4, 1.5, 2), bm); b.position.set(x, y, z); group.add(b); boxes.push(b);
        const l = ctx.makeLabel(it.name, { size: 0.55 }); l.position.set(x, y + 1.35, z); group.add(l);
        const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(x, y, z)]); geos.push(lg);
        group.add(new THREE.Line(lg, lineMat));
      });
      const pk = [];
      let tt = 0;
      const mkSteps = items.map((it, i) => ({
        title: it.name, text: it.desc,
        run() { boxes.forEach((b, j) => { b.material.emissiveIntensity = j === i ? 0.9 : 0.12; }); ctx.onInfo(`<b>${it.name}</b><br>${it.desc}`); },
      }));
      return {
        group,
        update(dt, t) {
          tt += dt;
          boxes.forEach((b, i) => { b.position.y += Math.sin(t * 1.2 + i) * 0.0015; });
          if (boxes.length && tt > 0.9) { tt = 0; const b = boxes[Math.floor(Math.random() * boxes.length)];
            ctx.addPacket({ from: centre.position.clone(), to: b.position.clone(), color, duration: 1.1 }); }
        },
        dispose() { geos.forEach((g) => g.dispose()); mats.forEach((m) => m.dispose()); },
        onConfigChange() {},
        steps: mkSteps,
      };
    },
    controls: [],
  };
}
