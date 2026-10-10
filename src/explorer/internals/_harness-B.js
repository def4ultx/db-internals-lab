import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { views } from './execution.js';

const q = new URLSearchParams(location.search);
const ids = Object.keys(views);
let viewId = q.get('view') || ids[0];
const config = {};
for (const [k, v] of q) if (!['view', 'step', 'ctl'].includes(k)) config[k] = v;

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0b0e17);
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 0, 19);
const controls = new OrbitControls(camera, renderer.domElement);
scene.add(new THREE.AmbientLight(0xffffff, 0.9));
const dl = new THREE.DirectionalLight(0xffffff, 1.4); dl.position.set(5, 10, 14); scene.add(dl);

function makeLabel(text, { size = 0.6, color = '#c0caf5' } = {}) {
  const lines = String(text).split('\n'); const fs = 48;
  const c = document.createElement('canvas'); const g = c.getContext('2d');
  g.font = `${fs}px ui-monospace,Menlo,monospace`;
  const w = Math.max(...lines.map(l => g.measureText(l).width)) + 16, h = lines.length * fs * 1.2 + 10;
  c.width = Math.ceil(w); c.height = Math.ceil(h); g.font = `${fs}px ui-monospace,Menlo,monospace`;
  g.fillStyle = color; g.textBaseline = 'top';
  lines.forEach((l, i) => g.fillText(l, 8, 5 + i * fs * 1.2));
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  const hh = size * lines.length * 1.2 * 1.0 + size * 0.2; s.scale.set(hh * c.width / c.height, hh, 1); return s;
}
const info = document.getElementById('info');
let cur = null, curView = null, t = 0, stepIdx = 0;
function load() {
  if (cur) { scene.remove(cur.group); cur.dispose(); }
  curView = views[viewId];
  const ctx = { config, palette: {}, makeLabel, onInfo: h => { info.innerHTML = h; }, addPacket() {} };
  cur = curView.build(ctx); scene.add(cur.group); t = 0;
  const bar = document.getElementById('bar'); bar.innerHTML = '';
  const sel = document.createElement('select'); ids.forEach(i => { const o = new Option(i, i); if (i === viewId) o.selected = true; sel.add(o); });
  sel.onchange = () => { viewId = sel.value; load(); }; bar.append(sel);
  const nx = document.createElement('button'); nx.textContent = 'Next step'; nx.onclick = () => { const s = cur.steps[stepIdx++ % cur.steps.length]; s.run(); }; bar.append(nx);
  (curView.controls || []).forEach(c => {
    const l = document.createElement('label'); l.textContent = c.label + ' ';
    let el;
    if (c.type === 'button') { el = document.createElement('button'); el.textContent = c.label; el.onclick = () => c.onChange(true, cur); l.textContent = ''; }
    else if (c.type === 'select') { el = document.createElement('select'); c.options.forEach(o => el.add(new Option(o.label || o, o.value ?? o))); el.value = c.value; el.onchange = () => c.onChange(el.value, cur); }
    else if (c.type === 'range') { el = document.createElement('input'); el.type = 'range'; el.min = c.min; el.max = c.max; el.step = c.step || 1; el.value = c.value; el.oninput = () => c.onChange(+el.value, cur); }
    else { el = document.createElement('input'); el.type = 'checkbox'; el.checked = !!c.value; el.onchange = () => c.onChange(el.checked, cur); }
    el.dataset.ctl = c.id; l.append(el); bar.append(l);
  });
}
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
window.__h = { setConfig(c) { Object.assign(config, c); cur.onConfigChange({ ...config }); }, step(i) { cur.steps[i].run(); }, ctl(id, v) { const c = curView.controls.find(x => x.id === id); c.onChange(v, cur); }, views: ids, errors: [], makeLabel, group: () => cur.group };
window.addEventListener('error', e => window.__h.errors.push(String(e.message)));
load();
let last = performance.now();
function frame(now) {
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now;
  if (!window.__h.freeze) { t += dt * (window.__h.speed || 1); cur.update(dt * (window.__h.speed || 1), t); }
  controls.update(); renderer.render(scene, camera); requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
// deterministic fast-forward for screenshots
window.__h.advance = (sec, reset) => { if (reset) t = 0; for (let i = 0; i < sec * 30; i++) { t += 1 / 30; cur.update(1 / 30, t); } };
