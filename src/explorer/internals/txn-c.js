// txn-c.js (internals-E1): wal + recovery views
import * as THREE from 'three';
import { Kit, C, H, tablePlane } from './txn-kit.js';

const wrap = (s, n = 74) => {
  const out = []; let line = '';
  for (const w of s.split(' ')) { if ((line + ' ' + w).trim().length > n) { out.push(line); line = w; } else line = (line + ' ' + w).trim(); }
  if (line) out.push(line); return out.join('\n');
};
const css = n => typeof n === 'string' ? n : '#' + n.toString(16).padStart(6, '0');

// ======================================================================
// WAL
// ======================================================================
const WREC = [
  { lsn: 10, prev: '-', txn: 'T1', type: 'BEGIN', page: '-', before: '-', after: '-' },
  { lsn: 20, prev: 10, txn: 'T1', type: 'UPDATE', page: 'P5', before: 'bal=100', after: 'bal=90' },
  { lsn: 30, prev: '-', txn: 'T2', type: 'BEGIN', page: '-', before: '-', after: '-' },
  { lsn: 40, prev: 30, txn: 'T2', type: 'UPDATE', page: 'P7', before: 'qty=5', after: 'qty=4' },
  { lsn: 50, prev: 20, txn: 'T1', type: 'UPDATE', page: 'P5', before: 'st=N', after: 'st=Y' },
  { lsn: 60, prev: 50, txn: 'T1', type: 'COMMIT', page: '-', before: '-', after: '-' },
  { lsn: 70, prev: 40, txn: 'T2', type: 'COMMIT', page: '-', before: '-', after: '-' },
];
const TYPE_COL = { BEGIN: C.grey, UPDATE: C.blue, COMMIT: C.green };

let WAL = null;

function buildWal(ctx) {
  const kit = new Kit(ctx); const S = { n: 0, flushed: 0, fsyncs: 0, acked: 0, mode: 'group', pageDisk: 0, crashed: false, groupPending: false, breakWal: false, table: 'sf' };
  const X = i => -8.6 + i * 2.85, YR = 4.3, YD = 1.5;
  kit.box(20.2, 2.0, 0.1, 0x1b2038, 0, YR, -0.4); kit.box(20.2, 2.0, 0.1, 0x15281f, 0, YD, -0.4);
  kit.label('LOG BUFFER (RAM) - lost on crash', -6.3, YR + 1.3, 0, { size: 0.36, color: css(C.yellow) });
  kit.label('LOG FILE (disk) - durable after fsync', -5.8, YD + 1.3, 0, { size: 0.36, color: css(C.green) });
  const boxes = [];
  const stat = kit.label('', 5.5, YR + 1.3, 0, { size: 0.34, color: css(C.cyan) });
  // pages
  const bufPage = kit.box(4.2, 1.5, 0.4, C.blue, -7.6, -1.4, 0);
  const bufLab = kit.label('', 0, 0, 0.3, { size: 0.3, color: '#0b0d14' }, bufPage);
  const diskPage = kit.box(4.2, 1.5, 0.4, C.cyan, -7.6, -3.9, 0);
  const diskLab = kit.label('', 0, 0, 0.3, { size: 0.3, color: '#0b0d14' }, diskPage);
  kit.label('Buffer pool (RAM)', -7.6, -0.2, 0, { size: 0.3, color: css(C.dim) });
  kit.label('Data file (disk)', -7.6, -5.0, 0, { size: 0.3, color: css(C.dim) });
  const warn = kit.label('', -7.6, -5.7, 0, { size: 0.3, color: css(C.red) });
  const detail = tablePlane(kit, [['field', 'value'], ['LSN', ''], ['prevLSN', ''], ['txnId', ''], ['type', ''], ['pageId', ''], ['before', ''], ['after', '']], { cellW: 150, cellH: 36, font: 19, headCol: true });
  detail.position.set(-1.7, -3.1, 0); kit.add(detail);
  kit.label('Last log record', -1.7, -0.9, 0, { size: 0.32, color: css(C.dim) });
  // right-hand tables
  const sf = tablePlane(kit, [['', 'FORCE', 'NO-FORCE'], ['NO-STEAL', 'no undo/no redo', 'redo only'], ['STEAL', 'undo only', 'undo + redo']], { cellW: 190, cellH: 52, font: 20, headCol: true });
  const kinds = tablePlane(kit, [['log', 'level', 'contains', 'purpose'], ['redo (InnoDB)', 'engine', 'page changes', 'replay fwd'], ['undo (InnoDB)', 'engine', 'old versions', 'rollback+MVCC'], ['binlog (MySQL)', 'server', 'row/stmt events', 'replication,PITR'], ['WAL (Postgres)', 'storage', 'redo only', 'recovery+replica']], { cellW: 190, cellH: 44, font: 17, headCol: true });
  sf.position.set(6.6, -2.6, 0); kinds.position.set(5.6, -2.6, 0); kit.add(sf); kit.add(kinds);
  const tTitle = kit.label('', 6.2, -0.5, 0, { size: 0.32, color: css(C.dim) });

  const info = h => ctx.onInfo && ctx.onInfo(h);
  const flushedLSN = () => S.flushed ? WREC[S.flushed - 1].lsn : 0;
  const pageLSN = () => { let l = 0; for (let i = 0; i < S.n; i++) if (WREC[i].page === 'P5') l = WREC[i].lsn; return l; };
  function refresh() {
    kit.setLabel(stat, `fsyncs=${S.fsyncs}  commits acked=${S.acked}/2  flushedLSN=${flushedLSN()}`, { size: 0.34, color: css(C.cyan) });
    kit.setLabel(bufLab, `P5 (buffer pool)\npageLSN=${pageLSN()}${pageLSN() ? ' dirty' : ''}`, { size: 0.3, color: '#0b0d14' });
    const bad = S.pageDisk > flushedLSN();
    diskPage.material.color.setHex(bad ? C.red : C.cyan);
    kit.setLabel(diskLab, `P5 (disk)\npageLSN=${S.pageDisk}`, { size: 0.3, color: '#0b0d14' });
    kit.setLabel(warn, bad ? 'WAL VIOLATION: pageLSN > flushedLSN' : '', { size: 0.3, color: css(C.red) });
  }
  function showRec(r) {
    detail.userData.redraw([['field', 'value'], ['LSN', r.lsn], ['prevLSN', r.prev], ['txnId', r.txn], ['type', r.type], ['pageId', r.page], ['before', r.before], ['after', r.after]]);
  }
  function appendNext(instant) {
    if (S.crashed || S.n >= WREC.length) return;
    const r = WREC[S.n], i = S.n++;
    const b = kit.box(2.6, 1.3, 0.4, TYPE_COL[r.type], X(i), instant ? YR : YR + 2.5, 0, {}, kit.group);
    kit.label(`${r.lsn} ${r.txn}\n${r.type}${r.page !== '-' ? ' ' + r.page : ''}`, 0, 0, 0.3, { size: 0.29, color: '#0b0d14' }, b);
    boxes[i] = b; if (!instant) kit.move(b, [X(i), YR, 0], 0.5);
    showRec(r); refresh();
    info(`<b>Append LSN ${r.lsn}</b>: ${r.txn} ${r.type}. prevLSN chains this txn's records so undo can walk backwards. LSN = monotonically increasing byte offset in the log.`);
    if (r.type === 'COMMIT' && !instant) {
      if (S.mode === 'per') kit.at(kit.clock + 0.6, () => doFsync());
      else if (!S.groupPending) { S.groupPending = true; kit.at(kit.clock + 1.6, () => { S.groupPending = false; doFsync(); }); }
    }
  }
  function doFsync(instant) {
    if (S.crashed || S.flushed >= S.n) return;
    let commits = 0;
    for (let i = S.flushed; i < S.n; i++) { if (instant) boxes[i].position.y = YD; else kit.move(boxes[i], [X(i), YD, 0], 0.6); if (WREC[i].type === 'COMMIT') commits++; }
    S.flushed = S.n; S.fsyncs++; S.acked += commits; refresh();
    info(`<b>fsync(log)</b> - one sequential write makes records up to LSN ${flushedLSN()} durable. ${commits ? `It acknowledged <b>${commits}</b> commit(s) with a single fsync` + (commits > 1 ? ' = <b>group commit</b>.' : '.') : ''} Commit durability = log flushed, data pages need not be (NO-FORCE).`);
  }
  function writePage(raw) {
    const L = pageLSN(); if (!L) { info('Page P5 is clean - nothing to write.'); return; }
    const go = () => {
      S.pageDisk = L; refresh();
      const sp = kit.sphere(0.25, C.yellow, -7.6, -1.4, 0.6); kit.move(sp, [-7.6, -3.9, 0.6], 0.6); kit.at(kit.clock + 0.7, () => { sp.visible = false; });
      const unc = !(S.n >= 6 && L <= 50);
      info(`<b>Page P5 written</b> with pageLSN=${L}. ${unc ? '<b>STEAL</b>: T1 had not committed yet, so uncommitted data reached disk - the log must hold the before-image to undo it.' : 'T1 already committed - plain NO-FORCE flush at checkpoint/eviction time.'}`);
    };
    if (L > flushedLSN() && !S.breakWal && !raw) {
      info(`<b>Write-ahead rule</b>: pageLSN ${L} &gt; flushedLSN ${flushedLSN()} - the buffer manager must fsync the log up to ${L} BEFORE writing the page.`);
      doFsync(); kit.at(kit.clock + 0.8, go);
    } else go();
  }
  function crash() {
    if (S.crashed) return; S.crashed = true;
    for (let i = S.flushed; i < S.n; i++) { boxes[i].material.color.setHex(C.red); boxes[i].scale.setScalar(0.6); boxes[i].material.opacity = 0.5; boxes[i].material.transparent = true; }
    const lost = S.n - S.flushed, bad = S.pageDisk > flushedLSN();
    info(`<b>CRASH.</b> ${lost} unflushed log record(s) vanish with RAM. ` + (bad ? `<span style="color:#f7768e">Disk page P5 holds a change (LSN ${S.pageDisk}) whose log record is lost - it can neither be undone nor identified. Database corrupt: this is why the WAL rule exists.</span>` : `Disk log + data are consistent: every durable page change has its log record on disk. Commits never acknowledged are simply lost (safe).`));
  }
  function reset() {
    boxes.forEach(b => { if (b) { b.parent.remove(b); } }); boxes.length = 0;
    Object.assign(S, { n: 0, flushed: 0, fsyncs: 0, acked: 0, pageDisk: 0, crashed: false, groupPending: false });
    kit.timers = []; kit.clock = 0; showRec({ lsn: '', prev: '', txn: '', type: '', page: '', before: '', after: '' }); refresh();
  }
  function setTable(t) {
    S.table = t; sf.visible = t === 'sf'; kinds.visible = t === 'kinds';
    kit.setLabel(tTitle, t === 'sf' ? 'Buffer policy matrix (steal / force)' : 'Which log is which', { size: 0.32, color: css(C.dim) });
    tTitle.position.x = t === 'sf' ? 6.6 : 5.6;
    if (t === 'kinds') info('<b>Three logs</b>: <b>redo</b> (engine, physical/physiological, crash recovery), <b>undo</b> (old row versions: rollback + MVCC reads), <b>binlog</b> (server-level logical events for replication/PITR). InnoDB commits via internal 2PC: prepare redo -> write binlog -> commit redo, so both agree. Postgres has no undo log; old tuples stay in the heap.');
    colorSF(ctx.config && ctx.config.recovery);
  }
  function colorSF(rec) {
    const cell = rec === 'no-steal-force' ? [1, 1] : (rec === 'aries-steal-noforce' || !rec) ? [2, 2] : null;
    sf.userData.redraw(null, (i, j) => cell && i === cell[0] && j === cell[1] ? css(C.yellow) : null);
  }
  const speedRun = () => { reset(); WREC.forEach((_, i) => kit.at(0.3 + i * 0.8, () => appendNext(false))); };
  setTable('sf'); reset();
  WAL = { appendNext, doFsync, writePage, crash, reset, speedRun, setTable, S, kit };

  const steps = [
    { title: 'Anatomy of a log record', text: 'Each record has an LSN (byte offset), prevLSN (previous record of the same txn), txnId, type, pageId and before/after images.', run() { reset(); appendNext(true); appendNext(true); } },
    { title: 'Append to the log buffer', text: 'Records are appended sequentially to an in-RAM log buffer; nothing is durable yet.', run() { reset(); for (let i = 0; i < 5; i++) appendNext(true); } },
    { title: 'pageLSN links page to log', text: 'Every modified page stores the LSN of the last record that changed it (pageLSN=50). Recovery uses it to decide whether a redo is already applied.', run() { reset(); for (let i = 0; i < 5; i++) appendNext(true); } },
    { title: 'Write-ahead rule', text: 'Before page P5 (pageLSN=50) may go to disk the log must be durable up to LSN 50. Flush the page and watch the log fsync first.', run() { reset(); for (let i = 0; i < 5; i++) appendNext(true); writePage(); } },
    { title: 'Commit = log fsync', text: 'COMMIT is durable once its record is on disk. Data pages stay dirty in RAM (NO-FORCE).', run() { reset(); for (let i = 0; i < 6; i++) appendNext(true); doFsync(true); } },
    { title: 'Group commit', text: 'Two commits arrive close together and share ONE fsync. Compare with the "fsync per commit" mode (2 fsyncs).', run() { reset(); S.mode = 'group'; speedRun(); } },
    { title: 'Steal / force matrix', text: 'Highlighted cell = policy of the chosen recovery scheme. STEAL needs undo info, NO-FORCE needs redo info.', run() { setTable('sf'); } },
    { title: 'Redo vs undo vs binlog', text: 'Different logs, different jobs: engine redo, engine undo, server binlog.', run() { setTable('kinds'); } },
  ];
  return {
    group: kit.group, steps,
    update(dt) { kit.tick(dt); },
    onConfigChange(c) { colorSF(c.recovery); },
    dispose() { kit.dispose(); WAL = null; },
  };
}

const walControls = [
  { id: 'append', label: 'Append next log record', type: 'button', onChange() { WAL && WAL.appendNext(false); } },
  { id: 'fsync', label: 'fsync log (flush buffer)', type: 'button', onChange() { WAL && WAL.doFsync(false); } },
  { id: 'flushpage', label: 'Flush dirty page P5', type: 'button', onChange() { WAL && WAL.writePage(); } },
  { id: 'cmode', label: 'Commit mode', type: 'select', options: [{ value: 'group', label: 'group commit' }, { value: 'per', label: 'fsync per commit' }], value: 'group', onChange(v) { if (WAL) WAL.S.mode = v; } },
  { id: 'breakwal', label: 'Break WAL rule (page before log)', type: 'toggle', value: false, onChange(v) { if (WAL) WAL.S.breakWal = v; } },
  { id: 'run', label: 'Run whole script', type: 'button', onChange() { WAL && WAL.speedRun(); } },
  { id: 'crash', label: 'Crash now', type: 'button', onChange() { WAL && WAL.crash(); } },
  { id: 'reset', label: 'Reset', type: 'button', onChange() { WAL && WAL.reset(); } },
  { id: 'table', label: 'Table', type: 'select', options: [{ value: 'sf', label: 'steal/force matrix' }, { value: 'kinds', label: 'redo/undo/binlog' }], value: 'sf', onChange(v) { WAL && WAL.setTable(v); } },
];

// ======================================================================
// RECOVERY
// ======================================================================
const BASE_LOG = [
  { lsn: 10, txn: 'T1', type: 'UPDATE', page: 'P1', link: 'prev=-' },
  { lsn: 20, txn: 'T2', type: 'UPDATE', page: 'P2', link: 'prev=-' },
  { lsn: 30, txn: '', type: 'CKPT_BEGIN', page: '', link: '' },
  { lsn: 40, txn: '', type: 'CKPT_END', page: '', link: 'ATT+DPT' },
  { lsn: 50, txn: 'T1', type: 'UPDATE', page: 'P3', link: 'prev=10' },
  { lsn: 60, txn: 'T2', type: 'COMMIT', page: '', link: 'prev=20' },
  { lsn: 70, txn: 'T2', type: 'END', page: '', link: 'prev=60' },
  { lsn: 80, txn: 'T3', type: 'UPDATE', page: 'P2', link: 'prev=-' },
  { lsn: 90, txn: 'T1', type: 'UPDATE', page: 'P1', link: 'prev=50' },
];

function simulate() {
  const F = []; let log = BASE_LOG.map(r => ({ ...r }));
  let att = [], dpt = [], disk = { P1: 10, P2: 0, P3: 0 }, toUndo = [];
  let flash = null;
  const push = (phase, cursor, note, extra = {}) => F.push(JSON.parse(JSON.stringify({ phase, cursor, note, att, dpt, disk, log, toUndo, flash: extra.flash || null, mark: extra.mark || '' })));
  push('CRASH', null, 'CRASH. RAM is gone: buffer pool, lock table, ATT and DPT. Surviving: the log and data pages as they happened to be on disk (P1 pageLSN=10, P2 and P3 older). The master record points to the last checkpoint (LSN 30/40).');
  att = [{ txn: 'T1', st: 'U', last: 10 }, { txn: 'T2', st: 'U', last: 20 }]; dpt = [{ page: 'P1', rec: 10 }, { page: 'P2', rec: 20 }];
  push('ANALYSIS', 40, 'ANALYSIS (forward from checkpoint). Load the ATT and DPT saved in CKPT_END: T1 and T2 were active, P1 and P2 were dirty.');
  const A = (t) => att.find(a => a.txn === t);
  const addDpt = (p, l) => { if (!dpt.find(d => d.page === p)) dpt.push({ page: p, rec: l }); };
  A('T1').last = 50; addDpt('P3', 50); push('ANALYSIS', 50, 'LSN 50 UPDATE P3 by T1: ATT[T1].lastLSN=50. P3 not in DPT, so add it with recLSN=50 (first LSN that dirtied it).');
  A('T2').st = 'C'; A('T2').last = 60; push('ANALYSIS', 60, 'LSN 60 COMMIT T2: status becomes C (committed). Not a loser, even though END was not yet written.');
  att = att.filter(a => a.txn !== 'T2'); push('ANALYSIS', 70, 'LSN 70 END T2: T2 is complete, remove from ATT.');
  att.push({ txn: 'T3', st: 'U', last: 80 }); addDpt('P2', 80); push('ANALYSIS', 80, 'LSN 80 UPDATE P2 by T3: new ATT entry T3. P2 already in DPT (recLSN stays 20 - the OLDEST change that may be missing on disk).');
  A('T1').last = 90; push('ANALYSIS', 90, 'LSN 90 UPDATE P1 by T1: ATT[T1].lastLSN=90. End of log reached.');
  toUndo = [90, 80]; push('ANALYSIS', null, 'Analysis done. Losers (no COMMIT): T1(last 90), T3(last 80). DPT: P1:10, P2:20, P3:50. RedoLSN = min(recLSN) = 10.');
  const redo = (lsn, page, txt, flashPage, apply) => { push('REDO', lsn, txt, { flash: apply ? page : null }); };
  const rd = [[10, 'P1'], [20, 'P2'], [50, 'P3'], [80, 'P2'], [90, 'P1']];
  for (const [l, p] of rd) {
    const d = dpt.find(x => x.page === p);
    if (!d || l < d.rec) { push('REDO', l, `LSN ${l} ${p}: not needed (before recLSN).`); continue; }
    if (disk[p] >= l) { push('REDO', l, `LSN ${l} ${p}: in DPT and recLSN ${d.rec} &lt;= ${l}, but disk pageLSN=${disk[p]} &gt;= ${l} - the change already reached disk. SKIP.`); continue; }
    disk[p] = l; push('REDO', l, `LSN ${l} ${p}: in DPT, recLSN ${d.rec} &lt;= ${l}, disk pageLSN &lt; ${l} - REDO the change, set pageLSN=${l}. Redo repeats history, even for loser txns.`, { flash: p });
  }
  push('REDO', null, 'Redo done: database is exactly as at the crash instant, including the changes of loser transactions T1 and T3.');
  const clr = (lsn, txn, page, undoNext, undone) => log.push({ lsn, txn, type: 'CLR', page, link: undoNext == null ? 'undoNext=-' : `undoNext=${undoNext}` });
  const end = (lsn, txn) => log.push({ lsn, txn, type: 'END', page: '', link: '' });
  clr(100, 'T1', 'P1', 50); toUndo = [80, 50]; A('T1').last = 100; disk.P1 = 100;
  push('UNDO', 90, 'UNDO (backward, largest LSN first). Take 90 (T1 P1): write CLR 100 describing the compensation, undoNext=prevLSN=50. Apply it: P1 pageLSN=100. CLRs are redo-only, never undone.', { flash: 'P1' });
  clr(110, 'T3', 'P2', null); toUndo = [50]; disk.P2 = 110;
  push('UNDO', 80, 'Next largest: 80 (T3 P2). CLR 110, undoNext=- (T3 first record) so T3 is fully undone.', { flash: 'P2' });
  end(120, 'T3'); att = att.filter(a => a.txn !== 'T3'); push('UNDO', 110, 'T3 has nothing left: write END 120, drop from ATT.');
  clr(130, 'T1', 'P3', 10); toUndo = [10]; disk.P3 = 130; A('T1').last = 130;
  push('UNDO', 50, 'Next: 50 (T1 P3). CLR 130, undoNext=10. If we crash again here, recovery will redo these CLRs and continue from undoNext - no work is repeated.', { flash: 'P3' });
  clr(140, 'T1', 'P1', null); toUndo = []; disk.P1 = 140;
  push('UNDO', 10, 'Last: 10 (T1 P1). CLR 140, undoNext=-.', { flash: 'P1' });
  end(150, 'T1'); att = []; push('DONE', null, 'END T1. ATT empty: all losers rolled back. Database is transaction-consistent; new transactions may start.');
  return F;
}

let REC = null;
const SCHEMES = [
  { value: 'aries-steal-noforce', label: 'ARIES (steal, no-force)' },
  { value: 'shadow-cow', label: 'Shadow paging / COW' },
  { value: 'command-logging', label: 'Command logging' },
  { value: 'no-steal-force', label: 'No-steal / force' },
];

function buildRecovery(ctx) {
  const kit = new Kit(ctx); const frames = simulate(); const R = { f: 0, auto: false, acc: 0, scheme: (ctx.config && ctx.config.recovery) || 'aries-steal-noforce' };
  const info = h => ctx.onInfo && ctx.onInfo(h);
  const aries = new THREE.Group(); kit.group.add(aries);
  // phase bar
  const phases = ['ANALYSIS', 'REDO', 'UNDO'], pBox = {};
  phases.forEach((p, i) => {
    const b = kit.box(3.6, 0.9, 0.3, C.panel, -3.6 + i * 4, 5.4, 0, {}, aries); pBox[p] = b;
    kit.label(p, 0, 0, 0.3, { size: 0.4 }, b);
    if (i < 2) kit.arrow([-1.6 + i * 4, 5.4, 0], [-0.55 + i * 4 - 0.1, 5.4, 0], C.edge, aries);
  });
  kit.label('fwd from ckpt', -3.6, 4.65, 0, { size: 0.26, color: css(C.dim) }, aries);
  kit.label('fwd from min recLSN', 0.4, 4.65, 0, { size: 0.26, color: css(C.dim) }, aries);
  kit.label('backward via prevLSN/undoNext', 4.4, 4.65, 0, { size: 0.26, color: css(C.dim) }, aries);
  const phaseCol = { ANALYSIS: C.blue, REDO: C.yellow, UNDO: C.red };
  kit.label('LOG (stable storage)', -7.1, 3.85, 0, { size: 0.32, color: css(C.dim) }, aries);
  const logT = tablePlane(kit, Array.from({ length: 16 }, () => ['LSN', 'Txn', 'Type', 'Page', 'link']), { cellW: 118, cellH: 32, font: 16 }); logT.position.set(-7.1, 0.2, 0); aries.add(logT);
  const attT = tablePlane(kit, Array.from({ length: 5 }, () => ['Txn', 'Status', 'lastLSN']), { cellW: 118, cellH: 36, font: 17 }); attT.position.set(1.5, 2.1, 0); aries.add(attT);
  const dptT = tablePlane(kit, Array.from({ length: 5 }, () => ['Page', 'recLSN', 'disk pgLSN']), { cellW: 118, cellH: 36, font: 17 }); dptT.position.set(7.0, 2.1, 0); aries.add(dptT);
  kit.label('Transaction table (ATT)', 1.5, 3.85, 0, { size: 0.32, color: css(C.dim) }, aries);
  kit.label('Dirty page table (DPT)', 7.0, 3.85, 0, { size: 0.32, color: css(C.dim) }, aries);
  const undoL = kit.label('', 4.3, -0.55, 0, { size: 0.34, color: css(C.red) }, aries);
  const scan = kit.box(7.2, 0.36, 0.1, C.yellow, -7.1, 0, 0.1, { opacity: 0.35 }, aries); scan.visible = false;
  const pg = {};
  ['P1', 'P2', 'P3'].forEach((p, i) => {
    const b = kit.box(2.4, 1.2, 0.4, C.cyan, 0.4 + i * 3.2, -2.5, 0, {}, aries); const l = kit.label('', 0, 0, 0.3, { size: 0.3, color: '#0b0d14' }, b); pg[p] = { b, l };
  });
  kit.label('Data pages on disk', 3.6, -1.6, 0, { size: 0.3, color: css(C.dim) }, aries);
  const noteL = kit.label('', 1.2, -5.0, 0, { size: 0.34, color: css(C.text) }, aries);
  const rowY0 = 0.2 + 16 * 0.192 - 0.192 * 1.5, rowH = 32 * 0.012;

  function show() {
    const f = frames[R.f];
    const rows = [['LSN', 'Txn', 'Type', 'Page', 'link']];
    for (let i = 0; i < 15; i++) { const r = f.log[i]; rows.push(r ? [r.lsn, r.txn, r.type, r.page, r.link] : ['', '', '', '', '']); }
    logT.userData.redraw(rows, (i, j) => { if (i === 0) return null; const r = f.log[i - 1]; if (!r) return null; if (f.cursor === r.lsn) return css(C.yellow); if (r.type === 'CLR') return css(C.green); return null; });
    const a = [['Txn', 'Status', 'lastLSN']]; f.att.forEach(x => a.push([x.txn, x.st === 'C' ? 'COMMITTED' : 'UNDO-cand', x.last])); while (a.length < 5) a.push(['', '', '']); attT.userData.redraw(a);
    const d = [['Page', 'recLSN', 'disk pgLSN']]; f.dpt.forEach(x => d.push([x.page, x.rec, f.disk[x.page]])); while (d.length < 5) d.push(['', '', '']); dptT.userData.redraw(d, (i, j) => (i > 0 && j === 2 && f.flash === d[i][0]) ? css(C.yellow) : null);
    const idx = f.cursor == null ? -1 : f.log.findIndex(r => r.lsn === f.cursor);
    scan.visible = idx >= 0; if (idx >= 0) scan.position.y = 0.2 + 16 * 0.192 - (idx + 1.5) * 0.384;
    for (const p of phases) { pBox[p].material.color.setHex(f.phase === p ? phaseCol[p] : C.panel); }
    for (const p of ['P1', 'P2', 'P3']) { kit.setLabel(pg[p].l, `${p}\npageLSN=${f.disk[p]}`, { size: 0.3, color: '#0b0d14' }); pg[p].b.material.color.setHex(f.flash === p ? C.yellow : C.cyan); }
    kit.setLabel(undoL, f.phase === 'UNDO' || f.toUndo.length ? `ToUndo = {${f.toUndo.join(', ')}}` : f.phase === 'ANALYSIS' || f.phase === 'CRASH' ? '' : '', { size: 0.34, color: css(C.red) });
    kit.setLabel(noteL, wrap(f.note.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/<[^>]+>/g, ''), 80), { size: 0.33, color: css(C.text) });
    info(`<b>${f.phase}</b> (${R.f + 1}/${frames.length}) - ${f.note}`);
  }
  // scan bar row placement computed explicitly: header row 0 at top
  scan.position.x = -7.1;
  // ---------- alternate schemes ----------
  const alts = {};
  function phaser(n, dur, apply) { let t = 0, k = -1; return { reset() { t = 0; k = -1; }, tick(dt) { t += dt; const kk = Math.floor(t / dur) % n; if (kk !== k) { k = kk; apply(k); } } }; }
  const altNote = kit.label('', 0, -5.0, 0, { size: 0.36 });
  const altTitle = kit.label('', 0, 5.6, 0, { size: 0.5, color: css(C.yellow) });
  const cmp = tablePlane(kit, [['scheme', 'undo log', 'redo log', 'commit cost', 'recovery work'], ['ARIES', 'yes (steal)', 'yes (no-force)', '1 seq log fsync', 'redo+undo, fast'], ['shadow/COW', 'no', 'no', 'random writes+swap', 'none (discard)'], ['command log', 'no', 'cmds only', 'tiny log append', 'replay all cmds'], ['no-steal/force', 'no', 'maybe (torn force)', 'force all dirty pages', 'little']], { cellW: 215, cellH: 30, font: 15, headCol: true });
  cmp.position.set(0, -3.55, 0); kit.add(cmp);
  const setAlt = (txt) => kit.setLabel(altNote, wrap(txt, 78), { size: 0.34 });

  function mkShadow() {
    const g = new THREE.Group(); kit.group.add(g);
    kit.label('SHADOW table (on disk)', -8, 4.0, 0, { size: 0.32, color: css(C.green) }, g);
    kit.label('CURRENT table (in RAM)', 5, 4.0, 0, { size: 0.32, color: css(C.yellow) }, g);
    const ys = [3.0, 1.9, 0.8, -0.3];
    const master = kit.box(3.2, 0.7, 0.3, C.purple, -1.5, 5.0, 0, {}, g); kit.label('master root', 0, 0, 0.3, { size: 0.32, color: '#0b0d14' }, master);
    const sh = [], cu = [], bl = [];
    ['1', '2', '3'].forEach((s, i) => { kit.box(2.4, 0.75, 0.3, C.green, -8, ys[i], 0, {}, g); kit.label('slot ' + s, -8, ys[i], 0.3, { size: 0.3, color: '#0b0d14' }, g); const c = kit.box(2.4, 0.75, 0.3, C.yellow, 5, ys[i], 0, {}, g); kit.label('slot ' + s, 5, ys[i], 0.3, { size: 0.3, color: '#0b0d14' }, g); });
    const names = ['blk1: P1 v1', 'blk2: P2 v1', 'blk3: P3 v1', 'blk4: P2 v2 (new)']; const blk = [];
    names.forEach((n, i) => { const b = kit.box(3.2, 0.75, 0.3, C.cyan, -1.5, ys[i], 0, {}, g); kit.label(n, 0, 0, 0.3, { size: 0.28, color: '#0b0d14' }, b); blk.push(b); });
    for (let i = 0; i < 3; i++) { sh.push(kit.arrow([-6.8, ys[i], 0], [-3.1, ys[i], 0], C.green, g)); cu.push(kit.arrow([3.8, ys[i], 0], [0.1, ys[i], 0], C.yellow, g)); }
    const cuNew = kit.arrow([3.8, ys[1], 0], [0.1, ys[3] + 0.1, 0], C.yellow, g);
    const mS = kit.arrow([-2.5, 4.65, 0], [-6.6, 3.65, 0], C.purple, g), mC = kit.arrow([-0.5, 4.65, 0], [3.6, 3.65, 0], C.purple, g);
    const ph = phaser(5, 3.4, k => {
      cu[1].visible = k < 1 || k === 4 && false; cuNew.visible = k >= 1; cu[1].visible = k < 1;
      blk[3].visible = k >= 1; mS.visible = k < 3; mC.visible = k >= 3;
      blk[1].material.color.setHex(k === 4 ? C.grey : C.cyan);
      setAlt([
        'T begins: shadow table = copy of the current table; both point at the same blocks. Master root -> shadow (the last committed state).',
        'UPDATE P2: never overwrite blk2. Copy-on-write the page into free blk4; only the CURRENT table slot 2 is redirected.',
        'CRASH here: RAM (current table) is lost, master still points at the shadow table - the old consistent state. No undo, no redo, no log scan.',
        'COMMIT: fsync the new pages, then atomically overwrite the master root (one sector write) -> current table becomes the committed state.',
        'Old blk2 is garbage to reclaim. Costs: random writes, fragmented data, hard to share across concurrent txns (System R dropped it; LMDB / BoltDB / CouchDB use COW roots).'][k]);
      info('<b>Shadow paging / copy-on-write</b>: atomicity via one atomic pointer swap instead of a log.');
    });
    return { g, ph };
  }
  function mkCmd() {
    const g = new THREE.Group(); kit.group.add(g);
    const cmds = ['transfer(A,B,10)', 'transfer(B,A,5)', 'deposit(A,20)'], st = ['A=100 B=50', 'A=90 B=60', 'A=95 B=55', 'A=115 B=55'];
    kit.label('SNAPSHOT @ checkpoint', -7.5, 3.6, 0, { size: 0.32, color: css(C.green) }, g);
    kit.box(4.0, 1.0, 0.3, C.green, -7.5, 2.6, 0, {}, g); kit.label('A=100  B=50', -7.5, 2.6, 0.3, { size: 0.38, color: '#0b0d14' }, g);
    kit.label('COMMAND LOG (name + params)', -0.5, 3.6, 0, { size: 0.32, color: css(C.yellow) }, g);
    const cb = cmds.map((c, i) => { const b = kit.box(5.4, 0.8, 0.3, C.blue, -0.5, 2.6 - i * 1.0, 0, {}, g); kit.label(`LSN ${i + 1}: ${c}`, 0, 0, 0.3, { size: 0.32, color: '#0b0d14' }, b); return b; });
    kit.label('MEMORY STATE', 7, 3.6, 0, { size: 0.32, color: css(C.cyan) }, g);
    const mem = kit.box(4.6, 1.2, 0.3, C.cyan, 7, 2.4, 0, {}, g); const ml = kit.label('', 0, 0, 0.3, { size: 0.38, color: '#0b0d14' }, mem);
    const arrS = kit.arrow([-5.3, 2.6, 0], [-3.4, 2.6, 0], C.green, g), arrR = kit.arrow([2.4, 1.6, 0], [4.7, 2.2, 0], C.yellow, g);
    const ph = phaser(7, 3.0, k => {
      cb.forEach((b, i) => b.material.color.setHex(k >= 3 && i === k - 3 ? C.yellow : C.blue));
      mem.material.color.setHex(k === 1 ? C.red : C.cyan); arrS.visible = k === 2; arrR.visible = k >= 3 && k <= 5;
      const s = k === 0 ? st[3] : k === 1 ? 'A=?  B=?  (lost)' : k === 2 ? st[0] : k <= 5 ? st[k - 2] : st[3];
      kit.setLabel(ml, s, { size: 0.38, color: '#0b0d14' });
      setAlt([
        'Normal run: append only the command (procedure name + args, ~30 B) to the log, then execute. No before/after images, no undo log; ARIES would log each changed row.',
        'CRASH: in-memory state is lost.', 'Recovery step 1: load the latest snapshot / checkpoint.',
        'Step 2: replay command 1 in original log order.', 'Replay command 2.', 'Replay command 3.',
        'State rebuilt. Needs DETERMINISM: serial or deterministic execution, no rand()/now(), same order (H-Store/VoltDB, Malviya et al. 2014). Replay is slow, so snapshots are frequent.'][k]);
      info('<b>Command logging</b> (VoltDB/H-Store): log transactions as logical commands, recover by snapshot + deterministic replay. Tiny logging cost, slow recovery.');
    });
    return { g, ph };
  }
  function mkNSF() {
    const g = new THREE.Group(); kit.group.add(g);
    kit.box(10, 4.6, 0.1, 0x1b2038, -4.5, 2.0, -0.3, {}, g); kit.box(7, 4.6, 0.1, 0x15281f, 6.2, 2.0, -0.3, {}, g);
    kit.label('BUFFER POOL (RAM)', -4.5, 4.6, 0, { size: 0.34, color: css(C.yellow) }, g); kit.label('DISK', 6.2, 4.6, 0, { size: 0.34, color: css(C.green) }, g);
    const bp = [-7, -2].map(x => { const b = kit.box(3.6, 1.6, 0.4, C.cyan, x, 2.8, 0, {}, g); const l = kit.label('', 0, 0, 0.3, { size: 0.3, color: '#0b0d14' }, b); return { b, l }; });
    const dp = [4.5, 8].map(x => { const b = kit.box(3.0, 1.6, 0.4, C.cyan, x, 2.8, 0, {}, g); const l = kit.label('', 0, 0, 0.3, { size: 0.3, color: '#0b0d14' }, b); return { b, l }; });
    const lock = kit.label('', -4.5, 0.6, 0.4, { size: 0.36, color: css(C.red) }, g);
    const sp = [kit.sphere(0.25, C.yellow, -7, 2.8, 0.6, g), kit.sphere(0.25, C.yellow, -2, 2.8, 0.6, g)]; sp.forEach(s => s.visible = false);
    const ph = phaser(5, 3.2, k => {
      const dirty = k < 3; sp.forEach((s, i) => { s.visible = k === 3; s.position.set(i ? -2 : -7, 2.8, 0.6); if (k === 3) kit.move(s, [i ? 8 : 4.5, 2.8, 0.6], 2.0); });
      bp.forEach((p, i) => { p.b.material.color.setHex(k === 2 ? C.grey : dirty && k < 3 ? C.yellow : C.cyan); kit.setLabel(p.l, k === 2 ? 'RAM lost' : `P${i + 1} ${dirty ? 'dirty (T1)\nPINNED' : 'v2 clean'}`, { size: 0.3, color: '#0b0d14' }); });
      dp.forEach((p, i) => { kit.setLabel(p.l, `P${i + 1} ${k >= 4 || k === 3 ? 'v2' : 'v1'}`, { size: 0.3, color: '#0b0d14' }); p.b.material.color.setHex(k >= 3 ? C.green : C.cyan); });
      kit.setLabel(lock, k === 1 ? 'evict P1?  DENIED (no-steal)' : '', { size: 0.36, color: css(C.red) });
      setAlt([
        'T1 updates P1 and P2 in the buffer pool only. NO-STEAL: pages dirtied by an uncommitted txn are pinned and may not be written. Disk still holds committed v1.',
        'Buffer pressure: the pool wants to evict P1 but cannot - dirty uncommitted data would reach disk. Working set of ALL active txns must fit in RAM.',
        'CRASH before commit: the disk never saw uncommitted data, so there is nothing to undo. No undo log is needed.',
        'COMMIT with FORCE: write every page the txn dirtied to disk before acknowledging. Many random writes on the commit path.',
        'Danger: a crash between forcing P1 and P2 leaves a torn commit, so real systems still need atomic force (shadow pages or a small redo/commit log). Simple but slow; fine for small embedded/in-memory workloads.'][k]);
      info('<b>No-steal / force</b>: simplest recovery, no undo and (ideally) no redo, paid for with memory pressure and random writes at commit.');
    });
    return { g, ph };
  }
  alts['shadow-cow'] = mkShadow(); alts['command-logging'] = mkCmd(); alts['no-steal-force'] = mkNSF();
  const titles = { 'shadow-cow': 'Shadow paging / copy-on-write recovery', 'command-logging': 'Command logging recovery', 'no-steal-force': 'No-steal / force recovery' };
  function applyScheme() {
    const isA = R.scheme === 'aries-steal-noforce' || !alts[R.scheme];
    aries.visible = isA; cmp.visible = !isA; altNote.visible = !isA; altTitle.visible = !isA;
    for (const k in alts) { alts[k].g.visible = k === R.scheme; if (k === R.scheme) alts[k].ph.reset(); }
    if (isA) show(); else kit.setLabel(altTitle, titles[R.scheme], { size: 0.5, color: css(C.yellow) });
  }
  applyScheme();
  REC = { R, frames, show, applyScheme, next() { R.f = Math.min(frames.length - 1, R.f + 1); show(); }, restart() { R.f = 0; show(); }, set(i) { R.f = i; show(); }, kit };
  const idx = (ph, nth = 0) => frames.map((f, i) => f.phase === ph ? i : -1).filter(i => i >= 0)[nth];
  const steps = [
    { title: 'Crash: what survives', text: 'Only the log and whatever pages reached disk; ATT, DPT, buffer pool are gone.', run() { R.scheme = 'aries-steal-noforce'; applyScheme(); REC.set(0); } },
    { title: 'Analysis: rebuild ATT & DPT', text: 'Start at the checkpoint, scan forward, reconstruct active txns and dirty pages.', run() { R.scheme = 'aries-steal-noforce'; applyScheme(); REC.set(idx('ANALYSIS', 0)); } },
    { title: 'Analysis result: losers & redoLSN', text: 'Losers = T1, T3. RedoLSN = min recLSN = 10.', run() { R.scheme = 'aries-steal-noforce'; applyScheme(); REC.set(idx('ANALYSIS', 7)); } },
    { title: 'Redo: repeat history', text: 'Replay every logged change whose page is in the DPT and whose pageLSN is older; skip the rest.', run() { R.scheme = 'aries-steal-noforce'; applyScheme(); REC.set(idx('REDO', 1)); } },
    { title: 'Undo with CLRs', text: 'Walk losers backwards writing compensation log records with undoNext pointers.', run() { R.scheme = 'aries-steal-noforce'; applyScheme(); REC.set(idx('UNDO', 0)); } },
    { title: 'Recovered', text: 'All losers ended; ATT empty.', run() { R.scheme = 'aries-steal-noforce'; applyScheme(); REC.set(frames.length - 1); } },
    { title: 'Alternative: shadow paging', text: 'Atomic root swap replaces the log.', run() { R.scheme = 'shadow-cow'; applyScheme(); } },
    { title: 'Alternative: command log / no-steal-force', text: 'Switch with the Scheme control or the recovery slot.', run() { R.scheme = 'command-logging'; applyScheme(); } },
  ];
  return {
    group: kit.group, steps,
    update(dt) {
      kit.tick(dt);
      if (R.scheme === 'aries-steal-noforce' || !alts[R.scheme]) { if (R.auto && R.f < frames.length - 1) { R.acc += dt; if (R.acc > 1.8) { R.acc = 0; REC.next(); } } }
      else alts[R.scheme].ph.tick(dt);
    },
    onConfigChange(c) { if (c.recovery && c.recovery !== R.scheme) { R.scheme = c.recovery; applyScheme(); } },
    dispose() { kit.dispose(); REC = null; },
  };
}

const recControls = [
  { id: 'scheme', label: 'Recovery scheme', type: 'select', options: SCHEMES, value: 'aries-steal-noforce', onChange(v) { if (REC) { REC.R.scheme = v; REC.applyScheme(); } } },
  { id: 'next', label: 'Next recovery action', type: 'button', onChange() { REC && REC.next(); } },
  { id: 'auto', label: 'Auto-play', type: 'toggle', value: false, onChange(v) { if (REC) REC.R.auto = v; } },
  { id: 'restart', label: 'Restart from crash', type: 'button', onChange() { REC && REC.restart(); } },
];

export const views = {
  wal: { build: buildWal, controls: walControls },
  recovery: { build: buildRecovery, controls: recControls },
};
