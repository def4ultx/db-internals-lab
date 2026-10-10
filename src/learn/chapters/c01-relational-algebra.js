import { h, slider, toggle, C } from '../kit.js';

function mount(el) {
  const sc = slider({ label: 'customers in TH (%)', min: 1, max: 50, value: 5, fmt: (v) => v + '%', onInput: draw });
  const sa = slider({ label: 'orders with amount>100 (%)', min: 1, max: 100, value: 20, fmt: (v) => v + '%', onInput: draw });
  const push = toggle({ label: 'push selections below the join', value: false, onChange: draw });
  const out = h('div', { class: 'out' });
  const N_O = 1000000, N_C = 10000;
  function draw() {
    const c = sc.get() / 100, a = sa.get() / 100, p = push.get();
    const fmt = (n) => Math.round(n).toLocaleString();
    // join: orders.cust_id = customers.id (FK, every order matches exactly one customer)
    const finalRows = N_O * a * c;
    let lines;
    if (!p) {
      const joined = N_O; // FK join of all orders x all customers keeps 1M rows
      lines = [`scan orders            ${fmt(N_O)} rows`, `scan customers         ${fmt(N_C)} rows`, `JOIN (hash)  builds ${fmt(N_C)}, probes ${fmt(N_O)} -> ${fmt(joined)} rows`, `sigma(country=TH AND amount>100) -> ${fmt(finalRows)} rows`];
      var work = N_O + N_C + joined + joined;
    } else {
      const o2 = N_O * a, c2 = N_C * c;
      lines = [`scan orders -> sigma(amount>100)    ${fmt(N_O)} -> ${fmt(o2)} rows`, `scan customers -> sigma(country=TH) ${fmt(N_C)} -> ${fmt(c2)} rows`, `JOIN (hash)  builds ${fmt(c2)}, probes ${fmt(o2)} -> ${fmt(finalRows)} rows`];
      var work = N_O + N_C + o2 + c2 + finalRows;
    }
    out.innerHTML = lines.join('\n') + `\n\ntuples handled in total: <b class="${p ? 'good' : 'bad'}">${fmt(work)}</b>`;
  }
  el.append(h('div', { class: 'row' }, sc.el, sa.el), h('div', { class: 'row' }, push.el), out);
  draw();
}

function mountAlg(el) {
  const sel = h('select', { class: 'dbtn' }, ['SELECT name FROM users WHERE age > 30', 'SELECT u.name, o.total FROM users u JOIN orders o ON u.id = o.uid WHERE o.total > 100', 'SELECT uid, SUM(total) FROM orders GROUP BY uid HAVING SUM(total) > 500'].map((s) => h('option', s)));
  const out = h('div', { class: 'out' });
  const plans = [
    'π name ( σ age>30 ( users ) )',
    'π u.name, o.total ( users ⨝ u.id=o.uid ( σ total>100 ( orders ) ) )',
    'σ sum>500 ( γ uid; SUM(total)→sum ( orders ) )',
  ];
  const draw = () => { out.textContent = plans[sel.selectedIndex]; };
  sel.addEventListener('change', draw); draw();
  el.append(h('div', { class: 'row' }, sel), out);
}

export default {
  n: 1, title: 'Relational algebra & SQL', minutes: 14, cmu: 'CMU 15-445 L2 (Modern SQL), L3',
  components: ['relational-algebra', 'logical-plan', 'optimizer'],
  goals: ['Translate a SELECT into relational algebra operators (σ π ⨝ γ).', 'Use algebraic equivalences (selection pushdown, join commutativity) to see why optimizers can rewrite plans.', 'Explain bag vs set semantics and why SQL is declarative.'],
  body: `
<h2>The relational model</h2>
<p>A <b>relation</b> is an unordered collection of tuples with the same attributes. Codd's insight (1970) was to separate the logical model from physical storage: you say <i>what</i> you want and the DBMS decides <i>how</i>. SQL implements the model with two differences: relations are <b>bags</b> (duplicates allowed, unless <code>DISTINCT</code>) and SQL has <code>NULL</code> with three-valued logic.</p>
<h2>The core operators</h2>
<table><tr><th>Operator</th><th>Symbol</th><th>SQL</th><th>Notes</th></tr>
<tr><td>Selection</td><td>σ<sub>p</sub>(R)</td><td>WHERE p</td><td>keeps rows where p is TRUE (NULL drops the row)</td></tr>
<tr><td>Projection</td><td>π<sub>a,b</sub>(R)</td><td>SELECT a, b</td><td>may compute expressions</td></tr>
<tr><td>Join</td><td>R ⨝<sub>p</sub> S</td><td>JOIN ... ON p</td><td>cross product then σ; inner/outer/semi/anti variants</td></tr>
<tr><td>Aggregation</td><td>γ<sub>g; f(x)</sub>(R)</td><td>GROUP BY g</td><td>HAVING is a σ above γ</td></tr>
<tr><td>Union / intersect / except</td><td>∪ ∩ −</td><td>UNION ...</td><td>ALL keeps bag semantics</td></tr></table>
<div data-demo="1"></div>
<h2>Equivalences are the optimizer's raw material</h2>
<ul><li><b>Cascade / pushdown of selections</b>: σ<sub>p∧q</sub>(R) = σ<sub>p</sub>(σ<sub>q</sub>(R)); σ<sub>p</sub>(R ⨝ S) = σ<sub>p</sub>(R) ⨝ S when p only mentions R.</li>
<li><b>Join commutativity and associativity</b>: R ⨝ S = S ⨝ R; (R ⨝ S) ⨝ T = R ⨝ (S ⨝ T). With n tables there are (2(n-1))!/(n-1)! possible bushy orderings: 12 for 3 tables, 120 for 4, 1,680 for 5, 30,240 for 6.</li>
<li><b>Projection pushdown</b>: drop columns early so fewer bytes flow (huge for column stores and wide rows).</li></ul>
<p>The demo below shows why pushdown matters: with 1M orders and 10K customers, joining first handles ~2M+ tuples; filtering first can cut that by orders of magnitude.</p>
<div data-demo="0"></div>
<div class="callout tip"><div class="t">Declarative does not mean slow</div><p>Because SQL says nothing about order, the optimizer is free to reorder joins, choose algorithms, and push filters into storage (zone maps, index scans). The same query can differ 1000x in cost between plans.</p></div>
<h2>NULLs, bags and the traps</h2>
<p><code>x = NULL</code> is never true; <code>NOT IN</code> with a NULL in the subquery returns no rows; <code>COUNT(col)</code> skips NULLs but <code>COUNT(*)</code> does not. These semantics constrain rewrites: an optimizer may turn <code>NOT IN</code> into an anti-join only if it preserves NULL behaviour.</p>
<h2>Beyond the basics</h2>
<p>Modern SQL adds CTEs (including recursive), window functions, lateral joins, and subqueries. Optimizers <b>decorrelate</b> subqueries into joins (Neumann and Kemper's unnesting, used in HyPer/Umbra/DuckDB). Window functions become a partition+sort operator over the logical plan.</p>`,
  demos: [{ title: 'Predicate pushdown', caption: 'Toggle pushdown and watch tuples processed change. orders = 1,000,000 rows, customers = 10,000.', mount }, { title: 'SQL to algebra', caption: 'Pick a query to see its algebra expression.', mount: mountAlg }],
  tradeoffs: { head: ['Rewrite', 'Helps', 'Risk / limit'], rows: [['Selection pushdown', 'Fewer tuples into joins; enables index and zone-map use', 'Cannot cross outer joins or non-deterministic functions blindly'], ['Projection pushdown', 'Less memory and I/O, essential for column stores', 'Tiny cost to plan'], ['Join reordering', 'Orders-of-magnitude difference', 'Search space explodes; needs good cardinalities'], ['Subquery decorrelation', 'Avoids per-row re-execution', 'NULL and duplicate semantics must be preserved']] },
  ripples: [{ to: 'Optimizer', text: 'the set of algebraic equivalences you implement is the plan space it can search.' }, { to: 'Storage', text: 'pushdown only pays off if storage can evaluate predicates (zone maps, index scans, Parquet row-group stats).' }, { to: 'Statistics', text: 'choosing where to place a filter or join needs selectivity estimates.' }],
  quiz: [{ q: 'Which rewrite is always valid for an inner join?', options: ['Pushing a filter on only R below R ⨝ S', 'Pushing a filter below the preserved side of a LEFT JOIN when it references the null-supplying side', 'Dropping DISTINCT'], answer: 0, why: 'A predicate referencing only R can be applied before an inner join; the other rewrites change results.' }, { q: 'How many bushy join trees exist for 4 tables (ordered)?', options: ['24', '120', '5040'], answer: 1, why: '(2(n-1))!/(n-1)! = 6!/3! = 120.' }, { q: 'What does SELECT * FROM t WHERE x NOT IN (SELECT y FROM u) return if u.y contains a NULL?', options: ['All rows of t', 'No rows', 'Rows with x NULL'], answer: 1, why: 'x <> NULL is UNKNOWN, so the NOT IN predicate is never TRUE.' }],
  refs: [{ title: 'CMU 15-445 schedule (Fall 2024)', url: 'https://15445.courses.cs.cmu.edu/fall2024/schedule.html' }, { title: 'Selinger et al., Access Path Selection in a Relational DBMS (1979)', url: 'https://dl.acm.org/doi/10.1145/582095.582099' }, { title: 'Neumann & Kemper: Unnesting Arbitrary Queries', url: 'https://cs.emis.de/LNI/Proceedings/Proceedings241/383.pdf' }],
};
