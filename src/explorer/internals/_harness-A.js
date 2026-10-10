import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
const q = new URLSearchParams(location.search);
const views = {};
for (const f of (q.get('mod') ? q.get('mod').split('+') : ['frontend','planning'])) { try { Object.assign(views, (await import(/* @vite-ignore */ `./${f}.js`)).views); } catch (e) { console.error('import fail', f, e.message); } }
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
function makeLabel(text, { size = 1, color = '#e6ecff', bg = null, weight = 600 } = {}) {
  const dpr = 2, px = 64;
  const cv = document.createElement('canvas'); const g = cv.getContext('2d');
  g.font = `${weight} ${px}px Inter, system-ui, sans-serif`;
  const lines = String(text).split('\n');
  const w = Math.ceil(Math.max(...lines.map((l) => g.measureText(l).width))) + 24;
  const h = Math.ceil(px * 1.25 * lines.length) + 12;
  cv.width = w * dpr / 2; cv.height = h * dpr / 2; g.scale(dpr / 2, dpr / 2);
  g.font = `${weight} ${px}px Inter, system-ui, sans-serif`; g.textBaseline = 'middle'; g.textAlign = 'center';
  if (bg) { g.fillStyle = bg; g.beginPath(); g.roundRect(0, 0, w, h, 14); g.fill(); }
  g.fillStyle = color;
  lines.forEach((l, i) => g.fillText(l, w / 2, 6 + px * 0.625 + i * px * 1.25));
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const s = new THREE.Sprite(mat); const hh = size * lines.length; s.scale.set(hh * (w / h), hh, 1);
  s.userData.dispose = () => { tex.dispose(); mat.dispose(); };
  return s;
}
const info = document.getElementById('info');
const ctx = { config, palette: { client: '#7aa2f7', frontend: '#bb9af7', planning: '#e0af68', execution: '#9ece6a' }, makeLabel, onInfo: h => { info.innerHTML = h; }, addPacket() {} };
const id = q.get('view') || 'lexer';
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
