import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
// ?view=btree&src=storage_btree.js&cfg=index-structure:lsm,buffer-eviction:clock
const q = new URLSearchParams(location.search);
const src = q.get('src') || 'storage.js';
const mod = await import(/* @vite-ignore */ './' + src);
const viewId = q.get('view') || Object.keys(mod.views)[0];
const config = {}; (q.get('cfg') || '').split(',').filter(Boolean).forEach((p) => { const [k, v] = p.split(':'); config[k] = v; });
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(innerWidth, innerHeight);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0b1020);
const cam = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 500); cam.position.set(0, 0, 17);
const oc = new OrbitControls(cam, canvas);
scene.add(new THREE.AmbientLight(0xffffff, 1.4)); const dl = new THREE.DirectionalLight(0xffffff, 2.2); dl.position.set(5, 12, 14); scene.add(dl);
const infoEl = document.getElementById('info');
const ctx = {
  config, palette: { storage: '#2ac3de' },
  makeLabel(text, o = {}) { const c = document.createElement('canvas'); c.width = 512; c.height = 96; const g = c.getContext('2d'); g.font = '44px monospace'; g.fillStyle = o.color || '#c0caf5'; g.textAlign = 'center'; g.fillText(text, 256, 60); const t = new THREE.CanvasTexture(c); const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true })); s.scale.set((o.size || 1) * 5, (o.size || 1) * 1, 1); return s; },
  onInfo(h) { infoEl.innerHTML = h; }, addPacket() {},
};
const v = mod.views[viewId]; if (!v) throw new Error('no view ' + viewId);
const inst = v.build(ctx); scene.add(inst.group);
const ui = document.getElementById('ui'); const api = { info: ctx.onInfo };
ui.innerHTML = `<b>${viewId}</b>`;
const ctl = {};
for (const c of v.controls || []) {
  const d = document.createElement('div'); let el;
  if (c.type === 'button') { el = document.createElement('button'); el.textContent = c.label; el.onclick = () => c.onChange(true, api); }
  else if (c.type === 'select') { el = document.createElement('select'); (c.options || []).forEach((o) => { const op = document.createElement('option'); op.value = o.value ?? o.id ?? o; op.textContent = o.label ?? o; el.appendChild(op); }); el.value = c.value; el.onchange = () => c.onChange(el.value, api); d.append(c.label + ' '); }
  else if (c.type === 'range') { el = document.createElement('input'); el.type = 'range'; el.min = c.min; el.max = c.max; el.step = c.step || 1; el.value = c.value; el.oninput = () => c.onChange(+el.value, api); d.append(c.label + ' '); }
  else { el = document.createElement('input'); el.type = 'checkbox'; el.checked = !!c.value; el.onchange = () => c.onChange(el.checked, api); d.append(c.label + ' '); }
  el.id = 'ctl-' + c.id; d.appendChild(el); ui.appendChild(d); ctl[c.id] = c;
}
(inst.steps || []).forEach((s, i) => { const d = document.createElement('div'); const b = document.createElement('button'); b.id = 'step-' + i; b.textContent = `${i + 1}. ${s.title}`; b.onclick = () => { s.run(); ctx.onInfo(`<b>${s.title}</b><br>${s.text}`); }; d.appendChild(b); ui.appendChild(d); });
window.H = { inst, ctl, config, setConfig(c) { Object.assign(config, c); inst.onConfigChange && inst.onConfigChange(config); }, api };
const clock = new THREE.Clock(); let t = 0;
window.__frames = 0;
window.__step = (dt, n = 1) => { for (let i = 0; i < n; i++) { t += dt; inst.update(dt, t); } };
window.__manual = false;
function loop() { requestAnimationFrame(loop); if (!window.__manual) { const dt = Math.min(clock.getDelta(), 0.1); t += dt; inst.update(dt, t); } oc.update(); renderer.render(scene, cam); window.__frames++; }
loop();
window.addEventListener('error', (e) => console.error('ERR', e.message)); window.__ready = true;
