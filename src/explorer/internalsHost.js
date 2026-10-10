// Hosts a component's internals view: builds it, supplies ctx, renders controls + walkthrough steps.
import * as THREE from 'three';
import { viewRegistry, genericView, makeLabelFactory } from './registry.js';
import { layerById } from '../shared/layers.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class InternalsHost {
  constructor({ scene, getConfig, setConfig, ui }) {
    this.scene = scene; this.getConfig = getConfig; this.setConfig = setConfig; this.ui = ui;
    this.root = new THREE.Group(); this.root.visible = false; scene.add(this.root);
    this.inst = null; this.comp = null; this.packets = []; this.labels = []; this.failed = false;
    this.packetGeo = new THREE.SphereGeometry(0.18, 10, 8); this.packetMats = new Map();
    this.makeLabel = makeLabelFactory((s) => this.labels.push(s));
    this.stepIdx = -1; this.t = 0;
  }

  get active() { return !!this.comp; }

  _ctx() {
    const palette = { ...Object.fromEntries(Object.entries(layerById).map(([k, v]) => [k, v.color])), accent: '#7aa2f7', good: '#9ece6a', warn: '#e0af68', bad: '#f7768e', fg: '#d7def5', dim: '#8a93b5', bg: '#0b0e17', panel: '#171d2e' };
    const host = this;
    return {
      get config() { return host.getConfig(); },
      palette, makeLabel: this.makeLabel,
      onInfo: (html) => { this.ui.info.innerHTML = html; this.ui.info.style.display = html ? 'block' : 'none'; },
      addPacket: (o) => this.addPacket(o), THREE,
    };
  }

  addPacket({ from, to, curve, color = '#7aa2f7', duration = 1, size = 1, parent, onArrive, delay = 0 } = {}) {
    const key = new THREE.Color(color).getHexString();
    let m = this.packetMats.get(key); if (!m) { m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color) }); this.packetMats.set(key, m); }
    const mesh = new THREE.Mesh(this.packetGeo, m); mesh.scale.setScalar(size); mesh.visible = false;
    (parent || this.root).add(mesh);
    const p = { mesh, from: from ? from.clone?.() || new THREE.Vector3(...from) : null, to: to ? to.clone?.() || new THREE.Vector3(...to) : null, curve, dur: Math.max(0.05, duration), t: -delay / Math.max(0.05, duration), onArrive, parent: parent || this.root };
    this.packets.push(p); return p;
  }

  enter(comp) {
    this.exit();
    this.comp = comp; this.failed = false;
    const ctx = this._ctx();
    ctx.onInfo('');
    let def = viewRegistry[comp.id]; let note = '';
    if (!def) { def = genericView(comp); note = 'No dedicated 3D view yet — showing a generic breakdown generated from the component\'s internals list.'; }
    let inst;
    try {
      inst = def.build(ctx);
      if (!inst || !inst.group) throw new Error('build() did not return { group }');
    } catch (err) {
      console.error('[explorer] view build failed for', comp.id, err);
      ctx.onInfo(`<div class="err"><b>View failed to build:</b> ${esc(err.message)}<br><small>Showing generic breakdown instead.</small></div>`);
      def = genericView(comp); note = '';
      try { inst = def.build(ctx); } catch (e2) { inst = { group: new THREE.Group(), steps: [] }; }
    }
    this.def = def; this.inst = inst; this.root.add(inst.group); this.root.visible = true;
    if (note) ctx.onInfo(`<span class="dimtxt">${esc(note)}</span>`);
    this._renderControls(def.controls || []);
    this.steps = inst.steps || []; this.stepIdx = -1; this._renderSteps();
  }

  exit() {
    if (!this.comp) return;
    try { this.inst?.dispose?.(); } catch (e) { console.warn('dispose error', e); }
    this.root.remove(...this.root.children);
    for (const p of this.packets) p.mesh.removeFromParent();
    this.packets.length = 0;
    this.labels.forEach((s) => { try { s.userData.dispose?.(); } catch {} }); this.labels.length = 0;
    this.root.visible = false; this.comp = null; this.inst = null; this.def = null; this.steps = [];
    this.ui.controls.innerHTML = ''; this.ui.steps.innerHTML = ''; this.ui.info.innerHTML = ''; this.ui.info.style.display = 'none';
    this.ui.card.style.display = 'none';
  }

  _api() { return { config: this.getConfig(), getConfig: this.getConfig, setConfig: this.setConfig, info: (h) => { this.ui.info.innerHTML = h; this.ui.info.style.display = h ? 'block' : 'none'; }, addPacket: (o) => this.addPacket(o) }; }

  _renderControls(controls) {
    const el = this.ui.controls; el.innerHTML = '';
    this.ui.card.style.display = 'block';
    for (const c of controls) {
      const row = document.createElement('div'); row.className = 'ctl'; const api = () => this._api();
      const safe = (fn) => (v) => { try { fn(v, api()); } catch (e) { console.error('control error', c.id, e); this.ui.info.innerHTML = `<div class="err">Control "${esc(c.label)}" failed: ${esc(e.message)}</div>`; this.ui.info.style.display = 'block'; } };
      const run = safe((v, a) => c.onChange?.(v, a));
      if (c.type === 'button') { const b = document.createElement('button'); b.className = 'btn'; b.textContent = c.label; b.onclick = () => run(true); row.append(b); }
      else if (c.type === 'range') {
        const lab = document.createElement('label'); const val = document.createElement('span'); val.className = 'v';
        const r = document.createElement('input'); r.type = 'range'; r.min = c.min ?? 0; r.max = c.max ?? 100; r.step = c.step ?? ((c.max - c.min) > 20 ? 1 : 'any'); r.value = c.value ?? c.min ?? 0; val.textContent = r.value;
        lab.textContent = c.label + ' '; lab.append(val); r.oninput = () => { val.textContent = r.value; run(parseFloat(r.value)); }; row.append(lab, r);
      } else if (c.type === 'select') {
        const lab = document.createElement('label'); lab.textContent = c.label; const s = document.createElement('select');
        (c.options || []).forEach((o) => { const op = document.createElement('option'); const v = typeof o === 'object' ? o.value ?? o.id : o; op.value = v; op.textContent = typeof o === 'object' ? o.label ?? v : o; s.append(op); });
        if (c.value != null) s.value = c.value; s.onchange = () => run(s.value); row.append(lab, s);
      } else if (c.type === 'toggle') {
        const lab = document.createElement('label'); lab.className = 'tog'; const i = document.createElement('input'); i.type = 'checkbox'; i.checked = !!c.value; i.onchange = () => run(i.checked); lab.append(i, ' ' + c.label); row.append(lab);
      } else continue;
      el.append(row);
    }
  }

  _renderSteps() {
    const el = this.ui.steps; const n = this.steps.length;
    if (!n) { el.innerHTML = ''; return; }
    const i = this.stepIdx; const s = this.steps[i];
    el.innerHTML = `<div class="stephead">Walkthrough ${i < 0 ? '' : `<span class="dimtxt">${i + 1}/${n}</span>`}</div>` +
      (s ? `<div class="steptitle">${esc(s.title || '')}</div><div class="steptext">${s.text || ''}</div>` : `<div class="steptext dimtxt">${n} guided steps. Press Next to begin.</div>`) +
      `<div class="stepnav"><button class="btn sm" data-a="prev" ${i < 0 ? 'disabled' : ''}>◀ Prev</button><button class="btn sm pri" data-a="next">${i >= n - 1 ? 'Restart ↺' : 'Next ▶'}</button></div>`;
    el.querySelector('[data-a=prev]').onclick = () => this.step(-1);
    el.querySelector('[data-a=next]').onclick = () => this.step(1);
  }

  step(d) {
    if (!this.steps?.length) return;
    let i = this.stepIdx + d; if (i >= this.steps.length) i = 0; if (i < -1) i = -1;
    this.stepIdx = i; this._renderSteps();
    const s = this.steps[i];
    if (s?.run) try { s.run(); } catch (e) { console.error('step error', e); this.ui.info.innerHTML = `<div class="err">Step failed: ${esc(e.message)}</div>`; this.ui.info.style.display = 'block'; }
  }

  onConfigChange(cfg) { try { this.inst?.onConfigChange?.(cfg); } catch (e) { console.error('onConfigChange error', e); } }

  update(dt) {
    if (!this.comp) return;
    this.t += dt;
    if (this.inst?.update && !this.failed) {
      try { this.inst.update(dt, this.t); } catch (e) { this.failed = true; console.error('view update error', e); this.ui.info.innerHTML = `<div class="err"><b>View update error:</b> ${esc(e.message)}<br><small>Animation paused for this view.</small></div>`; this.ui.info.style.display = 'block'; }
    }
    for (let i = this.packets.length - 1; i >= 0; i--) {
      const p = this.packets[i]; p.t += dt / p.dur;
      if (p.t < 0) { p.mesh.visible = false; continue; }
      p.mesh.visible = true;
      if (p.curve) p.mesh.position.copy(p.curve.getPoint(Math.min(p.t, 1))); else if (p.from && p.to) p.mesh.position.lerpVectors(p.from, p.to, Math.min(p.t, 1));
      if (p.t >= 1) { p.mesh.removeFromParent(); this.packets.splice(i, 1); try { p.onArrive?.(); } catch (e) { console.error(e); } }
    }
  }

  dispose() { this.exit(); this.scene.remove(this.root); this.packetGeo.dispose(); this.packetMats.forEach((m) => m.dispose()); }
}
