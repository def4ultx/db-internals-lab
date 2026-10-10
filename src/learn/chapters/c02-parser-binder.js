import { h, C } from '../kit.js';

const CATALOG = { users: { id: 'INT', name: 'TEXT', age: 'INT' }, orders: { id: 'INT', uid: 'INT', total: 'INT' } };
const KW = new Set(['SELECT', 'FROM', 'WHERE', 'AND', 'OR']);
function lex(s) {
  const toks = []; const re = /\s*(?:(\d+)|([A-Za-z_][A-Za-z_0-9]*)|('(?:[^']*)')|(<=|>=|<>|=|<|>|,|\*|\.|\(|\)))/y; let m; re.lastIndex = 0;
  while (re.lastIndex < s.length) {
    const start = re.lastIndex; m = re.exec(s);
    if (!m) { if (/^\s*$/.test(s.slice(start))) break; throw new Error('lexer: unexpected character at ' + start + ': "' + s.slice(start).trim()[0] + '"'); }
    if (m[1]) toks.push({ t: 'NUM', v: m[1] }); else if (m[2]) toks.push(KW.has(m[2].toUpperCase()) ? { t: 'KW', v: m[2].toUpperCase() } : { t: 'IDENT', v: m[2] }); else if (m[3]) toks.push({ t: 'STR', v: m[3] }); else toks.push({ t: 'SYM', v: m[4] });
  }
  return toks;
}
function parse(toks) {
  let i = 0; const peek = () => toks[i], eat = (t, v) => { const k = toks[i]; if (!k || k.t !== t || (v && k.v !== v)) throw new Error('parser: expected ' + (v || t) + ' but found ' + (k ? k.v : 'end of input')); i++; return k; };
  eat('KW', 'SELECT'); const cols = [];
  if (peek() && peek().v === '*') { i++; cols.push({ star: true }); } else do { cols.push({ col: eat('IDENT').v }); } while (peek() && peek().v === ',' && i++ >= 0);
  eat('KW', 'FROM'); const from = eat('IDENT').v; let where = null;
  const operand = () => { const k = peek(); if (!k) throw new Error('parser: expected operand'); i++; if (k.t === 'IDENT') return { col: k.v }; if (k.t === 'NUM') return { lit: +k.v, type: 'INT' }; if (k.t === 'STR') return { lit: k.v, type: 'TEXT' }; throw new Error('parser: bad operand ' + k.v); };
  const cmp = () => { const l = operand(); const op = eat('SYM').v; return { op, l, r: operand() }; };
  if (peek() && peek().v === 'WHERE') { i++; where = cmp(); while (peek() && (peek().v === 'AND' || peek().v === 'OR')) { const o = toks[i++].v; where = { op: o, l: where, r: cmp() }; } }
  if (i < toks.length) throw new Error('parser: unexpected ' + toks[i].v);
  return { type: 'Select', cols, from, where };
}
function bind(ast) {
  const tbl = CATALOG[ast.from]; if (!tbl) throw new Error('binder: relation "' + ast.from + '" does not exist (catalog has: ' + Object.keys(CATALOG).join(', ') + ')');
  const colOf = (c) => { if (!(c in tbl)) throw new Error('binder: column "' + c + '" does not exist in ' + ast.from); return tbl[c]; };
  const walk = (n) => { if (!n) return; if (n.col) { n.type = colOf(n.col); n.ref = ast.from + '.' + n.col; } else if (n.lit !== undefined) { } else { walk(n.l); walk(n.r); if (!['AND', 'OR'].includes(n.op) && n.l.type !== n.r.type) throw new Error('binder: type mismatch ' + n.l.type + ' ' + n.op + ' ' + n.r.type); } };
  ast.cols.forEach((c) => { if (c.col) c.type = colOf(c.col); });
  walk(ast.where); return ast;
}
function mount(el) {
  const inp = h('input', { type: 'text', value: "SELECT name FROM users WHERE age > 30 AND id < 100", style: { width: '100%', padding: '8px', background: '#0b0e17', color: '#fff', border: '1px solid #2a3350', borderRadius: '8px', font: '13px var(--mono)' } });
  const o1 = h('div', { class: 'out' }), o2 = h('div', { class: 'out' }), o3 = h('div', { class: 'out' });
  function run() {
    o1.textContent = o2.textContent = o3.textContent = ''; o1.className = o2.className = o3.className = 'out';
    let toks, ast;
    try { toks = lex(inp.value); o1.textContent = 'TOKENS  ' + toks.map((t) => t.t + '(' + t.v + ')').join(' '); } catch (e) { o1.innerHTML = '<span class="bad">' + e.message + '</span>'; return; }
    try { ast = parse(toks); o2.textContent = 'AST\n' + JSON.stringify(ast, null, 1).replace(/\n\s*/g, ' ').slice(0, 600); } catch (e) { o2.innerHTML = '<span class="bad">' + e.message + '</span>'; return; }
    try { bind(ast); o3.innerHTML = '<span class="good">BOUND OK</span> ' + ast.from + ' columns resolved with types; where-clause types checked.'; } catch (e) { o3.innerHTML = '<span class="bad">' + e.message + '</span>'; }
  }
  inp.addEventListener('input', run);
  const ex = h('div', { class: 'row' }, ["SELECT name FROM users WHERE age > 30", "SELECT nam FROM users", "SELECT id FROM usrs", "SELECT id FROM users WHERE name > 3", "SELECT FROM users"].map((s) => h('button', { class: 'dbtn', onclick: () => { inp.value = s; run(); } }, s.length > 30 ? s.slice(0, 28) + '..' : s)));
  el.append(h('div', { class: 'cap' }, 'Catalog: users(id INT, name TEXT, age INT), orders(id INT, uid INT, total INT)'), inp, ex, o1, o2, o3); run();
}

export default {
  n: 2, title: 'Parser, AST, binder, catalog', minutes: 12, cmu: 'CMU 15-445 L14 (Query planning)',
  components: ['parser', 'binder', 'catalog'],
  goals: ['Describe lexing, parsing, binding and what each can and cannot detect.', 'Explain what the catalog stores and why DDL interacts with concurrency control.', 'Recognise which errors are syntax errors vs semantic errors.'],
  body: `
<h2>Text to tokens to tree</h2>
<p>The <b>lexer</b> splits <code>SELECT name FROM users WHERE age &gt; 30</code> into tokens: keywords, identifiers, literals, operators. The <b>parser</b> applies the SQL grammar to build an <b>abstract syntax tree</b>. PostgreSQL uses a Bison grammar (gram.y, thousands of rules); SQLite uses the Lemon parser generator; DuckDB reuses Postgres's parser via libpg_query; MySQL uses Bison; many newer engines use hand-written recursive-descent parsers for better errors and speed.</p>
<p>The AST only knows syntax. <code>SELECT nam FROM usrs</code> parses perfectly.</p>
<h2>Binding: attaching meaning</h2>
<p>The <b>binder</b> (PostgreSQL calls it the analyzer, in <code>parse_analyze</code>) walks the AST and resolves each name against the <b>catalog</b>: which table has this name in the current schema search path, which column, what type, which overloaded function or operator applies (<code>int + numeric</code> needs an implicit cast). It also expands <code>*</code>, checks that non-aggregated columns appear in <code>GROUP BY</code>, and checks permissions. Output: a bound tree where every reference is an id (table oid, column number), which becomes the first logical plan.</p>
<div data-demo="0"></div>
<h2>The catalog</h2>
<p>The catalog is the database's metadata, stored in ordinary tables: PostgreSQL's <code>pg_class</code>, <code>pg_attribute</code>, <code>pg_type</code>, <code>pg_index</code>; MySQL's data dictionary (InnoDB tables since 8.0); SQLite's <code>sqlite_schema</code>. It holds tables, columns, types, indexes, constraints, statistics pointers, and privileges. Because it is just data, it is protected by the same transactions: PostgreSQL has transactional DDL (<code>BEGIN; ALTER TABLE ...; ROLLBACK</code> works), MySQL historically did not and now has atomic DDL for most statements.</p>
<div class="callout"><div class="t">Schema changes are a concurrency problem</div><p>Adding a column to a 1-billion-row table cannot rewrite every row under an exclusive lock. PostgreSQL stores a default for later added columns in the catalog (fast default since v11); MySQL's online DDL (INSTANT, INPLACE) and Vitess/gh-ost/pt-osc copy tables in the background. F1 (Google) describes a multi-state online schema change protocol.</p></div>
<h2>Plan caching starts here</h2>
<p>Parsing and binding cost tens to hundreds of microseconds, which matters for OLTP at 100k queries/s. Prepared statements parse and bind once; the bound statement is revalidated when the catalog version changes (any DDL invalidates cached plans).</p>`,
  demos: [{ title: 'Lex, parse, bind', caption: 'Try the broken examples and see which stage reports each error.', mount }],
  tradeoffs: { head: ['Choice', 'Pro', 'Con'], rows: [['Generated parser (Bison/Lemon)', 'Complete grammar, quick to extend', 'Poor error messages, harder to recover'], ['Hand-written recursive descent', 'Great errors, fast, easy to embed', 'Grammar drift, more code to test'], ['Catalog as ordinary tables', 'Transactional DDL, queryable, replicated for free', 'Bootstrap problem; catalog lookups need caching'], ['Catalog in a separate service (Hive Metastore)', 'Shared across engines', 'Extra network hop; consistency of schema vs data files']] },
  ripples: [{ to: 'Plan cache', text: 'any catalog version change must invalidate cached bound plans.' }, { to: 'Concurrency control', text: 'DDL takes metadata locks (MySQL MDL, Postgres ACCESS EXCLUSIVE) that block or queue behind long transactions.' }, { to: 'Optimizer', text: 'the binder supplies types and constraints (NOT NULL, unique) that enable rewrites.' }],
  quiz: [{ q: 'SELECT nam FROM users fails. Which stage reports it?', options: ['Lexer', 'Parser', 'Binder'], answer: 2, why: 'The syntax is valid; "nam" only fails to resolve against the catalog.' }, { q: 'Where does PostgreSQL store table definitions?', options: ['In a JSON file', 'In system catalog tables like pg_class', 'In the WAL only'], answer: 1, why: 'The catalog is ordinary tables, which gives transactional DDL.' }, { q: 'Why do prepared statements help OLTP?', options: ['They skip the executor', 'They avoid repeated parse and bind work', 'They disable locks'], answer: 1, why: 'The parse+bind (and sometimes plan) cost is paid once.' }],
  refs: [{ title: 'CMU 15-445 schedule (Fall 2024)', url: 'https://15445.courses.cs.cmu.edu/fall2024/schedule.html' }, { title: 'PostgreSQL: Overview of query processing', url: 'https://www.postgresql.org/docs/current/query-path.html' }, { title: 'Online, Asynchronous Schema Change in F1 (VLDB 2013)', url: 'https://research.google/pubs/online-asynchronous-schema-change-in-f1/' }],
};
