// Compare Systems page: matrix + side-by-side deep dive + radar charts (plain SVG, no libs).
import systems, { featureRows } from '/src/data/systems.js';
import slots from '/src/data/designs.js';

const METRICS = [
  ['pointRead', 'Point read'], ['rangeScan', 'Range scan'], ['writeThroughput', 'Write tput'],
  ['analyticScan', 'Analytic scan'], ['spaceEfficiency', 'Space eff.'], ['concurrency', 'Concurrency'], ['simplicity', 'Simplicity']
];
const SERIES = ['#7aa2f7', '#9ece6a', '#e0af68', '#f7768e'];
const MAX_SEL = 4;
const CHIPS = [['all', 'All'], ['oltp', 'OLTP'], ['olap', 'OLAP'], ['nosql', 'NoSQL'], ['embedded', 'Embedded'], ['distributed', 'Distributed']];

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slotById = new Map((Array.isArray(slots) ? slots : []).map(s => [s.id, s]));
const sysById = new Map(systems.map(s => [s.id, s]));

function optOf(slotId, optId) {
  const sl = slotById.get(slotId);
  return sl && sl.options ? sl.options.find(o => o.id === optId) : null;
}
const optLabel = (slotId, optId) => optId ? (optOf(slotId, optId)?.label || optId) : null;

// Rows: all canonical slots (from designs.js), labelled via featureRows when available, plus any slot a system uses.
const rowDefs = [];
const labelByKey = new Map(featureRows.map(r => [r.slot || r.key, r.label]));
const seen = new Set();
for (const r of featureRows) if (r.slot && !seen.has(r.slot)) { seen.add(r.slot); rowDefs.push({ slot: r.slot, label: r.label, title: slotById.get(r.slot)?.question || '' }); }
for (const s of slotById.values()) if (!seen.has(s.id)) { seen.add(s.id); rowDefs.push({ slot: s.id, label: labelByKey.get(s.id) || s.title || s.id, title: s.question || '' }); }

// Colour per option within a slot: stable hue from the option position.
function optColor(slotId, optId, a = 0.22) {
  if (!optId) return 'transparent';
  const sl = slotById.get(slotId);
  let i = sl ? sl.options.findIndex(o => o.id === optId) : -1;
  if (i < 0) i = [...optId].reduce((h, c) => h + c.charCodeAt(0), 0);
  return `hsla(${(i * 137.5 + 210) % 360},55%,55%,${a})`;
}

// Radar values: average of option metrics over the system's choices.
function profile(sys) {
  const acc = Object.fromEntries(METRICS.map(([k]) => [k, []]));
  for (const [slot, opt] of Object.entries(sys.choices)) {
    const m = optOf(slot, opt)?.metrics;
    if (!m) continue;
    for (const [k] of METRICS) if (typeof m[k] === 'number') acc[k].push(m[k]);
  }
  return METRICS.map(([k]) => acc[k].length ? acc[k].reduce((a, b) => a + b, 0) / acc[k].length : 0);
}
const profiles = new Map(systems.map(s => [s.id, profile(s)]));
// Per-axis min/max over all systems, so the radar shows how a system ranks relative to the others
// (raw averages across many slots regress to ~3 and hide the differences).
const axisRange = METRICS.map((_, i) => {
  const v = [...profiles.values()].map(p => p[i]).filter(x => x > 0);
  return [Math.min(...v), Math.max(...v)];
});
const rel = (v, i) => { const [lo, hi] = axisRange[i]; return hi > lo ? 1 + 4 * (v - lo) / (hi - lo) : 3; };

function radarSVG(seriesList, size = 260) {
  const cx = size / 2, cy = size / 2, R = size / 2 - 52, n = METRICS.length;
  const pt = (i, v) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / n; const r = (R * v) / 5; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
  let g = '';
  for (let l = 1; l <= 5; l++) g += `<polygon points="${METRICS.map((_, i) => pt(i, l).join(',')).join(' ')}" fill="none" stroke="#2a3350" stroke-width="${l === 5 ? 1.2 : .6}"/>`;
  METRICS.forEach(([, lab], i) => {
    const [x, y] = pt(i, 5), [lx, ly] = pt(i, 5.9);
    g += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="#2a3350" stroke-width=".6"/>`;
    g += `<text x="${lx}" y="${ly}" fill="#8a93b5" font-size="10" text-anchor="middle" dominant-baseline="middle">${lab}</text>`;
  });
  for (const s of seriesList) {
    const rv = s.values.map(rel);
    const pts = rv.map((v, i) => pt(i, v).join(',')).join(' ');
    g += `<polygon points="${pts}" fill="${s.color}" fill-opacity=".18" stroke="${s.color}" stroke-width="2"/>`;
    s.values.forEach((v, i) => { const [x, y] = pt(i, rv[i]); g += `<circle cx="${x}" cy="${y}" r="2.6" fill="${s.color}"><title>${esc(s.name)} – ${METRICS[i][1]}: ${v.toFixed(2)}</title></circle>`; });
  }
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Radar chart">${g}</svg>`;
}

// ---------- state ----------
const state = { chip: 'all', q: '', colSort: 'default', rowSort: 'default', rowFilter: 'all', sel: [] };
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  state.sel = (p.get('sel') || '').split(',').filter(id => sysById.has(id)).slice(0, MAX_SEL);
  if (CHIPS.some(c => c[0] === p.get('cat'))) state.chip = p.get('cat');
}
function writeHash() {
  const p = new URLSearchParams();
  if (state.sel.length) p.set('sel', state.sel.join(','));
  if (state.chip !== 'all') p.set('cat', state.chip);
  history.replaceState(null, '', '#' + p.toString());
}

const colSorters = {
  default: () => 0,
  name: (a, b) => a.name.localeCompare(b.name),
  year: (a, b) => a.since - b.since,
  category: (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
  similar: (a, b) => sim(b) - sim(a),
  ...Object.fromEntries(METRICS.map(([k], i) => [k, (a, b) => profiles.get(b.id)[i] - profiles.get(a.id)[i]]))
};
function sim(s) {
  const ref = sysById.get(state.sel[0]); if (!ref) return 0;
  let n = 0; for (const [k, v] of Object.entries(ref.choices)) if (s.choices[k] === v) n++;
  return s.id === ref.id ? 999 : n;
}
let rowKeySort = null; // {slot} when user clicked a row label

function visibleSystems() {
  const q = state.q.trim().toLowerCase();
  let list = systems.filter(s => (state.chip === 'all' || (s.tags || []).includes(state.chip)) &&
    (!q || (s.name + ' ' + s.oneLiner + ' ' + s.category).toLowerCase().includes(q)));
  if (rowKeySort) {
    const slot = rowKeySort;
    list = [...list].sort((a, b) => String(optLabel(slot, a.choices[slot]) ?? '~').localeCompare(String(optLabel(slot, b.choices[slot]) ?? '~')) || a.name.localeCompare(b.name));
  } else list = [...list].sort(colSorters[state.colSort] || colSorters.default);
  return list;
}

function distinct(slot, list) { return new Set(list.map(s => s.choices[slot]).filter(Boolean)); }

// ---------- rendering ----------
const app = document.getElementById('app');
const tip = document.getElementById('tip');

function render() {
  const cols = visibleSystems();
  let rows = rowDefs.map(r => ({ ...r, nd: distinct(r.slot, cols).size, have: cols.filter(s => s.choices[r.slot]).length }));
  if (state.rowFilter === 'diff') rows = rows.filter(r => r.nd > 1);
  if (state.rowFilter === 'same') rows = rows.filter(r => r.nd === 1 && r.have === cols.length);
  if (state.rowSort === 'diff') rows.sort((a, b) => b.nd - a.nd);
  if (state.rowSort === 'same') rows.sort((a, b) => a.nd - b.nd);

  const keep = document.querySelector('.mwrap');
  const sx = keep?.scrollLeft || 0, sy = keep?.scrollTop || 0;
  app.innerHTML = `
    <h1>Compare database systems</h1>
    <p class="sub">Every system is mapped onto the same design slots used by the 3D explorer. Filter by family, click a row label to group systems by that choice, tick up to ${MAX_SEL} systems for a side-by-side deep dive. Cell colour = option within the row (same colour = same choice).</p>
    <div class="bar">
      ${CHIPS.map(([k, l]) => `<button class="chip ${state.chip === k ? 'on' : ''}" data-chip="${k}">${l}</button>`).join('')}
      <input type="search" id="q" placeholder="Search systems…" value="${esc(state.q)}">
      <span class="spacer"></span>
      <label>Sort systems by
        <select id="colSort">
          ${[['default', 'Default'], ['name', 'Name'], ['year', 'Release year'], ['category', 'Category'], ['similar', 'Similarity to 1st selected'], ...METRICS.map(([k, l]) => [k, 'Avg. ' + l])].map(([k, l]) => `<option value="${k}" ${!rowKeySort && state.colSort === k ? 'selected' : ''}>${l}</option>`).join('')}
        </select></label>
      <label>Rows
        <select id="rowFilter">${[['all', 'All dimensions'], ['diff', 'Only where systems differ'], ['same', 'Only where all agree']].map(([k, l]) => `<option value="${k}" ${state.rowFilter === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Order rows
        <select id="rowSort">${[['default', 'Pipeline order'], ['diff', 'Most different first'], ['same', 'Most similar first']].map(([k, l]) => `<option value="${k}" ${state.rowSort === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <button class="btn ghost" id="clear" ${state.sel.length ? '' : 'disabled'}>Clear selection (${state.sel.length}/${MAX_SEL})</button>
    </div>
    <div class="note">${cols.length} systems · ${rows.length} dimensions${rowKeySort ? ` · grouped by "${esc(labelByKey.get(rowKeySort) || rowKeySort)}" <a href="#" id="ungroup">(reset)</a>` : ''}. Hover a cell for the system-specific note.</div>
    ${cols.length ? `<div class="mwrap"><table class="m"><thead><tr><th class="rl">Dimension</th>${cols.map(s => {
      const on = state.sel.includes(s.id);
      return `<th class="${on ? 'selcol' : ''}" data-sys="${s.id}"><div class="sysh"><b>${esc(s.name)}</b><span class="cat">${esc(s.category)} · ${s.since}</span>
        <label><input type="checkbox" data-pick="${s.id}" ${on ? 'checked' : ''} ${!on && state.sel.length >= MAX_SEL ? 'disabled' : ''}> compare</label></div></th>`;
    }).join('')}</tr></thead><tbody>
    ${rows.map(r => `<tr><th class="rl" data-row="${r.slot}" title="${esc(r.title)} (click to group systems by this row)">${esc(r.label)}<span class="rowdiff ${r.nd === 1 ? 'all' : ''}">${r.nd <= 1 ? 'same' : r.nd + ' variants'}</span></th>
      ${cols.map(s => {
        const o = s.choices[r.slot];
        if (!o) return `<td class="c na" data-sys="${s.id}" data-slot="${r.slot}">–</td>`;
        return `<td class="c" style="background:${optColor(r.slot, o)}" data-sys="${s.id}" data-slot="${r.slot}">${esc(optLabel(r.slot, o))}</td>`;
      }).join('')}</tr>`).join('')}
    </tbody></table></div>` : '<div class="empty">No systems match.</div>'}
    <div id="deep"></div>`;
  const nw = document.querySelector('.mwrap'); if (nw) { nw.scrollLeft = sx; nw.scrollTop = sy; }
  renderDeep();
  wire();
  writeHash();
}

function renderDeep() {
  const el = document.getElementById('deep');
  const picked = state.sel.map(id => sysById.get(id)).filter(Boolean);
  if (!picked.length) { el.innerHTML = `<h2>Side-by-side deep dive</h2><div class="empty">Tick “compare” on up to ${MAX_SEL} systems in the matrix header to see radar charts, what is the same / what differs, architecture notes and references.</div>`; return; }
  const color = id => SERIES[state.sel.indexOf(id)];
  const overlay = radarSVG(picked.map(s => ({ name: s.name, color: color(s.id), values: profiles.get(s.id) })), 340);
  const rowsAll = rowDefs.filter(r => picked.some(s => s.choices[r.slot]));
  const sameCount = rowsAll.filter(r => picked.every(s => s.choices[r.slot]) && distinct(r.slot, picked).size === 1).length;
  const diffCount = rowsAll.filter(r => distinct(r.slot, picked).size > 1 || picked.some(s => !s.choices[r.slot])).length;

  el.innerHTML = `<h2>Side-by-side deep dive</h2>
    <div class="overlay">${overlay}<div class="lg">
      <div style="color:var(--dim);font-size:12px;max-width:260px">Radar = average of the 1–5 metrics of each option the system picks, then rescaled per axis between the lowest and highest of all ${systems.length} systems (outer ring = best of the set; hover points for raw averages). An indicative profile of the design, not a benchmark.</div>
      ${picked.map(s => `<div><span class="sw" style="background:${color(s.id)}"></span><b>${esc(s.name)}</b></div>`).join('')}
      <div style="margin-top:8px;font-size:13px"><span class="tag s">${sameCount} identical</span> <span class="tag d">${diffCount} differ</span></div>
    </div></div>
    <div class="deep">${picked.map(s => `<div class="card" style="--sc:${color(s.id)}">
      <h3>${esc(s.name)}</h3><div class="meta">${esc(s.category)} · since ${s.since} · ${esc(s.language)}</div>
      <p>${esc(s.oneLiner)}</p>
      <div class="radarbox">${radarSVG([{ name: s.name, color: color(s.id), values: profiles.get(s.id) }], 290)}</div>
      <h4>Strengths</h4><ul>${s.strengths.map(x => `<li class="g">${esc(x)}</li>`).join('')}</ul>
      <h4>Weaknesses</h4><ul>${s.weaknesses.map(x => `<li class="b">${esc(x)}</li>`).join('')}</ul>
      <h4>Best for</h4><p>${esc(s.bestFor)}</p>
      <h4>Architecture</h4><p>${esc(s.architectureNotes)}</p>
      <h4>References</h4><div class="links">${s.refs.map(r => `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a>`).join('')}</div>
      <a class="explore" href="/explore.html#system=${encodeURIComponent(s.id)}">Open in 3D explorer →</a>
    </div>`).join('')}</div>
    <h2>What is the same, what differs</h2>
    <table class="cmp"><thead><tr><th>Dimension</th>${picked.map(s => `<th style="color:${color(s.id)}">${esc(s.name)}</th>`).join('')}</tr></thead><tbody>
    ${rowsAll.map(r => {
      const same = picked.every(s => s.choices[r.slot]) && distinct(r.slot, picked).size === 1;
      return `<tr class="${same ? 'same' : 'diff'}"><td class="dim">${esc(r.label)}<span class="tag ${same ? 's' : 'd'}">${same ? 'same' : 'differs'}</span></td>
      ${picked.map(s => { const o = s.choices[r.slot]; return `<td>${o ? `<span class="opt" style="background:${optColor(r.slot, o, .3)}">${esc(optLabel(r.slot, o))}</span><span class="det">${esc(s.details[r.slot] || '')}</span>` : '<span class="det">not applicable</span>'}</td>`; }).join('')}</tr>`;
    }).join('')}
    </tbody></table>`;
}

function wire() {
  app.querySelectorAll('[data-chip]').forEach(b => b.onclick = () => { state.chip = b.dataset.chip; render(); });
  const q = document.getElementById('q');
  q.oninput = () => { state.q = q.value; const pos = q.selectionStart; render(); const nq = document.getElementById('q'); nq.focus(); nq.setSelectionRange(pos, pos); };
  document.getElementById('colSort').onchange = e => { state.colSort = e.target.value; rowKeySort = null; render(); };
  document.getElementById('rowFilter').onchange = e => { state.rowFilter = e.target.value; render(); };
  document.getElementById('rowSort').onchange = e => { state.rowSort = e.target.value; render(); };
  document.getElementById('clear').onclick = () => { state.sel = []; render(); };
  const ung = document.getElementById('ungroup'); if (ung) ung.onclick = e => { e.preventDefault(); rowKeySort = null; render(); };
  app.querySelectorAll('[data-row]').forEach(th => th.onclick = () => { rowKeySort = th.dataset.row; render(); });
  app.querySelectorAll('[data-pick]').forEach(cb => cb.onchange = () => {
    const id = cb.dataset.pick;
    if (cb.checked) { if (state.sel.length < MAX_SEL) state.sel.push(id); } else state.sel = state.sel.filter(x => x !== id);
    render();
  });
  app.querySelectorAll('td.c').forEach(td => {
    td.onmouseenter = () => {
      const s = sysById.get(td.dataset.sys), slot = td.dataset.slot, o = s.choices[slot];
      if (!o) return;
      const op = optOf(slot, o);
      tip.innerHTML = `<b>${esc(s.name)}</b> · ${esc(labelByKey.get(slot) || slot)}<br><b>${esc(op?.label || o)}</b>${op?.summary ? `<div style="color:#8a93b5;margin-top:3px">${esc(op.summary)}</div>` : ''}${s.details[slot] ? `<div style="margin-top:5px">${esc(s.details[slot])}</div>` : ''}`;
      tip.hidden = false;
    };
    td.onmousemove = e => { const w = tip.offsetWidth, h = tip.offsetHeight; tip.style.left = Math.min(e.clientX + 14, innerWidth - w - 8) + 'px'; tip.style.top = Math.min(e.clientY + 14, innerHeight - h - 8) + 'px'; };
    td.onmouseleave = () => { tip.hidden = true; };
  });
}

readHash();
render();
window.addEventListener('hashchange', () => { readHash(); render(); });
