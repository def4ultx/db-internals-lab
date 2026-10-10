import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './explorer.css';
import { components, edges, flows, slots, systems, compById, edgeById, slotById, systemById, optionOf, defaultConfig, dataStatus } from '../data/index.js';
import { LAYERS, layerById, EDGE_KINDS } from '../shared/layers.js';
import { Overview, LAYER_GAP } from './overview.js';
import { InternalsHost } from './internalsHost.js';
import { loadViews, viewRegistry, makeLabelFactory, registryStatus } from './registry.js';
import { Composer, collectEffects } from './composer.js';
import { FlowPlayer } from './flowplayer.js';
import { renderEmpty, renderLayer, renderComponent, renderEdge, esc } from './panel.js';

const $ = (s, r = document) => r.querySelector(s);
const root = document.getElementById('app');
root.innerHTML = `
<div id="stage">
  <div id="viewport">
    <canvas id="gl"></canvas>
    <div id="callouts"></div>
    <div id="fade"></div>
    <div id="loading"><div class="spin"></div><div>Building the architecture…</div></div>
    <div id="topbar">
      <div id="crumbs"></div>
      <div id="searchwrap"><input id="search" class="search" placeholder="Search components, interfaces, design slots…  ( / )" autocomplete="off"><div id="results"></div></div>
      <div id="layerchips"></div>
      <button class="btn sm" id="helpbtn" title="Keyboard shortcuts (?)">?</button>
    </div>
    <div id="icard"><div id="ictitle"></div><div id="ictl"></div><div id="icinfo"></div><div id="icsteps"></div></div>
    <div id="flowbar"></div>
    <div id="legend"><canvas id="minimap" width="360" height="300"></canvas><div id="kinds"></div></div>
    <div id="tip"></div>
    <div id="zoomtools"><button class="btn sm" data-z="in" title="Zoom in">＋</button><button class="btn sm" data-z="out" title="Zoom out">−</button><button class="btn sm" data-z="fit" title="Fit view">fit</button></div>
    <div id="help" style="display:none"><div class="card"><h3>Keyboard shortcuts</h3><table>
      <tr><td><kbd>/</kbd> <kbd>Ctrl</kbd>+<kbd>K</kbd></td><td>Search</td></tr><tr><td><kbd>Esc</kbd></td><td>Zoom out one level / clear selection</td></tr>
      <tr><td><kbd>Enter</kbd></td><td>Dive into selected component</td></tr><tr><td><kbd>R</kbd></td><td>Reset view</td></tr>
      <tr><td><kbd>Space</kbd></td><td>Play / pause flow</td></tr><tr><td><kbd>←</kbd> <kbd>→</kbd></td><td>Step flow (or walkthrough in internals)</td></tr>
      <tr><td><kbd>N</kbd> <kbd>P</kbd></td><td>Next / previous walkthrough step</td></tr><tr><td><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd></td><td>Inspect / Flows / Design tab</td></tr>
      <tr><td><kbd>+</kbd> <kbd>−</kbd> <kbd>0</kbd></td><td>Zoom / fit in internals</td></tr><tr><td><kbd>A</kbd></td><td>Toggle ambient packets</td></tr><tr><td><kbd>B</kbd></td><td>Toggle side panel</td></tr><tr><td><kbd>?</kbd></td><td>This help</td></tr></table>
      <p class="dimtxt">Mouse: drag = orbit · right-drag = pan · wheel = zoom (zoom into a selected node to dive in) · click = select · double-click = open internals.</p><button class="btn" id="helpclose">Close</button></div></div>
  </div>
  <aside id="rpanel">
    <div id="tabs"><button data-tab="inspect" class="on">Inspect</button><button data-tab="flows">Flows</button><button data-tab="design">Design</button><button id="collapse" title="Hide panel (B)">»</button></div>
    <div class="tabbody" id="tab-inspect"></div><div class="tabbody" id="tab-flows" style="display:none"></div><div class="tabbody" id="tab-design" style="display:none"></div>
  </aside>
</div>`;

// ---------- renderer / scene ----------
const viewport = $('#viewport'), canvas = $('#gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
const scene = new THREE.Scene(); scene.background = new THREE.Color('#0b0e17');
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 400);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.09; controls.rotateSpeed = 0.7; controls.zoomSpeed = 0.9; controls.maxPolarAngle = Math.PI * 0.95;
scene.add(new THREE.AmbientLight(0xaab4ff, 0.75), new THREE.HemisphereLight(0xdde6ff, 0x1a1030, 0.55));
const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(14, 30, 24); scene.add(sun);
const rim = new THREE.DirectionalLight(0x7aa2f7, 0.5); rim.position.set(-20, -10, -16); scene.add(rim);

const trackLabel = [];
const makeLabelMain = makeLabelFactory((s) => trackLabel.push(s));
const overview = new Overview({ components, edges, makeLabel: makeLabelMain });
scene.add(overview.group);
const grid = new THREE.GridHelper(80, 40, 0x2a3350, 0x1a2036); grid.position.y = -9; grid.visible = false; grid.material.transparent = true; grid.material.opacity = 0.22; scene.add(grid);

// ---------- state ----------
const config = defaultConfig();
const S = { sel: null, layer: null, mode: 'overview', activeSystem: null, baseSystem: null, tab: 'inspect', panelOpen: true, internalsId: null, viewsReady: false };
let lastHash = '';

const host = new InternalsHost({ scene, getConfig: () => config, setConfig: (slot, opt) => setSlot(slot, opt), ui: { controls: $('#ictl'), steps: $('#icsteps'), info: $('#icinfo'), card: $('#icard') } });
const viewsPromise = loadViews().then(() => { S.viewsReady = true; });

const player = new FlowPlayer({
  overview, panelEl: $('#tab-flows'), barEl: $('#flowbar'), calloutLayer: $('#callouts'), camera, canvas,
  onFrame: (pts) => frame(pts), onChange: () => { refreshHighlight(); writeHash(); }, onEdge: (id) => selectEdge(id, { fly: false }),
});

// ---------- camera tweening ----------
let tween = null;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
function flyTo(pos, target, dur = 0.9, done) {
  if (dur <= 0) { camera.position.copy(pos); controls.target.copy(target); controls.update(); done?.(); return; }
  tween = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos.clone(), t1: target.clone(), t: 0, dur, done };
}
function dirFromCamera() { return camera.position.clone().sub(controls.target).normalize(); }
function flyToPoint(point, dist, dur = 0.9, done) { const d = dirFromCamera(); flyTo(point.clone().addScaledVector(d, dist), point, dur, done); }
function frame(points) {
  if (S.mode !== 'overview' || !points?.length) return;
  const box = new THREE.Box3(); points.forEach((p) => box.expandByPoint(p)); const c = box.getCenter(new THREE.Vector3()); const r = box.getSize(new THREE.Vector3()).length() / 2;
  flyToPoint(c, Math.max(16, r * 2.9 + 8));
}
const HOME = { dir: new THREE.Vector3(0.40, 0.44, 0.80).normalize(), dist: 80 };
function homeView(dur = 1.1, done) { flyTo(overview.center.clone().addScaledVector(HOME.dir, HOME.dist), overview.center, dur, done); }

// ---------- selection ----------
function neighbours(id) {
  const ns = new Set([id]), es = new Set();
  edges.forEach((e) => { if (e.from === id || e.to === id) { ns.add(e.from); ns.add(e.to); es.add(e.id); } });
  (compById[id]?.impacts || []).forEach((i) => compById[i.with] && ns.add(i.with));
  return { ns, es };
}
function refreshHighlight() {
  overview.selected = S.sel?.type === 'comp' ? S.sel.id : null;
  overview.selectedEdge = S.sel?.type === 'edge' ? S.sel.id : null;
  if (player.active) return;
  if (S.sel?.type === 'comp') { const { ns, es } = neighbours(S.sel.id); overview.setHighlight(ns, es); }
  else if (S.sel?.type === 'edge') { const e = edgeById[S.sel.id]; overview.setHighlight(new Set([e.from, e.to]), new Set([e.id])); }
  else if (S.layer) { const ns = new Set(components.filter((c) => c.layer === S.layer).map((c) => c.id)); const es = new Set(edges.filter((e) => ns.has(e.from) && ns.has(e.to)).map((e) => e.id)); overview.setHighlight(ns, es); }
  else overview.setHighlight(null, null);
}
function setTab(t) {
  S.tab = t; document.querySelectorAll('#tabs [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  ['inspect', 'flows', 'design'].forEach((k) => ($('#tab-' + k).style.display = k === t ? '' : 'none'));
  if (t === 'design') composer.refresh();
  if (!S.panelOpen) togglePanel(true);
}
function togglePanel(open) { S.panelOpen = open ?? !S.panelOpen; $('#rpanel').classList.toggle('closed', !S.panelOpen); $('#collapse').textContent = S.panelOpen ? '»' : '«'; setTimeout(resize, 260); }
function effectsHtml(id, kind) {
  const ef = collectEffects(config).filter((x) => x.target === id); if (!ef.length) return '';
  return `<div class="sec cfx"><div class="sech">Effects of your current design choices</div>${ef.map((x) => `<div class="impact"><a data-go="slot:${x.slot.id}">${esc(x.slot.title || x.slot.id)}: ${esc(x.option.label)}</a><div>${esc(x.change)}</div></div>`).join('')}</div>`;
}
function renderInspect() {
  const el = $('#tab-inspect'); const st = el.scrollTop;
  if (S.sel?.type === 'comp') el.innerHTML = renderComponent(compById[S.sel.id], config, S.activeSystem).replace('<div class="sec"><div class="sech">Internals</div>', effectsHtml(S.sel.id) + '<div class="sec"><div class="sech">Internals</div>');
  else if (S.sel?.type === 'edge') el.innerHTML = renderEdge(edgeById[S.sel.id]) + effectsHtml(S.sel.id);
  else if (S.layer) el.innerHTML = renderLayer(S.layer);
  else el.innerHTML = renderEmpty();
  el.scrollTop = st;
}
function selectComponent(id, { fly = true, tab = true, dur } = {}) {
  if (!compById[id]) return;
  if (S.mode === 'internals') exitInternals(true);
  S.sel = { type: 'comp', id }; S.layer = compById[id].layer; refreshHighlight(); renderInspect(); renderCrumbs(); if (tab) setTab('inspect'); writeHash();
  if (fly) flyToPoint(overview.pos[id], 15, dur ?? 0.9);
}
function selectEdge(id, { fly = true } = {}) {
  const e = edgeById[id]; if (!e) return;
  if (S.mode === 'internals') exitInternals(true);
  S.sel = { type: 'edge', id }; S.layer = null; refreshHighlight(); renderInspect(); renderCrumbs(); setTab('inspect'); writeHash();
  if (fly) { const mid = overview.edgeObjs.get(id).curve.getPoint(0.5); flyToPoint(mid, Math.max(14, overview.pos[e.from].distanceTo(overview.pos[e.to]) * 1.2 + 6)); }
}
function selectLayer(id, { fly = true } = {}) {
  S.sel = null; S.layer = id; refreshHighlight(); renderInspect(); renderCrumbs(); setTab('inspect'); writeHash();
  if (fly) flyToPoint(new THREE.Vector3(0, overview.layerY[id], 0), 26);
}
function clearSelection() { S.sel = null; S.layer = null; refreshHighlight(); renderInspect(); renderCrumbs(); writeHash(); }
function resetView() { if (S.mode === 'internals') exitInternals(true); clearSelection(); homeView(); }

// ---------- internals (semantic zoom) ----------
const fadeEl = $('#fade');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let entering = false, savedCam = null;
let userMoved = false;
controls.addEventListener('start', () => { if (S.mode === 'internals') userMoved = true; });
function fitInternals(force) {
  if (!host.inst?.group) return; if (force) userMoved = false; if (userMoved) return;
  host.root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(host.inst.group);
  if (box.isEmpty() || !isFinite(box.min.x)) box.set(new THREE.Vector3(-10, -6, -6), new THREE.Vector3(10, 6, 6));
  const c = box.getCenter(new THREE.Vector3());
  const tilt = THREE.MathUtils.degToRad(9); const dir = new THREE.Vector3(0, Math.sin(tilt), Math.cos(tilt));
  // camera basis looking from c + dir toward c
  const m = new THREE.Matrix4().lookAt(dir, new THREE.Vector3(), new THREE.Vector3(0, 1, 0)); const right = new THREE.Vector3().setFromMatrixColumn(m, 0), up = new THREE.Vector3().setFromMatrixColumn(m, 1);
  const tV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), tH = tV * camera.aspect, margin = 0.92;
  let D = 8; const p = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    p.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(c);
    const x = Math.abs(p.dot(right)), y = Math.abs(p.dot(up)), z = p.dot(dir); // z toward camera
    D = Math.max(D, z + x / (tH * margin), z + y / (tV * margin));
  }
  D = Math.min(D, 100);
  controls.target.copy(c); camera.position.copy(c).addScaledVector(dir, D); controls.update();
}
let refitTimers = [];
function scheduleRefit() { refitTimers.forEach(clearTimeout); refitTimers = [400, 1200, 2500].map((t) => setTimeout(() => { if (S.mode === 'internals') fitInternals(); }, t)); }
function dolly(f) { if (S.mode !== 'internals') return; userMoved = true; const o = camera.position.clone().sub(controls.target).multiplyScalar(f); camera.position.copy(controls.target).add(o); controls.update(); }
$('#zoomtools').addEventListener('click', (e) => { const a = e.target.dataset.z; if (a === 'in') dolly(0.8); else if (a === 'out') dolly(1.25); else if (a === 'fit') fitInternals(true); });
async function enterInternals(id, { instant = false } = {}) {
  if (entering || S.mode === 'internals' || !compById[id]) return; entering = true;
  if (S.sel?.id !== id) { S.sel = { type: 'comp', id }; S.layer = compById[id].layer; refreshHighlight(); renderInspect(); }
  player.pause(); await viewsPromise;
  const fromCam = { pos: camera.position.clone(), target: controls.target.clone() };
  if (!instant) { await new Promise((r) => flyToPoint(overview.pos[id], 3.6, 0.55, r)); }
  fadeEl.style.opacity = 1; await wait(instant ? 0 : 230);
  savedCam = { pos: fromCam.pos, target: overview.pos[id].clone().addScaledVector(HOME.dir, 9) };
  S.mode = 'internals'; S.internalsId = id; viewport.classList.add('int'); resize(); overview.group.visible = false; $('#callouts').style.visibility = 'hidden'; grid.visible = true;
  host.enter(compById[id]);
  controls.minDistance = 3; controls.maxDistance = 140;
  userMoved = false; fitInternals(true); scheduleRefit();
  const ic = $('#ictitle'); ic.innerHTML = `<span style="color:${layerById[compById[id].layer].color}">●</span> ${esc(compById[id].name)} <small>internals</small>`;
  renderCrumbs(); writeHash(); fadeEl.style.opacity = 0; entering = false;
}
async function exitInternals(quick) {
  if (S.mode !== 'internals' || entering) return; entering = true;
  fadeEl.style.opacity = 1; await wait(quick ? 0 : 200);
  refitTimers.forEach(clearTimeout); host.exit(); viewport.classList.remove('int'); resize(); grid.visible = false; overview.group.visible = true; $('#callouts').style.visibility = '';
  S.mode = 'overview'; S.internalsId = null; controls.minDistance = 2.4; controls.maxDistance = 140;
  const id = S.sel?.id; const pos = id && overview.pos[id] ? overview.pos[id] : overview.center;
  camera.position.copy(pos.clone().addScaledVector(HOME.dir, 7)); controls.target.copy(pos); controls.update();
  lastZoomOutAt = performance.now();
  renderCrumbs(); writeHash(); fadeEl.style.opacity = 0; entering = false;
}
let lastZoomOutAt = 0, lastWheel = 0;
canvas.addEventListener('wheel', () => { lastWheel = performance.now(); }, { passive: true });
function checkSemanticZoom() {
  if (tween || entering) return; const now = performance.now();
  if (S.mode === 'internals') { if (now - lastWheel < 400 && camera.position.distanceTo(controls.target) > 120) exitInternals(); return; }
  if (now - lastWheel > 350 || now - lastZoomOutAt < 800) return;
  const d = camera.position.distanceTo(controls.target); if (d > 4.3) return;
  let id = S.sel?.type === 'comp' ? S.sel.id : null; if (id && overview.pos[id].distanceTo(controls.target) > 4) id = null;
  if (!id) { let best = 3.2; overview.nodes.forEach((n, k) => { if (overview.nodeVisible(k)) { const dd = n.group.position.distanceTo(controls.target); if (dd < best) { best = dd; id = k; } } }); }
  if (id) enterInternals(id, { instant: true });
}

// ---------- config / composer ----------
const composer = new Composer($('#tab-design'), {
  getConfig: () => config, setSlot: (s, o) => setSlot(s, o), applyPreset: (id) => applyPreset(id), reset: () => { S.activeSystem = null; S.baseSystem = null; Object.assign(config, defaultConfig()); onConfig(); },
  onFocusComponent: (id) => selectComponent(id),
});
function setSlot(slot, opt) { if (!slotById[slot] || !optionOf(slot, opt)) return; S.activeSystem = null; config[slot] = opt; onConfig(); }
function applyPreset(id) { const sys = systemById[id]; if (!sys) return; Object.assign(config, defaultConfig()); for (const [k, v] of Object.entries(sys.choices || {})) if (slotById[k] && optionOf(k, v)) config[k] = v; S.activeSystem = id; S.baseSystem = id; onConfig(); }
function onConfig() {
  const badges = new Map(), dims = new Map();
  const put = (id, text) => { if (compById[id] && !badges.has(id)) badges.set(id, text); };
  for (const s of slots) {
    const o = optionOf(s.id, config[s.id]); if (!o) continue; const isDef = o.id === s.default; const show = !isDef || S.activeSystem;
    if (/^none/.test(o.id) && s.component) { dims.set(s.component, 0.32); put(s.component, 'off'); continue; }
    if (show) {
      put(s.component, o.label.length > 18 ? o.label.slice(0, 17) + '…' : o.label);
      if (!isDef) (o.effects || []).forEach((x) => compById[x.target] && put(x.target, '⚙ ' + (o.label.length > 14 ? o.label.slice(0, 13) + '…' : o.label)));
    }
  }
  overview.setBadges(badges); overview.setNodeDim(dims);
  host.onConfigChange(config); composer.activeSystem = S.activeSystem; composer.refresh(); if (S.tab === 'inspect') renderInspect(); writeHash();
}

// ---------- URL hash ----------
function writeHash() {
  const base = S.baseSystem ? { ...defaultConfig(), ...systemById[S.baseSystem]?.choices } : defaultConfig();
  const cfg = Object.entries(config).filter(([k, v]) => base[k] !== v).map(([k, v]) => `${k}:${v}`).join(',');
  const p = new URLSearchParams();
  if (S.sel?.type === 'comp') p.set('c', S.sel.id); else if (S.sel?.type === 'edge') p.set('e', S.sel.id); else if (S.layer) p.set('l', S.layer);
  if (S.mode === 'internals') p.set('v', 'internals');
  if (S.baseSystem) p.set('system', S.baseSystem); if (cfg) p.set('cfg', cfg); if (player.flow) p.set('flow', player.flow.id);
  const h = p.toString(); lastHash = h; const url = location.pathname + location.search + (h ? '#' + h : '');
  try { history.replaceState(null, '', url); } catch {}
}
async function applyHash(initial) {
  const p = new URLSearchParams(location.hash.replace(/^#/, '')); lastHash = p.toString();
  const sys = p.get('system'); const cfg = p.get('cfg');
  if (sys && systemById[sys]) applyPreset(sys); else if (!sys && (cfg || !initial)) { S.activeSystem = null; S.baseSystem = null; Object.assign(config, defaultConfig()); }
  if (cfg) cfg.split(',').forEach((kv) => { const [k, v] = kv.split(':'); if (slotById[k] && optionOf(k, v)) config[k] = v; });
  onConfig();
  const flow = p.get('flow'); if (flow && flows.find((f) => f.id === flow)) player.load(flow); else if (!initial && player.flow) player.clear();
  const c = p.get('c'), e = p.get('e'), l = p.get('l');
  if (c && compById[c]) { selectComponent(c, { dur: initial ? 0 : 0.9 }); if (p.get('v') === 'internals') { await enterInternals(c, { instant: true }); } }
  else if (e && edgeById[e]) selectEdge(e, { fly: !initial }); else if (l && layerById[l]) selectLayer(l, { fly: !initial });
  if (initial && !(c || e || l)) homeView(0);
  if (initial && (e || l)) { const pt = e ? overview.edgeObjs.get(e).curve.getPoint(0.5) : new THREE.Vector3(0, overview.layerY[l], 0); flyToPoint(pt, e ? 18 : 26, 0); }
}
window.addEventListener('hashchange', () => { if (new URLSearchParams(location.hash.slice(1)).toString() !== lastHash) applyHash(false); });

// ---------- breadcrumbs ----------
function renderCrumbs() {
  const parts = [`<a data-b="sys">System</a>`]; const lid = S.sel?.type === 'comp' ? compById[S.sel.id].layer : S.layer;
  if (lid) parts.push(`<a data-b="layer" style="color:${layerById[lid].color}">${esc(layerById[lid].name)}</a>`);
  if (S.sel?.type === 'comp') parts.push(`<a data-b="comp">${esc(compById[S.sel.id].name)}</a>`);
  if (S.sel?.type === 'edge') parts.push(`<span>${esc(S.sel.id)}</span>`);
  if (S.mode === 'internals') parts.push('<span class="cur">Internals</span>');
  $('#crumbs').innerHTML = parts.join('<i>›</i>') + (S.mode !== 'overview' || S.sel || S.layer ? '<button class="btn sm" id="backbtn">⟵ Back</button>' : '');
}
$('#crumbs').addEventListener('click', (e) => {
  if (e.target.id === 'backbtn') return goBack();
  const b = e.target.dataset.b; if (!b) return;
  if (b === 'sys') resetView(); else if (b === 'layer') { const lid = S.sel?.type === 'comp' ? compById[S.sel.id].layer : S.layer; if (S.mode === 'internals') exitInternals(true); selectLayer(lid); } else if (b === 'comp') { const id = S.sel.id; if (S.mode === 'internals') exitInternals(true).then?.(() => {}); selectComponent(id); }
});
function goBack() {
  if (S.mode === 'internals') exitInternals(); else if (S.sel) { const l = S.sel.type === 'comp' ? compById[S.sel.id].layer : null; if (l) selectLayer(l); else resetView(); } else if (S.layer) resetView();
}

// ---------- layer chips, legend ----------
$('#layerchips').innerHTML = LAYERS.map((l) => `<label class="lchip" style="--lc:${l.color}" title="Toggle ${esc(l.name)}"><input type="checkbox" checked data-layer="${l.id}"><i></i>${esc(l.name.split(' ')[0])}</label>`).join('');
$('#layerchips').addEventListener('change', (e) => { const id = e.target.dataset.layer; if (id) overview.setLayerHidden(id, !e.target.checked); });
$('#kinds').innerHTML = Object.entries(EDGE_KINDS).map(([k, c]) => `<span><i style="background:${c}"></i>${k}</span>`).join('') + '<span class="dimtxt">● packets show data movement</span>';
const mm = $('#minimap'), mg = mm.getContext('2d'); let mmTick = 0;
function minimapPt(id) { const p = overview.pos[id]; return [(p.x / (overview.W / 2 + 1) * 0.5 + 0.5) * (mm.width - 24) + 12, (-p.y / (LAYER_GAP * (LAYERS.length - 1) + 1.2)) * (mm.height - 48) + 24]; }
function drawMinimap() {
  mg.clearRect(0, 0, mm.width, mm.height);
  LAYERS.forEach((l) => { const y = (-overview.layerY[l.id] / (LAYER_GAP * (LAYERS.length - 1) + 1.2)) * (mm.height - 48) + 24; mg.fillStyle = l.color + (overview.hiddenLayers.has(l.id) ? '11' : '26'); mg.fillRect(6, y - 14, mm.width - 12, 28); });
  overview.nodes.forEach((n, id) => { const [x, y] = minimapPt(id); const sel = S.sel?.id === id; mg.beginPath(); mg.arc(x, y, sel ? 7 : 4.2, 0, 7); mg.fillStyle = overview.hiddenLayers.has(n.comp.layer) ? '#333' : '#' + n.color.getHexString(); mg.globalAlpha = player.nodes && !player.nodes.has(id) ? 0.25 : 1; mg.fill(); mg.globalAlpha = 1; if (sel) { mg.strokeStyle = '#fff'; mg.lineWidth = 2; mg.stroke(); } });
  if (S.mode === 'overview') { const t = controls.target; const x = (t.x / (overview.W / 2 + 1) * 0.5 + 0.5) * (mm.width - 24) + 12, y = (-t.y / (LAYER_GAP * (LAYERS.length - 1) + 1.2)) * (mm.height - 48) + 24; mg.strokeStyle = '#ffffff99'; mg.lineWidth = 1.5; mg.strokeRect(x - 14, y - 10, 28, 20); }
}
mm.addEventListener('click', (e) => { const r = mm.getBoundingClientRect(); const x = (e.clientX - r.left) * mm.width / r.width, y = (e.clientY - r.top) * mm.height / r.height; let best = 16, id = null; overview.nodes.forEach((n, k) => { const [px, py] = minimapPt(k); const d = Math.hypot(px - x, py - y); if (d < best) { best = d; id = k; } }); if (id) selectComponent(id); });

// ---------- panel events ----------
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-go]'); if (!t) return; e.preventDefault(); const [k, ...r] = t.dataset.go.split(':'); const id = r.join(':');
  if (k === 'comp') selectComponent(id); else if (k === 'edge') selectEdge(id); else if (k === 'layer') selectLayer(id);
  else if (k === 'enter') enterInternals(id); else if (k === 'connect') { const { ns } = neighbours(id); frame([...ns].map((n) => overview.pos[n])); }
  else if (k === 'flow') { setTab('flows'); player.load(id, { autoplay: true }); }
  else if (k === 'slot') { setTab('design'); composer.open.add(id); composer.filter = ''; composer.refresh(); setTimeout(() => $(`#tab-design details[data-slot="${id}"]`)?.scrollIntoView({ block: 'center' }), 30); }
});
$('#tabs').addEventListener('click', (e) => { const t = e.target.dataset.tab; if (t) setTab(t); });
$('#collapse').onclick = () => togglePanel();
$('#helpbtn').onclick = () => ($('#help').style.display = 'flex'); $('#helpclose').onclick = () => ($('#help').style.display = 'none');

// ---------- search ----------
const searchIndex = [
  ...components.map((c) => ({ kind: 'component', id: c.id, name: c.name, sub: layerById[c.layer].name, text: `${c.name} ${c.id} ${c.responsibility || ''}`.toLowerCase(), color: layerById[c.layer].color })),
  ...edges.map((e) => ({ kind: 'interface', id: e.id, name: `${compById[e.from].name} → ${compById[e.to].name}`, sub: e.label || e.kind, text: `${e.id} ${e.label || ''} ${e.iface?.signature || ''}`.toLowerCase(), color: EDGE_KINDS[e.kind] })),
  ...slots.map((s) => ({ kind: 'design', id: s.id, name: s.title || s.id, sub: 'design slot', text: `${s.id} ${s.title || ''} ${s.options.map((o) => o.label).join(' ')}`.toLowerCase(), color: '#bb9af7' })),
  ...systems.map((s) => ({ kind: 'system', id: s.id, name: s.name || s.id, sub: 'preset', text: `${s.id} ${s.name || ''}`.toLowerCase(), color: '#e0af68' })),
];
const sIn = $('#search'), sRes = $('#results'); let sSel = 0, sList = [];
function doSearch() {
  const q = sIn.value.trim().toLowerCase(); if (!q) { sRes.style.display = 'none'; sList = []; overview.setHighlight(null, null); refreshHighlight(); return; }
  sList = searchIndex.map((x) => ({ x, sc: x.name.toLowerCase().startsWith(q) ? 0 : x.name.toLowerCase().includes(q) || x.id.includes(q) ? 1 : x.text.includes(q) ? 2 : 9 })).filter((r) => r.sc < 9).sort((a, b) => a.sc - b.sc).slice(0, 9).map((r) => r.x);
  sSel = 0; sRes.style.display = sList.length ? 'block' : 'none';
  sRes.innerHTML = sList.map((x, i) => `<div class="res ${i === 0 ? 'on' : ''}" data-i="${i}"><i style="background:${x.color}"></i><b>${esc(x.name)}</b><span>${esc(x.kind)} · ${esc(x.sub)}</span></div>`).join('');
  if (!player.active) overview.setHighlight(new Set(sList.filter((x) => x.kind === 'component').map((x) => x.id)), new Set());
}
function pickResult(x) {
  sIn.value = ''; sRes.style.display = 'none'; sIn.blur(); refreshHighlight();
  if (x.kind === 'component') selectComponent(x.id); else if (x.kind === 'interface') selectEdge(x.id);
  else if (x.kind === 'design') { setTab('design'); composer.open.add(x.id); composer.filter = ''; composer.refresh(); setTimeout(() => $(`#tab-design details[data-slot="${x.id}"]`)?.scrollIntoView({ block: 'center' }), 30); }
  else if (x.kind === 'system') { applyPreset(x.id); setTab('design'); }
}
sIn.addEventListener('input', doSearch);
sIn.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sSel = (sSel + (e.key === 'ArrowDown' ? 1 : -1) + sList.length) % Math.max(1, sList.length); sRes.querySelectorAll('.res').forEach((r, i) => r.classList.toggle('on', i === sSel)); }
  else if (e.key === 'Enter' && sList[sSel]) pickResult(sList[sSel]); else if (e.key === 'Escape') { sIn.value = ''; doSearch(); sIn.blur(); }
});
sRes.addEventListener('mousedown', (e) => { const r = e.target.closest('.res'); if (r) pickResult(sList[+r.dataset.i]); });
sIn.addEventListener('blur', () => setTimeout(() => (sRes.style.display = 'none'), 150));

// ---------- picking / tooltips ----------
const ray = new THREE.Raycaster(); const mouse = new THREE.Vector2(); const tip = $('#tip'); let pend = null, downAt = null;
function pickAt(ev) { const r = canvas.getBoundingClientRect(); mouse.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(mouse, camera); return overview.pick(ray); }
canvas.addEventListener('pointermove', (ev) => {
  if (S.mode !== 'overview' || ev.buttons) { tip.style.display = 'none'; return; }
  if (pend) return; pend = requestAnimationFrame(() => {
    pend = null; const h = pickAt(ev); overview.hover = h?.type === 'node' ? h.id : null; overview.hoverEdge = h?.type === 'edge' ? h.id : null;
    canvas.style.cursor = h ? 'pointer' : 'grab';
    if (!h) { tip.style.display = 'none'; return; }
    let html = '';
    if (h.type === 'node') { const c = compById[h.id]; html = `<b>${esc(c.name)}</b><em>${esc(layerById[c.layer].name)}</em><div>${esc(c.responsibility || c.summary || '')}</div><small>click: inspect · double-click: dive in</small>`; }
    else if (h.type === 'edge') { const e = edgeById[h.id]; html = `<b>${esc(e.label || e.id)}</b><em>${esc(compById[e.from].name)} → ${esc(compById[e.to].name)} · ${esc(e.kind)}</em><code>${esc(e.iface?.signature || '')}</code><small>click: show interface</small>`; }
    else html = `<b>${esc(layerById[h.id].name)}</b><small>click: focus layer</small>`;
    tip.innerHTML = html; tip.style.display = 'block'; const r = viewport.getBoundingClientRect();
    tip.style.left = Math.min(ev.clientX - r.left + 16, r.width - 300) + 'px'; tip.style.top = Math.min(ev.clientY - r.top + 16, r.height - 120) + 'px';
  });
});
canvas.addEventListener('pointerleave', () => { tip.style.display = 'none'; overview.hover = null; overview.hoverEdge = null; });
canvas.addEventListener('pointerdown', (ev) => { downAt = { x: ev.clientX, y: ev.clientY, t: performance.now() }; tip.style.display = 'none'; tween = null; controls.enabled = true; });
canvas.addEventListener('pointerup', (ev) => {
  if (!downAt || S.mode !== 'overview') return; const moved = Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y); downAt = null; if (moved > 5 || ev.button !== 0) return;
  const h = pickAt(ev); if (!h) { if (S.sel || S.layer) clearSelection(); return; }
  if (h.type === 'node') selectComponent(h.id); else if (h.type === 'edge') selectEdge(h.id); else selectLayer(h.id);
});
canvas.addEventListener('dblclick', (ev) => { if (S.mode !== 'overview') return; const h = pickAt(ev); if (h?.type === 'node') enterInternals(h.id); });

// ---------- keyboard ----------
window.addEventListener('keydown', (e) => {
  const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName) && document.activeElement.type !== 'range' && document.activeElement.type !== 'checkbox';
  if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) { e.preventDefault(); sIn.focus(); sIn.select(); return; }
  if (typing) return;
  if (e.key === 'Escape') { if ($('#help').style.display !== 'none') $('#help').style.display = 'none'; else goBack(); }
  else if (e.key === '?') $('#help').style.display = 'flex';
  else if (e.key === 'Enter' && S.sel?.type === 'comp') enterInternals(S.sel.id);
  else if (e.key === '+' || e.key === '=') dolly(0.8); else if (e.key === '-') dolly(1.25); else if (e.key === '0') fitInternals(true);
  else if (e.key === 'r') resetView(); else if (e.key === 'a') overview.ambientOn = !overview.ambientOn && !player.active; else if (e.key === 'b') togglePanel();
  else if (e.key === '1') setTab('inspect'); else if (e.key === '2') setTab('flows'); else if (e.key === '3') setTab('design');
  else if (e.key === ' ' && player.active) { e.preventDefault(); player.toggle(); }
  else if (e.key === 'ArrowRight') { if (player.active && S.mode === 'overview') player.stepBy(1); else if (S.mode === 'internals') host.step(1); }
  else if (e.key === 'ArrowLeft') { if (player.active && S.mode === 'overview') player.stepBy(-1); else if (S.mode === 'internals') host.step(-1); }
  else if (e.key === 'n') host.step(1); else if (e.key === 'p') host.step(-1);
});

// ---------- loop ----------
function resize() { const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
new ResizeObserver(resize).observe(viewport); window.addEventListener('resize', resize);
let last = performance.now(), elapsed = 0, raf = 0; const clockDelta = () => { const n = performance.now(), d = (n - last) / 1000; last = n; return d; };
function loop() {
  raf = requestAnimationFrame(loop); if (document.hidden) { clockDelta(); return; }
  const dt = Math.min(clockDelta(), 0.05); elapsed += dt;
  if (tween) { tween.t += dt / tween.dur; const k = ease(Math.min(1, tween.t)); camera.position.lerpVectors(tween.p0, tween.p1, k); controls.target.lerpVectors(tween.t0, tween.t1, k); if (tween.t >= 1) { const d = tween.done; tween = null; d?.(); } }
  controls.update();
  if (S.mode === 'overview') { overview.update(dt, elapsed); player.update(dt); } else host.update(dt);
  if (S.mode === 'overview' && (mmTick += dt) > 0.12) { mmTick = 0; drawMinimap(); }
  checkSemanticZoom();
  renderer.render(scene, camera);
}
function disposeAll() { cancelAnimationFrame(raf); player.dispose(); host.dispose(); overview.dispose(); trackLabel.forEach((s) => s.userData.dispose?.()); controls.dispose(); renderer.dispose(); }
window.addEventListener('pagehide', disposeAll);

// ---------- boot ----------
resize(); renderInspect(); renderCrumbs(); homeView(0); applyHash(true).then(() => {
  loop(); requestAnimationFrame(() => { $('#loading').classList.add('gone'); document.body.dataset.ready = '1'; });
}).catch((e) => { console.error(e); loop(); $('#loading').classList.add('gone'); document.body.dataset.ready = '1'; });
window.__ex = { renderer, scene, S, config, overview, host, player, camera, controls, selectComponent, selectEdge, selectLayer, enterInternals, exitInternals, setSlot, applyPreset, setTab, dataStatus, registryStatus, viewRegistry, resetView };
