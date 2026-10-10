import { h, btn, slider, C } from '../kit.js';

function mount(el) {
  const names = ['A', 'B', 'C', 'D', 'E'];
  let card = [1000000, 50000, 2000, 100, 5000];
  // join selectivities (chain A-B-C-D plus E-B), others cross product (sel=1)
  const sel = (i, j) => { const k = [i, j].sort().join(''); return { '01': 1 / 50000, '12': 1 / 2000, '23': 1 / 100, '14': 1 / 5000 }[k] ?? 1; };
  const nS = slider({ label: 'tables', min: 3, max: 5, value: 4, onInput: run });
  const out = h('div', { class: 'out' }); const tbl = h('div', { class: 'out' });
  const shuffle = btn('Randomize sizes', () => { card = card.map(() => Math.round(Math.pow(10, 2 + Math.random() * 4.5))); run(); });
  function run() {
    const n = nS.get(); const full = (1 << n) - 1; const best = new Array(1 << n); const rows = new Array(1 << n); let considered = 0;
    const rowsOf = (m) => { let r = 1; const idx = []; for (let i = 0; i < n; i++) if (m >> i & 1) { r *= card[i]; idx.push(i); } for (let a = 0; a < idx.length; a++) for (let b = a + 1; b < idx.length; b++) r *= sel(idx[a], idx[b]); return Math.max(1, r); };
    for (let m = 1; m <= full; m++) rows[m] = rowsOf(m);
    for (let i = 0; i < n; i++) best[1 << i] = { cost: 0, plan: names[i] };
    for (let m = 1; m <= full; m++) { if (best[m]) continue; for (let s = (m - 1) & m; s > 0; s = (s - 1) & m) { const t = m ^ s; if (s < t) continue; considered++; const c = best[s].cost + best[t].cost + rows[m]; if (!best[m] || c < best[m].cost) best[m] = { cost: c, plan: '(' + best[s].plan + ' ⨝ ' + best[t].plan + ')' }; } }
    const fact = (k) => k <= 1 ? 1 : k * fact(k - 1); const bushy = fact(2 * (n - 1)) / fact(n - 1);
    const lines = []; for (let m = 1; m <= full; m++) if ((m & (m - 1)) && lines.length < 40) lines.push(m.toString(2).padStart(n, '0').split('').reverse().map((b, i) => b === '1' ? names[i] : '').join('').padEnd(5) + ' rows~' + Math.round(rows[m]).toLocaleString().padEnd(14) + ' best ' + best[m].plan);
    out.innerHTML = `sizes: ${card.slice(0, n).map((c, i) => names[i] + '=' + c.toLocaleString()).join('  ')}\nbest plan: <b class="good">${best[full].plan}</b>  cost (sum of intermediate rows) = ${Math.round(best[full].cost).toLocaleString()}\nDP considered ${considered} (subset, complement) splits; brute force would enumerate ${bushy.toLocaleString()} bushy trees (x2^${n - 1} orientations). At 20 tables DP over subsets is 3^20 = 3.5 billion.`;
    tbl.textContent = 'DP TABLE (subset -> best sub-plan)\n' + lines.join('\n');
  }
  el.append(h('div', { class: 'row' }, nS.el, shuffle), out, tbl); run();
}

export default {
  n: 4, title: 'The optimizer', minutes: 18, cmu: 'CMU 15-445 L14-L15, 15-721 L13-L14',
  components: ['optimizer', 'logical-plan', 'physical-plan', 'cost-model'],
  goals: ['Separate logical from physical optimization and name what each decides.', 'Compare System R bottom-up DP, Cascades top-down memo search, DPhyp and heuristic/learned approaches.', 'Explain why cost models and cardinality estimates dominate plan quality.'],
  body: `
<h2>Logical vs physical</h2>
<p>A <b>logical plan</b> is a tree of algebra operators (Scan, Filter, Join, Aggregate). A <b>physical plan</b> picks algorithms and properties: SeqScan vs IndexScan, HashJoin vs SortMergeJoin vs NestedLoop, whether input is sorted or partitioned. The optimizer searches the space of equivalent plans for the cheapest under a <b>cost model</b> (CPU + I/O + network, sometimes memory).</p>
<h2>Search strategies</h2>
<table><tr><th>Strategy</th><th>Idea</th><th>Used by</th></tr>
<tr><td>Heuristic / rule-based</td><td>Fixed rewrite rules: pushdown, constant folding, index if available. No costing.</td><td>early Oracle, SQLite's rules, many first-gen engines</td></tr>
<tr><td>System R bottom-up DP</td><td>Best plan for each subset of tables, built from smaller subsets; keeps "interesting orders"; often restricted to left-deep trees</td><td>PostgreSQL (geqo genetic fallback above 12 tables), DB2, MySQL (greedy search)</td></tr>
<tr><td>Cascades top-down</td><td>Memo of equivalence groups; transformation rules (logical to logical) and implementation rules (logical to physical); branch-and-bound pruning using required physical properties</td><td>SQL Server, Greenplum Orca, Apache Calcite, CockroachDB, TiDB</td></tr>
<tr><td>DPhyp</td><td>DP over connected subgraphs of a query hypergraph; handles outer joins and complex predicates without cross products</td><td>HyPer/Umbra, DuckDB (join order optimizer), newer research engines</td></tr>
<tr><td>Learned</td><td>Neural cardinality models (MSCN, NeuroCard), learned cost, or steering (Bao picks rule-set hints with bandits)</td><td>research; Bao/Balsa prototypes, some cloud vendors</td></tr></table>
<h2>Join order: why it is the hard part</h2>
<p>For n tables the number of bushy join trees grows super-exponentially (n=10 is about 17.6 billion), but DP over subsets only needs about 3<sup>n</sup> work, which is tractable to roughly 15-20 tables. Beyond that engines fall back to greedy or randomized search (PostgreSQL genetic optimizer at <code>geqo_threshold=12</code>). Try it:</p>
<div data-demo="0"></div>
<h2>Physical properties and the cost model</h2>
<p>A sort-merge join wants both inputs sorted on the key; an index scan provides that order for free. Cascades models this as <b>required properties</b> with enforcer operators (Sort, Exchange). In distributed engines the partitioning property is just as important: a shuffled hash join pays network cost unless inputs are already co-partitioned.</p>
<p>A typical cost: <code>cost = seq_page_cost * pages + random_page_cost * random_pages + cpu_tuple_cost * rows + cpu_operator_cost * ops</code> (PostgreSQL defaults 1.0, 4.0, 0.01, 0.0025). The constants are unit-less and tuned, which is why changing <code>random_page_cost</code> to 1.1 for SSDs shifts plans toward indexes.</p>
<div class="callout"><div class="t">Optimization time is part of latency</div><p>OLTP engines keep planning to microseconds (heuristics, plan caches, small search spaces). OLAP engines can spend tens of milliseconds because the query runs for seconds. Planning time budget is a design axis.</p></div>
<h2>Robustness beats optimality</h2>
<p>Because estimates are noisy, engines add safety nets: prefer plans whose cost is insensitive to errors (hash join over nested loop with an uncertain outer), re-optimize mid-query (adaptive execution), cap memory with spillable operators, or use sampling at plan time.</p>`,
  demos: [{ title: 'Join order dynamic programming', caption: 'Dynamic programming over table subsets. Chain join A-B-C-D with E hanging off B; other pairs are cross products.', mount }],
  tradeoffs: { head: ['Approach', 'Plan quality', 'Planning time', 'Extensibility'], rows: [['Heuristic rules', 'Mediocre, predictable', 'Microseconds', 'Easy'], ['Bottom-up DP (System R)', 'Optimal for left-deep space', 'Exponential, bounded by thresholds', 'Property handling is awkward'], ['Cascades', 'Optimal in explored space, good properties', 'Can blow up without pruning', 'Rules are pluggable; memo is complex'], ['DPhyp', 'Optimal for connected joins incl. outer joins', 'Fast on sparse query graphs', 'Join ordering only'], ['Learned', 'Can beat cost models on a workload', 'Inference overhead', 'Needs training data and fallbacks']] },
  ripples: [{ to: 'Statistics', text: 'the optimizer is a consumer of cardinalities; bad inputs make a perfect search useless.' }, { to: 'Execution', text: 'the physical plan encodes pipelines and breakers; choosing a hash join implies a materializing build side.' }, { to: 'Distributed layer', text: 'partitioning becomes a physical property; shuffles and broadcasts are chosen like any other operator.' }, { to: 'Plan cache', text: 'cached plans trade planning latency for stale-plan risk.' }],
  quiz: [{ q: 'What does a Cascades "enforcer" do?', options: ['Applies a security policy', 'Adds an operator (e.g. Sort) to satisfy a required physical property', 'Forces a hint'], answer: 1, why: 'Enforcers such as Sort or Exchange make an input meet required ordering or partitioning.' }, { q: 'Why do engines bound the DP search (e.g. 12 tables in PostgreSQL)?', options: ['SQL forbids more joins', 'DP over subsets is about 3^n', 'Indexes stop working'], answer: 1, why: 'Work grows exponentially, so they switch to greedy or genetic search.' }, { q: 'What usually dominates plan quality problems?', options: ['Cost constants', 'Cardinality estimation errors', 'Parser speed'], answer: 1, why: 'Leis et al. found cardinality errors dominate; cost model tuning matters far less.' }],
  refs: [{ title: 'Selinger et al., Access Path Selection (SIGMOD 1979)', url: 'https://dl.acm.org/doi/10.1145/582095.582099' }, { title: 'Moerkotte & Neumann, Dynamic Programming Strikes Back (SIGMOD 2008)', url: 'https://dl.acm.org/doi/10.1145/1376616.1376672' }, { title: 'Marcus et al., Bao: Making Learned Query Optimization Practical', url: 'https://arxiv.org/abs/2004.03814' }, { title: 'CMU 15-721 schedule', url: 'https://15721.courses.cs.cmu.edu/spring2024/schedule.html' }],
};
