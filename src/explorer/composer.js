// Design Composer: slots/options UI, live radar, triggered rules, presets, compare.
import { slots, slotById, rules, systems, systemById, optionOf, compById, defaultConfig } from '../data/index.js';
import { layerById } from '../shared/layers.js';

export const METRICS = [['pointRead', 'Point read'], ['rangeScan', 'Range scan'], ['writeThroughput', 'Write tput'], ['analyticScan', 'Analytic scan'], ['spaceEfficiency', 'Space eff.'], ['concurrency', 'Concurrency'], ['simplicity', 'Simplicity']];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function aggregate(config) {
  // Mean of the chosen options' metrics, counting only slots where that metric actually differs between options
  // (otherwise slots that are irrelevant to a metric would drag every axis toward 3).
  const sum = {}, cnt = {};
  for (const s of slots) {
    const o = optionOf(s.id, config[s.id]); if (!o?.metrics) continue;
    for (const [k] of METRICS) {
      const vals = s.options.map((x) => x.metrics?.[k]).filter((v) => typeof v === 'number');
      if (vals.length < 2 || Math.min(...vals) === Math.max(...vals)) continue;
      if (typeof o.metrics[k] === 'number') { sum[k] = (sum[k] || 0) + o.metrics[k]; cnt[k] = (cnt[k] || 0) + 1; }
    }
  }
  return METRICS.map(([k]) => (cnt[k] ? sum[k] / cnt[k] : 3));
}

export function triggeredRules(config) {
  return rules.filter((r) => config[r.when.slot] === r.when.option && config[r.with.slot] === r.with.option);
}

export function configOf(id, current) {
  if (id === 'current') return current;
  const sys = systemById[id]; return { ...defaultConfig(), ...(sys?.choices || {}) };
}

export function collectEffects(config) {
  const out = [];
  for (const s of slots) { const o = optionOf(s.id, config[s.id]); if (!o) continue; for (const e of o.effects || []) out.push({ slot: s, option: o, target: e.target, change: e.change }); }
  return out;
}

function drawRadar(canvas, series) {
  const dpr = Math.min(2, window.devicePixelRatio || 1); const W = canvas.clientWidth || 300, H = canvas.clientHeight || 250;
  canvas.width = W * dpr; canvas.height = H * dpr; const g = canvas.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, W, H);
  const cx = W / 2, cy = H / 2 + 4, R = Math.min(W, H) / 2 - 38, n = METRICS.length;
  const pt = (i, v) => { const a = -Math.PI / 2 + (i / n) * Math.PI * 2; return [cx + Math.cos(a) * R * Math.max(0, v - 1) / 4, cy + Math.sin(a) * R * Math.max(0, v - 1) / 4]; };
  g.strokeStyle = '#2a3350'; g.lineWidth = 1;
  for (let r = 1; r <= 5; r++) { g.beginPath(); for (let i = 0; i < n; i++) { const [x, y] = pt(i, r); i ? g.lineTo(x, y) : g.moveTo(x, y); } g.closePath(); g.stroke(); }
  g.font = '11px Inter, system-ui, sans-serif'; g.fillStyle = '#8a93b5'; g.textAlign = 'center';
  METRICS.forEach(([, label], i) => { g.beginPath(); const [x0, y0] = pt(i, 5); g.moveTo(cx, cy); g.lineTo(x0, y0); g.stroke(); const [x, y] = pt(i, 6.1); g.fillText(label, x, y + 4); });
  series.forEach((s) => {
    g.beginPath(); s.values.forEach((v, i) => { const [x, y] = pt(i, v); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath();
    g.fillStyle = s.color + '33'; g.fill(); g.strokeStyle = s.color; g.lineWidth = 2; g.stroke();
    s.values.forEach((v, i) => { const [x, y] = pt(i, v); g.beginPath(); g.arc(x, y, 2.5, 0, 7); g.fillStyle = s.color; g.fill(); });
  });
}

export class Composer {
  constructor(el, { getConfig, setSlot, applyPreset, reset, onFocusComponent }) {
    this.el = el; Object.assign(this, { getConfig, setSlot, applyPreset, reset, onFocusComponent });
    this.open = new Set(); this.cmpA = 'current'; this.cmpB = ''; this.activeSystem = null; this.filter = '';
    el.addEventListener('click', (e) => this._click(e));
    el.addEventListener('change', (e) => { const t = e.target; if (t.dataset.cmp === 'a') { this.cmpA = t.value; this.renderTop(); } if (t.dataset.cmp === 'b') { this.cmpB = t.value; this.renderTop(); } });
    el.addEventListener('input', (e) => { if (e.target.dataset.role === 'slotfilter') { this.filter = e.target.value.toLowerCase(); this.renderSlots(); } });
    el.addEventListener('toggle', (e) => { const d = e.target; if (d.dataset?.slot) d.open ? this.open.add(d.dataset.slot) : this.open.delete(d.dataset.slot); }, true);
    el.innerHTML = '<div class="cmp-top"></div><div class="cmp-slots"></div>';
    this.top = el.querySelector('.cmp-top'); this.slotsEl = el.querySelector('.cmp-slots');
    this.render();
  }

  _click(e) {
    const t = e.target.closest('[data-act]'); if (!t) return; const a = t.dataset.act;
    if (a === 'opt') { this.activeSystem = null; this.setSlot(t.dataset.slot, t.dataset.opt); }
    else if (a === 'preset') { this.activeSystem = t.dataset.id; this.applyPreset(t.dataset.id); }
    else if (a === 'reset') { this.activeSystem = null; this.reset(); }
    else if (a === 'comp') this.onFocusComponent(t.dataset.id);
  }

  render() { this.renderTop(); this.renderSlots(); }

  refresh() { const st = this.el.scrollTop; this.renderTop(); this.renderSlots(); this.el.scrollTop = st; }

  renderTop() {
    const cfg = this.getConfig();
    const A = configOf(this.cmpA, cfg), B = this.cmpB ? configOf(this.cmpB, cfg) : null;
    const rulesNow = triggeredRules(cfg);
    const sysOpts = (sel, cur) => `${sel}${systems.map((s) => `<option value="${s.id}" ${cur === s.id ? 'selected' : ''}>${esc(s.name || s.id)}</option>`).join('')}`;
    const nameOf = (id) => id === 'current' ? 'Current design' : (systemById[id]?.name || id);
    const diffs = B ? slots.filter((s) => A[s.id] !== B[s.id]) : [];
    this.top.innerHTML = `
      <div class="sec"><div class="sech">Preset as system</div><div class="chips">${systems.map((s) => `<button class="chip ${this.activeSystem === s.id ? 'on' : ''}" data-act="preset" data-id="${s.id}" title="${esc(s.oneLiner || s.category || '')}">${esc(s.name || s.id)}</button>`).join('')}<button class="chip ghost" data-act="reset">Reset defaults</button></div></div>
      <div class="sec"><div class="sech">Aggregate profile <span class="dimtxt">(mean of chosen options)</span></div><canvas class="radar"></canvas>
        <div class="legend2"><span class="sw" style="background:#7aa2f7"></span>${esc(nameOf(this.cmpA))}${B ? `<span class="sw" style="background:#ff9e64;margin-left:12px"></span>${esc(nameOf(this.cmpB))}` : ''}</div></div>
      <div class="sec"><div class="sech">Compare two configs</div><div class="row2">
        <select data-cmp="a">${sysOpts(`<option value="current" ${this.cmpA === 'current' ? 'selected' : ''}>Current design</option>`, this.cmpA)}</select><span class="dimtxt">vs</span>
        <select data-cmp="b">${sysOpts(`<option value="">(none)</option>`, this.cmpB)}</select></div>
        ${B ? (diffs.length ? `<table class="difft"><tr><th>Slot</th><th>${esc(nameOf(this.cmpA))}</th><th>${esc(nameOf(this.cmpB))}</th></tr>${diffs.map((s) => `<tr><td>${esc(s.title || s.id)}</td><td>${esc(optionOf(s.id, A[s.id])?.label || A[s.id])}</td><td>${esc(optionOf(s.id, B[s.id])?.label || B[s.id])}</td></tr>`).join('')}</table>` : '<div class="dimtxt">Identical on every slot.</div>') : ''}</div>
      <div class="sec"><div class="sech">Triggered rules <span class="badge">${rulesNow.length}</span></div>${rulesNow.length ? rulesNow.map((r) => `<div class="rule ${r.type}"><span class="rt">${esc(r.type)}</span> <b>${esc(optionOf(r.when.slot, r.when.option)?.label || r.when.option)}</b> + <b>${esc(optionOf(r.with.slot, r.with.option)?.label || r.with.option)}</b><div class="rn">${esc(r.note)}</div></div>`).join('') : '<div class="dimtxt">No synergy/conflict rules fire for this combination yet. Pick options below.</div>'}</div>
      <div class="sec"><div class="sech">Design slots <span class="badge">${slots.length}</span></div><input class="search sm" data-role="slotfilter" placeholder="Filter slots…" value="${esc(this.filter)}"></div>`;
    const keepFilter = this.top.querySelector('[data-role=slotfilter]');
    const cv = this.top.querySelector('canvas.radar');
    const series = [{ values: aggregate(A), color: '#7aa2f7' }]; if (B) series.push({ values: aggregate(B), color: '#ff9e64' });
    requestAnimationFrame(() => drawRadar(cv, series));
    if (document.activeElement?.dataset?.role === 'slotfilter') keepFilter.focus();
  }

  renderSlots() {
    const cfg = this.getConfig(); const st = this.slotsEl.scrollTop; const f = this.filter;
    const list = slots.filter((s) => !f || `${s.id} ${s.title} ${s.question}`.toLowerCase().includes(f));
    const groups = {}; list.forEach((s) => { const l = compById[s.component]?.layer || 'storage'; (groups[l] ||= []).push(s); });
    this.slotsEl.innerHTML = Object.entries(groups).sort((a, b) => (layerById[a[0]]?.index ?? 9) - (layerById[b[0]]?.index ?? 9)).map(([lid, ss]) => `
      <div class="lgroup" style="--lc:${layerById[lid]?.color}"><div class="lgh">${esc(layerById[lid]?.name)}</div>${ss.map((s) => {
        const cur = optionOf(s.id, cfg[s.id]) || s.options[0]; const isDef = cur.id === s.default;
        return `<details data-slot="${s.id}" ${this.open.has(s.id) ? 'open' : ''}><summary><span class="st">${esc(s.title || s.id)}</span><span class="sv ${isDef ? '' : 'chg'}">${esc(cur.label)}</span></summary>
          <div class="q">${esc(s.question)} ${s.component ? `<a href="#" data-act="comp" data-id="${s.component}" onclick="return false">${esc(compById[s.component]?.name || s.component)} ↗</a>` : ''}</div>
          <div class="opts">${s.options.map((o) => `<button class="opt ${o.id === cur.id ? 'sel' : ''}" data-act="opt" data-slot="${s.id}" data-opt="${o.id}">${esc(o.label)}${o.id === s.default ? '<i>default</i>' : ''}</button>`).join('')}</div>
          <div class="odet"><p>${esc(cur.summary)}</p>
            <div class="pc"><div><b class="good">Pros</b><ul>${(cur.pros || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div><div><b class="bad">Cons</b><ul>${(cur.cons || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div></div>
            ${cur.usedBy?.length ? `<div class="ub"><b>Used by</b> ${cur.usedBy.map((u) => `<span class="tag">${esc(systemById[u]?.name || u)}</span>`).join('')}</div>` : ''}
            ${cur.effects?.length ? `<div class="ef"><b>Effects</b><ul>${cur.effects.map((x) => `<li><a href="#" data-act="comp" data-id="${esc(x.target)}" onclick="return false">${esc(compById[x.target]?.name || x.target)}</a>: ${esc(x.change)}</li>`).join('')}</ul></div>` : ''}
            ${cur.research?.length ? `<div class="rs"><b>Research</b> ${cur.research.map((r) => `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a>`).join(' · ')}</div>` : ''}
            <div class="mini">${METRICS.map(([k, l]) => `<span title="${l}"><i style="width:${(cur.metrics?.[k] || 0) * 20}%"></i><em>${l}</em></span>`).join('')}</div></div></details>`;
      }).join('')}</div>`).join('') || '<div class="dimtxt" style="padding:12px">No slots match.</div>';
    this.slotsEl.scrollTop = st;
  }
}
