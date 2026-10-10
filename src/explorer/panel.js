// HTML renderers for the inspector side panel. Links use data-go="comp:<id>" | "edge:<id>" | "layer:<id>" | "enter:<id>" | "tab:<name>" | "flow:<id>".
import { compById, edgeById, edgesOf, slotsForComponent, optionOf, systemById, flows, components } from '../data/index.js';
import { LAYERS, layerById, EDGE_KINDS } from '../shared/layers.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cname = (id) => compById[id]?.name || id;
const link = (id) => (compById[id] ? `<a data-go="comp:${id}">${esc(cname(id))}</a>` : esc(id));

export function renderEmpty() {
  return `<div class="empty"><h3>Explore the architecture</h3><p>Click a component or an interface edge to inspect it. Double-click a component (or scroll-zoom into it, or press <kbd>Enter</kbd>) to dive into its internals.</p>
  <p class="dimtxt">Tip: press <kbd>/</kbd> to search, <kbd>?</kbd> for all shortcuts. Use the <b>Flows</b> tab to watch a query travel through the system, and the <b>Design</b> tab to compose a database.</p>
  <div class="sech">Layers</div>${LAYERS.map((l) => `<a class="layerrow" data-go="layer:${l.id}" style="--lc:${l.color}"><i></i>${esc(l.name)}<span>${components.filter((c) => c.layer === l.id).length}</span></a>`).join('')}</div>`;
}

export function renderLayer(id) {
  const l = layerById[id]; const list = components.filter((c) => c.layer === id);
  return `<div class="phead" style="--lc:${l.color}"><span class="chip2">LAYER</span><h2>${esc(l.name)}</h2></div>
  <div class="sec"><div class="sech">Components (${list.length})</div>${list.map((c) => `<div class="mini-comp"><a data-go="comp:${c.id}"><b>${esc(c.name)}</b></a><div class="dimtxt">${esc(c.responsibility || '')}</div></div>`).join('')}</div>`;
}

export function renderComponent(c, config, activeSystem) {
  const l = layerById[c.layer]; const sl = slotsForComponent(c.id); const ed = edgesOf(c.id);
  const ins = ed.filter((e) => e.to === c.id), outs = ed.filter((e) => e.from === c.id);
  const edgeRow = (e, dir) => `<a class="erow" data-go="edge:${e.id}"><i style="background:${EDGE_KINDS[e.kind]}"></i>${dir === 'in' ? `${esc(cname(e.from))} →` : `→ ${esc(cname(e.to))}`}<span>${esc(e.label || '')}</span></a>`;
  return `<div class="phead" style="--lc:${l.color}"><span class="chip2">${esc(l.name)}</span><h2>${esc(c.name)}</h2><div class="tags"><span class="tag">${esc(c.oltpOlap || 'both')}</span><code>${esc(c.id)}</code></div></div>
  <div class="actions"><button class="btn pri" data-go="enter:${c.id}">Dive into internals ⏎</button><button class="btn" data-go="connect:${c.id}">Show connections</button></div>
  ${c.responsibility ? `<div class="resp">${esc(c.responsibility)}</div>` : ''}
  <p>${esc(c.summary)}</p>
  ${c.internals?.length ? `<div class="sec"><div class="sech">Internals</div><ul class="internals">${c.internals.map((i) => `<li><b>${esc(i.name)}</b> — ${esc(i.desc)}</li>`).join('')}</ul></div>` : ''}
  ${c.keyIdeas?.length ? `<div class="sec"><div class="sech">Key ideas</div><ul class="ideas">${c.keyIdeas.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>` : ''}
  ${c.impacts?.length ? `<div class="sec"><div class="sech">Impacts on other components</div>${c.impacts.map((i) => `<div class="impact">${link(i.with)}<div>${esc(i.how)}</div></div>`).join('')}</div>` : ''}
  ${sl.length ? `<div class="sec"><div class="sech">Design slots</div>${sl.map((s) => `<a class="slotrow" data-go="slot:${s.id}"><span>${esc(s.title || s.id)}</span><b>${esc(optionOf(s.id, config[s.id])?.label || config[s.id])}</b></a>`).join('')}</div>` : ''}
  ${ed.length ? `<div class="sec"><div class="sech">Interfaces (${ed.length})</div>${ins.length ? `<div class="dimtxt sm">Incoming</div>${ins.map((e) => edgeRow(e, 'in')).join('')}` : ''}${outs.length ? `<div class="dimtxt sm">Outgoing</div>${outs.map((e) => edgeRow(e, 'out')).join('')}` : ''}</div>` : ''}
  ${c.systems && Object.keys(c.systems).length ? `<div class="sec"><div class="sech">How real systems do it</div>${Object.entries(c.systems).map(([k, v]) => `<div class="sysnote ${activeSystem === k ? 'act' : ''}"><b>${esc(systemById[k]?.name || k)}</b> ${esc(v)}</div>`).join('')}</div>` : ''}
  ${c.refs?.length ? `<div class="sec"><div class="sech">References</div>${c.refs.map((r) => `<div><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)} ↗</a></div>`).join('')}</div>` : ''}`;
}

export function renderEdge(e) {
  const using = flows.filter((f) => f.steps.some((s) => s.edge === e.id));
  const i = e.iface || {};
  return `<div class="phead" style="--lc:${EDGE_KINDS[e.kind] || '#8a93b5'}"><span class="chip2">INTERFACE · ${esc(e.kind)}</span><h2>${esc(e.label || e.id)}</h2></div>
  <div class="route2">${link(e.from)} <span>→</span> ${link(e.to)}</div>
  ${i.signature ? `<div class="sec"><div class="sech">Signature</div><pre class="sig">${esc(i.signature)}</pre></div>` : ''}
  ${i.payload ? `<div class="sec"><div class="sech">Example payload</div><pre>${esc(i.payload)}</pre></div>` : ''}
  ${i.notes ? `<div class="sec"><div class="sech">Notes</div><p>${esc(i.notes)}</p></div>` : ''}
  ${using.length ? `<div class="sec"><div class="sech">Used in flows</div>${using.map((f) => `<a class="erow" data-go="flow:${f.id}">▶ ${esc(f.title)}<span>${esc(f.workload)}</span></a>`).join('')}</div>` : ''}`;
}
