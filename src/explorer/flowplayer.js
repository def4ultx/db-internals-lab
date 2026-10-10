// Flow player: animates a flow's steps as packets along edges, with payload callouts and a step log.
import * as THREE from 'three';
import { flows, flowById, edgeById, compById } from '../data/index.js';
import { EDGE_KINDS } from '../shared/layers.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const STEP_SECONDS = 1.9;

export class FlowPlayer {
  constructor({ overview, panelEl, barEl, calloutLayer, camera, canvas, onFrame, onChange, onEdge }) {
    Object.assign(this, { overview, panelEl, barEl, calloutLayer, camera, canvas, onFrame, onChange, onEdge });
    this.flow = null; this.groups = []; this.s = 0; this.playing = false; this.speed = 1; this.loop = false;
    this.meshes = []; this.callouts = []; this.geo = new THREE.SphereGeometry(0.2, 12, 8); this.trailGeo = null; this.mats = new Map();
    this.root = new THREE.Group(); overview.group.add(this.root);
    this._renderPanel(); this._renderBar();
  }

  get active() { return !!this.flow; }

  load(id, { autoplay = false } = {}) {
    this.clear(true);
    const flow = flowById[id]; if (!flow) { this._renderPanel(); return; }
    this.flow = flow; this.s = 0;
    const steps = flow.steps.map((st, i) => ({ st, i, eo: this.overview.edgeObjs.get(st.edge) || this._resolve(st.edge) })).filter((x) => x.eo);
    const map = new Map(); let order = [];
    steps.forEach((x) => { const key = x.st.at ?? `__${x.i}`; if (!map.has(key)) { map.set(key, []); order.push(key); } map.get(key).push(x); });
    // groups sorted by `at` when numeric, else by order of first appearance
    if (order.every((k) => typeof k === 'number')) order.sort((a, b) => a - b);
    this.groups = order.map((k) => map.get(k));
    this.skipped = flow.steps.length - steps.length;
    const nodes = new Set(), edgesSet = new Set();
    steps.forEach((x) => { nodes.add(x.eo.edge.from); nodes.add(x.eo.edge.to); edgesSet.add(x.eo.edge.id); });
    this.nodes = nodes; this.edgesSet = edgesSet;
    this.overview.setHighlight(nodes, edgesSet); this.overview.ambientOn = false;
    this.stepObjs = steps;
    steps.forEach((x) => {
      const col = new THREE.Color(EDGE_KINDS[x.eo.edge.kind] || '#fff');
      let m = this.mats.get(col.getHex()); if (!m) { m = new THREE.MeshBasicMaterial({ color: col.clone().lerp(new THREE.Color('#fff'), 0.4) }); this.mats.set(col.getHex(), m); }
      const mesh = new THREE.Mesh(this.geo, m); mesh.visible = false; this.root.add(mesh); x.mesh = mesh;
      const el = document.createElement('div'); el.className = 'callout'; el.style.display = 'none'; el.style.borderColor = '#' + col.getHexString();
      el.innerHTML = `<b>${esc(x.st.label)}</b><span>${esc(String(x.st.payload ?? '').slice(0, 90))}</span>`;
      this.calloutLayer.append(el); x.el = el;
    });
    this._renderPanel(); this._renderBar(); this.apply();
    this.onChange?.(id);
    this.onFrame?.([...nodes].map((n) => this.overview.pos[n]));
    if (autoplay) this.play();
  }

  _resolve(id) { // tolerate ids like "a>b" not matching exactly
    const [a, b] = String(id).split('>'); if (!a || !b) return null;
    return [...this.overview.edgeObjs.values()].find((x) => x.edge.from === a && x.edge.to === b) || null;
  }

  clear(keepUI) {
    this.playing = false;
    this.stepObjs?.forEach((x) => { x.mesh?.removeFromParent(); x.el?.remove(); });
    this.stepObjs = []; this.groups = [];
    this.overview.setHighlight(null, null); this.overview.activeEdges = new Set(); this.overview.ambientOn = true;
    if (!keepUI) { this.flow = null; this._renderPanel(); this._renderBar(); this.onChange?.(null); }
  }

  play() { if (!this.flow) return; if (this.s >= this.groups.length) this.s = 0; this.playing = true; this._syncBar(); }
  pause() { this.playing = false; this._syncBar(); }
  toggle() { this.playing ? this.pause() : this.play(); }
  stepBy(d) {
    if (!this.flow) return; this.playing = false; const G = this.groups.length; const cur = this.s > 0 ? Math.min(G - 1, Math.floor(this.s)) : -1;
    if (d > 0) this.s = Math.min(G - 1, cur + 1) + 0.55; else this.s = cur - 1 < 0 ? 0 : cur - 1 + 0.55;
    this.apply(); this._syncBar(); this._syncLog();
  }
  seek(s) { this.s = Math.max(0, Math.min(this.groups.length, s)); this.apply(); this._syncBar(); this._syncLog(); }

  update(dt) {
    if (!this.flow) return;
    if (this.playing) {
      this.s += dt * this.speed / STEP_SECONDS;
      if (this.s >= this.groups.length) { if (this.loop) this.s = 0; else { this.s = this.groups.length; this.playing = false; } }
      this.apply(); this._syncBar(); this._syncLog();
    }
    this._positionCallouts();
  }

  apply() {
    const active = new Set(); this._activeSteps = [];
    this.groups.forEach((g, k) => g.forEach((x) => {
      const p = this.s - k; const e = x.eo;
      if (p > 0 && p < 1) { active.add(e.edge.id); x.mesh.visible = true; x.mesh.position.copy(e.curve.getPoint(p)); x.mesh.scale.setScalar(1 + 0.3 * Math.sin(p * Math.PI)); this._activeSteps.push(x); }
      else if (p >= 1 && p < 1.35) { x.mesh.visible = true; x.mesh.position.copy(e.curve.getPoint(1)); x.mesh.scale.setScalar(Math.max(0.01, 1 - (p - 1) / 0.35)); this._activeSteps.push(x); }
      else x.mesh.visible = false;
    }));
    this.overview.activeEdges = active;
  }

  _positionCallouts() {
    const rect = this.canvas.getBoundingClientRect(); const v = new THREE.Vector3();
    const show = new Set(this._activeSteps || []);
    // when paused at a boundary, show the most recent group's callouts
    if (!show.size && this.groups.length && this.s > 0) { const k = Math.min(this.groups.length - 1, Math.ceil(this.s) - 1); this.groups[k]?.forEach((x) => show.add(x)); }
    let off = 0;
    this.stepObjs.forEach((x) => {
      if (!show.has(x)) { x.el.style.display = 'none'; return; }
      v.copy(x.mesh.visible ? x.mesh.position : x.eo.curve.getPoint(1)); v.project(this.camera);
      if (v.z > 1) { x.el.style.display = 'none'; return; }
      x.el.style.display = 'block'; x.el.style.transform = `translate(${(v.x * 0.5 + 0.5) * rect.width + 12}px, ${(-v.y * 0.5 + 0.5) * rect.height - 34 - off * 38}px)`; off++;
    });
  }

  // ---- UI ----
  _renderPanel() {
    const el = this.panelEl; const f = this.flow;
    el.innerHTML = `<div class="sec"><div class="sech">Data-flow scenario</div>
      <select class="flowsel"><option value="">— choose a flow —</option>${flows.map((x) => `<option value="${x.id}" ${f?.id === x.id ? 'selected' : ''}>[${esc(x.workload)}] ${esc(x.title)}</option>`).join('')}</select>
      ${f ? `<div class="flowdesc">${f.sql ? `<pre class="sql">${esc(f.sql)}</pre>` : ''}<p>${esc(f.description)}</p>${this.skipped ? `<p class="dimtxt">${this.skipped} step(s) reference edges missing from the data and were skipped.</p>` : ''}</div>` : '<p class="dimtxt">Pick a scenario to watch packets travel the edges between components, with the payload at each hop.</p>'}</div>
      ${f ? `<div class="sec"><div class="sech">Step log — how data is passed</div><ol class="steplog">${this.groups.map((g, k) => g.map((x) => { const ed = x.eo.edge; return `<li data-k="${k}" data-i="${x.i}"><div class="sh"><span class="n">${k + 1}</span><b>${esc(x.st.label)}</b><span class="kind" style="color:${EDGE_KINDS[ed.kind]}">${esc(ed.kind)}</span></div><div class="route">${esc(compById[ed.from]?.name || ed.from)} → ${esc(compById[ed.to]?.name || ed.to)}</div><div class="more"><code>${esc(ed.iface?.signature || '')}</code>${x.st.payload ? `<pre>${esc(x.st.payload)}</pre>` : ''}${x.st.note ? `<div class="note">${esc(x.st.note)}</div>` : ''}</div></li>`; }).join('')).join('')}</ol></div>` : ''}`;
    el.querySelector('.flowsel').onchange = (e) => (e.target.value ? this.load(e.target.value) : this.clear());
    el.querySelectorAll('.steplog li').forEach((li) => (li.onclick = () => { const k = +li.dataset.k; this.playing = false; this.seek(k + 0.5); this.onEdge?.(this.groups[k]?.find((x) => String(x.i) === li.dataset.i)?.eo.edge.id); }));
    this._syncLog();
  }

  _syncLog() {
    if (!this.flow) return; const G = this.groups.length; const k0 = this.s > 0 && this.s < G ? Math.floor(this.s) : -1;
    this.panelEl.querySelectorAll('.steplog li').forEach((li) => { const k = +li.dataset.k; li.classList.toggle('done', this.s >= k + 1); li.classList.toggle('active', k === k0); });
    const a = this.panelEl.querySelector('.steplog li.active'); if (a && a !== this._lastA) { this._lastA = a; a.scrollIntoView({ block: 'nearest' }); }
  }

  _renderBar() {
    const b = this.barEl; b.style.display = this.flow ? 'flex' : 'none'; if (!this.flow) { b.innerHTML = ''; return; }
    b.innerHTML = `<button class="btn sm" data-a="prev" title="Previous step (←)">⏮</button><button class="btn pri" data-a="play" title="Play/pause (space)">▶</button><button class="btn sm" data-a="next" title="Next step (→)">⏭</button>
      <input type="range" min="0" max="${this.groups.length * 100}" value="0" class="scrub"><span class="pos"></span>
      <select class="spd"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option></select>
      <label class="tog"><input type="checkbox" class="lp"> loop</label><button class="btn sm" data-a="frame" title="Frame flow">⌖</button><button class="btn sm" data-a="close" title="Close flow">✕</button>`;
    const q = (s) => b.querySelector(s);
    q('[data-a=play]').onclick = () => this.toggle(); q('[data-a=prev]').onclick = () => this.stepBy(-1); q('[data-a=next]').onclick = () => this.stepBy(1);
    q('[data-a=close]').onclick = () => this.clear(); q('[data-a=frame]').onclick = () => this.onFrame?.([...this.nodes].map((n) => this.overview.pos[n]));
    q('.scrub').oninput = (e) => { this.playing = false; this.seek(e.target.value / 100); };
    q('.spd').onchange = (e) => (this.speed = +e.target.value); q('.lp').onchange = (e) => (this.loop = e.target.checked);
    this._syncBar();
  }

  _syncBar() {
    const b = this.barEl; if (!this.flow) return;
    b.querySelector('[data-a=play]').textContent = this.playing ? '⏸' : '▶';
    const sc = b.querySelector('.scrub'); if (document.activeElement !== sc) sc.value = this.s * 100;
    const k = Math.min(this.groups.length, Math.floor(this.s) + (this.s < this.groups.length ? 1 : 0));
    b.querySelector('.pos').textContent = `${k}/${this.groups.length}${this.groups[k - 1]?.[0] ? ' · ' + this.groups[k - 1][0].st.label : ''}`;
  }

  dispose() { this.clear(true); this.root.removeFromParent(); this.geo.dispose(); this.mats.forEach((m) => m.dispose()); }
}
