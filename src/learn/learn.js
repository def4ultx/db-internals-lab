import { h } from './kit.js';
import './learn.css';

// Chapter modules are lazy so a missing/broken chapter never breaks the shell.
const mods = import.meta.glob('./chapters/c*.js');
const files = Object.keys(mods).sort();
const GROUPS = { 0: 'Foundations', 1: 'Query processing', 7: 'Storage', 11: 'Transactions', 15: 'Distributed', 17: 'Synthesis' };
const TITLES = ['Big picture & OLTP vs OLAP','Relational algebra & SQL','Parser, AST, binder, catalog','Statistics & cardinality','The optimizer','Execution models','Scheduling & parallelism','Storage: pages & layouts','Buffer pool, eviction, prefetch','Index structures','Columnar, PAX, compression','Transactions & concurrency control','Isolation levels & anomalies','Locks, latches, deadlocks','Logging & recovery','Distributed databases','Disaggregated storage / S3','Putting it together'];

const LS = 'dbil.learn.done';
function loadDone() { try { return new Set(JSON.parse(localStorage.getItem(LS) || '[]')); } catch { return new Set(); } }
function saveDone(s) { try { localStorage.setItem(LS, JSON.stringify([...s])); } catch {} }
const done = loadDone();
const cache = {};
let cleanups = [];

const root = document.getElementById('app');
const toc = h('aside', { class: 'toc' });
const main = h('main', { class: 'chapter' });
root.append(h('div', { class: 'learn' }, toc, main));

function renderToc(cur) {
  const total = TITLES.length;
  toc.replaceChildren(
    h('h2', 'Course'),
    h('div', { class: 'bar' }, h('i', { style: { width: (done.size / total * 100) + '%' } })),
    h('div', { class: 'pct' }, `${done.size} / ${total} chapters complete`),
    ...TITLES.flatMap((t, n) => [
      GROUPS[n] ? h('div', { class: 'grp' }, GROUPS[n]) : null,
      h('a', { href: '#ch=' + n, class: (n === cur ? 'on ' : '') + (done.has(n) ? 'done' : ''), title: t },
        h('span', { class: 'n' }, n), h('span', t), h('span', { class: 'ck' }, '✓')),
    ].filter(Boolean)));
}

function parseHash() {
  const m = location.hash.match(/(?:ch|chapter)?=?(\d+)/);
  const n = m ? +m[1] : 0;
  return Math.max(0, Math.min(TITLES.length - 1, n));
}

function quizEl(quiz) {
  return h('section', { class: 'quiz' }, h('h2', { style: { border: 0, marginTop: '14px' } }, 'Check yourself'),
    quiz.map((q, qi) => {
      const why = h('div', { class: 'why' }, q.why);
      const opts = q.options.map((o, oi) => {
        const lab = h('label', h('input', { type: 'radio', name: 'q' + qi, style: { marginRight: '8px' } }), o);
        lab.querySelector('input').addEventListener('change', () => {
          opts.forEach((l, i) => { l.className = i === q.answer ? 'right' : (l === lab ? 'wrong' : ''); });
          why.classList.add('show'); why.textContent = (oi === q.answer ? 'Correct. ' : 'Not quite. ') + q.why;
        });
        return lab;
      });
      return h('div', { class: 'q' }, h('p', `${qi + 1}. ${q.q}`), ...opts, why);
    }));
}

function table(t) {
  return h('table', h('thead', h('tr', t.head.map((c) => h('th', { html: null }, c)))),
    h('tbody', t.rows.map((r) => h('tr', r.map((c) => { const td = h('td'); td.innerHTML = c; return td; })))));
}

async function show(n) {
  cleanups.forEach((f) => { try { f(); } catch {} }); cleanups = [];
  renderToc(n);
  main.replaceChildren(h('p', { class: 'dim' }, 'Loading…'));
  window.scrollTo(0, 0);
  const file = files.find((f) => new RegExp('/c0*' + n + '(?:[-_.])').test(f));
  let ch = cache[n];
  if (!ch && file) { try { ch = cache[n] = (await mods[file]()).default; } catch (e) { console.warn('chapter failed', n, e); } }
  if (!ch) {
    main.replaceChildren(h('h1', `${n}. ${TITLES[n]}`), h('p', { class: 'dim' }, 'This chapter is not available yet.'));
    return nav(n);
  }
  const bodyEl = h('div'); bodyEl.innerHTML = ch.body;
  const demos = (ch.demos || (ch.demo ? [ch.demo] : [])).map((d, i) => {
    const box = h('div', { class: 'demo' }, h('div', { class: 'dt' }, h('small', 'Try it'), d.title), d.caption ? h('div', { class: 'cap' }, d.caption) : null);
    const stage = h('div'); box.append(stage);
    try { const c = d.mount(stage); if (typeof c === 'function') cleanups.push(c); } catch (e) { console.error('demo failed', e); stage.textContent = 'Demo failed to load.'; }
    const slot = bodyEl.querySelector(`[data-demo="${i}"]`);
    if (slot) slot.replaceWith(box); else bodyEl.append(box);
    return box;
  });
  const comps = ch.components || [];
  const links = h('div', { class: 'links' },
    ...comps.slice(0, 4).map((c) => h('a', { href: `/explore.html#c=${c}` }, `Open in 3D explorer: ${c}`)));
  const ripples = (ch.ripples || []).length ? h('div', { class: 'callout ripple' }, h('div', { class: 't' }, 'How it affects other components'),
    h('ul', ch.ripples.map((r) => { const li = h('li'); li.innerHTML = `<b>${r.to}</b>: ${r.text}`; return li; }))) : null;
  const refs = (ch.refs || []).length ? h('div', { class: 'refs' }, h('h2', 'References'), h('ul', ch.refs.map((r) => h('li', h('a', { href: r.url, target: '_blank', rel: 'noopener' }, r.title))))) : null;
  const doneBtn = h('button', { class: 'dbtn donebtn' }, '');
  const upd = () => { doneBtn.textContent = done.has(n) ? '✓ Completed (click to undo)' : 'Mark chapter complete'; doneBtn.classList.toggle('on', done.has(n)); };
  doneBtn.onclick = () => { done.has(n) ? done.delete(n) : done.add(n); saveDone(done); upd(); renderToc(n); };
  upd();
  main.replaceChildren(
    h('h1', `${n}. ${ch.title || TITLES[n]}`),
    h('div', { class: 'meta' }, `${ch.minutes || 15} min read · ${ch.cmu || ''}`),
    h('div', { class: 'goals' }, h('b', 'Learning goals'), h('ul', (ch.goals || []).map((g) => h('li', g)))),
    links, bodyEl,
    ch.tradeoffs ? h('div', null, h('h2', 'Trade-offs & alternatives'), table(ch.tradeoffs)) : null,
    ripples,
    ch.quiz ? quizEl(ch.quiz) : null,
    refs, doneBtn, nav(n));
}
function nav(n) {
  const p = n > 0 ? h('a', { class: 'dbtn', href: '#ch=' + (n - 1) }, '← ' + TITLES[n - 1]) : h('span');
  const x = n < TITLES.length - 1 ? h('a', { class: 'dbtn', href: '#ch=' + (n + 1) }, TITLES[n + 1] + ' →') : h('span');
  return h('div', { class: 'pager' }, p, x);
}
addEventListener('hashchange', () => show(parseHash()));
show(parseHash());
