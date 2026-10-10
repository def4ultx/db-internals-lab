import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
const views = {};
for (const f of ['d-routing']) { try { Object.assign(views, (await import(/* @vite-ignore */ `./${f}.js`)).views); } catch (e) { console.error('import fail', f, e.message); } }
const q = new URLSearchParams(location.search);
const config = {};
(q.get('cfg') || '').split(',').filter(Boolean).forEach(kv => { const [k, v] = kv.split(':'); config[k] = v; });
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(innerWidth, innerHeight);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0b0d14);
const cam = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 500);
cam.position.set(0, 2, 26);
const oc = new OrbitControls(cam, canvas);
scene.add(new THREE.AmbientLight(0xffffff, 1.2));
const dl = new THREE.DirectionalLight(0xffffff, 2.2); dl.position.set(5, 10, 12); scene.add(dl);
function makeLabel(text, o = {}) {
  const size = o.size ?? 0.6, color = o.color ?? '#e6e9f5';
  const lines = String(text).split('\n'); const fs = 48;
  const c = document.createElement('canvas'); const g = c.getContext('2d');
  g.font = `${fs}px ui-monospace, Menlo, monospace`;
  const w = Math.max(...lines.map(l => g.measureText(l).width)) + 16, h = fs * 1.25 * lines.length + 8;
  c.width = Math.ceil(w); c.height = Math.ceil(h);
  g.font = `${fs}px ui-monospace, Menlo, monospace`; g.fillStyle = color; g.textBaseline = 'top';
  if (o.align === 'left') g.textAlign = 'left'; else { g.textAlign = 'center'; }
  lines.forEach((l, i) => g.fillText(l, o.align === 'left' ? 8 : c.width / 2, 4 + i * fs * 1.25));
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: o.depthTest ?? true });
  const s = new THREE.Sprite(m); const hh = size * lines.length * 1.25;
  s.scale.set(hh * c.width / c.height, hh, 1);
  return s;
}
const info = document.getElementById('info');
const ctx = { config, palette: { client: '#7aa2f7', frontend: '#bb9af7', planning: '#e0af68', execution: '#9ece6a', distributed: '#ff9e64', txn: '#f7768e', storage: '#2ac3de' }, makeLabel, onInfo: h => { info.innerHTML = h; }, addPacket() {} };
const id = q.get('view') || 'sharding';
const view = views[id];
if (!view) throw new Error('no view ' + id);
const inst = view.build(ctx);
scene.add(inst.group);
const ui = document.getElementById('ui'); const api = { config, ctx, inst };
(view.controls || []).forEach(c => {
  const wrap = document.createElement('div'); wrap.textContent = c.label + ' ';
  let el;
  if (c.type === 'button') { el = document.createElement('button'); el.textContent = c.label; wrap.textContent = ''; el.onclick = () => c.onChange(true, api); }
  else if (c.type === 'range') { el = document.createElement('input'); el.type = 'range'; el.min = c.min; el.max = c.max; el.step = c.step ?? 1; el.value = c.value; el.oninput = () => c.onChange(+el.value, api); }
  else if (c.type === 'select') { el = document.createElement('select'); c.options.forEach(o => { const op = document.createElement('option'); const v = o.value ?? o.id ?? o; op.value = v; op.textContent = o.label ?? v; el.appendChild(op); }); el.value = c.value ?? ''; el.onchange = () => c.onChange(el.value, api); }
  else { el = document.createElement('input'); el.type = 'checkbox'; el.checked = !!c.value; el.onchange = () => c.onChange(el.checked, api); }
  el.dataset.cid = c.id; wrap.appendChild(el); ui.appendChild(wrap);
});
const st = document.getElementById('steps'); const steps = inst.steps || [];
let si = -1;
function runStep(i) { si = i; const s = steps[i]; if (!s) return; s.run(); st.innerHTML = `<b>${i + 1}/${steps.length} ${s.title}</b><br>${s.text}`; }
steps.forEach((s, i) => { const b = document.createElement('button'); b.textContent = (i + 1) + '. ' + s.title; b.onclick = () => runStep(i); ui.appendChild(b); });
let t = 0, last = performance.now(), paused = false;
function frame(now) { const dt = Math.min(0.05, (now - last) / 1000); last = now; if (!paused) { t += dt; inst.update && inst.update(dt, t); } oc.update(); renderer.render(scene, cam); requestAnimationFrame(frame); }
requestAnimationFrame(frame);
window.__h = {
  api, runStep, steps: steps.length, setConfig(c) { Object.assign(config, c); inst.onConfigChange && inst.onConfigChange(config); },
  control(cid, v) { const c = view.controls.find(x => x.id === cid); c.onChange(v, api); },
  advance(sec) { paused = true; const dt = 1 / 30; for (let s = 0; s < sec; s += dt) { t += dt; inst.update && inst.update(dt, t); } },
  resume() { paused = false; }, cam, oc, ready: true,
};
const errs = []; window.addEventListener('error', e => errs.push(e.message)); window.__errs = errs;
