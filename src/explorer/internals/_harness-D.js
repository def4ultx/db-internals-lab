import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { views } from './pages.js';

const q = new URLSearchParams(location.search);
const name = q.get('view') || 'page-file';
const config = {};
(q.get('config') || '').split(',').filter(Boolean).forEach((kv) => { const [k, v] = kv.split(':'); config[k] = v; });

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
const scene = new THREE.Scene(); scene.background = new THREE.Color('#0b0e17');
const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 500); cam.position.set(0, 0, 24);
const oc = new OrbitControls(cam, canvas);
function resize() { const w = innerWidth - 290, h = innerHeight; renderer.setSize(w, h, false); canvas.style.width = w + 'px'; canvas.style.height = h + 'px'; cam.aspect = w / h; cam.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

const infoEl = document.getElementById('info');
const ctx = {
  config, palette: {},
  makeLabel(text, { size = 0.5, color = '#fff' } = {}) {
    const cv = document.createElement('canvas'); const g = cv.getContext('2d'); const px = 64;
    g.font = `${px}px sans-serif`; cv.width = Math.ceil(g.measureText(text).width) + 8; cv.height = px * 1.3;
    g.font = `${px}px sans-serif`; g.fillStyle = color; g.textBaseline = 'middle'; g.fillText(text, 4, cv.height / 2);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true }));
    s.scale.set(size * cv.width / px, size * cv.height / px, 1); return s;
  },
  onInfo(h) { infoEl.innerHTML = h; },
  addPacket() {},
};
const def = views[name];
if (!def) throw new Error('no view ' + name);
const inst = def.build(ctx);
scene.add(inst.group);

// slot selectors
const SLOTS = { 'page-layout': ['nsm-row', 'dsm-column', 'pax'], compression: ['none', 'dictionary', 'for-bitpack', 'delta', 'rle', 'lz4-zstd'], 'secondary-index': ['btree', 'hash', 'bitmap', 'zonemap-minmax', 'bloom', 'inverted'], 'table-organization': ['heap', 'index-organized', 'columnar', 'lsm-kv'] };
const slotsEl = document.getElementById('slots');
for (const [s, os] of Object.entries(SLOTS)) {
  const sel = document.createElement('select'); sel.id = 'slot-' + s;
  os.forEach((o) => sel.add(new Option(s + ': ' + o, o)));
  sel.value = config[s] || ''; sel.onchange = () => { config[s] = sel.value; inst.onConfigChange && inst.onConfigChange({ ...config }); };
  if (!config[s]) sel.insertBefore(new Option(s + ': (default)', ''), sel.firstChild), sel.value = '';
  slotsEl.appendChild(sel);
}
const api = { refresh() {} };
const ctl = document.getElementById('ctl');
for (const c of def.controls || []) {
  const lab = document.createElement('label'); lab.textContent = c.label; let el;
  if (c.type === 'button') { el = document.createElement('button'); el.textContent = c.label; el.onclick = () => c.onChange(true, api); ctl.appendChild(el); el.id = 'c-' + c.id; continue; }
  if (c.type === 'range') { el = document.createElement('input'); el.type = 'range'; el.min = c.min; el.max = c.max; el.step = c.step || 1; el.value = c.value; el.oninput = () => c.onChange(+el.value, api); }
  else if (c.type === 'select') { el = document.createElement('select'); (c.options || []).forEach((o) => { const v = typeof o === 'object' ? o.value : o; el.add(new Option(typeof o === 'object' ? o.label : o, v)); }); el.value = c.value; el.onchange = () => c.onChange(el.value, api); }
  else { el = document.createElement('input'); el.type = 'checkbox'; el.checked = !!c.value; el.onchange = () => c.onChange(el.checked, api); }
  el.id = 'c-' + c.id; ctl.appendChild(lab); ctl.appendChild(el);
}
const stEl = document.getElementById('steps');
(inst.steps || []).forEach((s, i) => { const b = document.createElement('button'); b.textContent = (i + 1) + '. ' + s.title; b.id = 'step-' + i; b.onclick = () => { s.run(); ctx.onInfo('<b>' + s.title + '</b><br>' + s.text); }; stEl.appendChild(b); });

const clock = new THREE.Clock(); let t = 0;
function loop() { const dt = clock.getDelta(); t += dt; inst.update && inst.update(dt, t); oc.update(); renderer.render(scene, cam); requestAnimationFrame(loop); }
loop();
window.__h = { inst, ctx, cam, oc, setCam(x, y, z) { cam.position.set(x, y, z); oc.target.set(0, 0, 0); oc.update(); }, ctl: def.controls, config, errors: [] };
