// Small fallback dataset so the explorer works before the real data files exist.
const comp = (id, name, layer, extra = {}) => ({
  id, name, layer, oltpOlap: 'both',
  summary: `${name} is a core part of the ${layer} layer. (fixture data)`,
  responsibility: `turns inputs into outputs for ${name}`,
  internals: [{ name: 'Input stage', desc: 'receives work' }, { name: 'Core logic', desc: 'does the work' }, { name: 'Output stage', desc: 'emits results' }],
  keyIdeas: ['Fixture idea one', 'Fixture idea two', 'Fixture idea three'],
  impacts: [{ with: 'executor', how: 'Shapes how the executor is fed.' }, { with: 'buffer-pool', how: 'Changes page access patterns.' }],
  systems: { postgres: 'Fixture note.', 'mysql-innodb': 'Fixture note.', duckdb: 'Fixture note.', sqlite: 'Fixture note.' },
  slots: [], refs: [{ title: 'CMU 15-445', url: 'https://15445.courses.cs.cmu.edu/' }], ...extra,
});
const edge = (from, to, kind, label) => ({ id: `${from}>${to}`, from, to, kind, label,
  iface: { signature: `${label.toLowerCase()}(from: ${from}): ${to}Input`, payload: `{ "${label}": "example" }`, notes: 'Synchronous call in the fixture.' } });
const opt = (id, label, m, extra = {}) => ({ id, label, summary: `${label} summary (fixture).`, pros: ['Fast'], cons: ['Complex'], usedBy: ['postgres'],
  metrics: { pointRead: m[0], rangeScan: m[1], writeThroughput: m[2], analyticScan: m[3], spaceEfficiency: m[4], concurrency: m[5], simplicity: m[6] }, effects: [], research: [], ...extra });

export default {
  components: [
    comp('client', 'Client', 'client'), comp('parser', 'Parser', 'frontend'), comp('binder', 'Binder', 'frontend'),
    comp('optimizer', 'Optimizer', 'planning'), comp('executor', 'Executor', 'execution'), comp('wal', 'WAL', 'txn'),
    comp('buffer-pool', 'Buffer Pool', 'storage', { slots: ['buffer-eviction'] }), comp('btree', 'B+Tree', 'storage', { slots: ['index-structure'] }),
  ],
  edges: [
    edge('client', 'parser', 'network', 'SQL'), edge('parser', 'binder', 'control', 'AST'), edge('binder', 'optimizer', 'control', 'BoundAST'),
    edge('optimizer', 'executor', 'control', 'Plan'), edge('executor', 'btree', 'data', 'Lookup'), edge('btree', 'buffer-pool', 'data', 'PageReq'),
    edge('executor', 'wal', 'log', 'LogRec'), edge('btree', 'executor', 'data', 'Tuples'),
  ],
  flows: [{ id: 'fixture-select', title: 'Point select (fixture)', workload: 'OLTP', sql: 'SELECT * FROM t WHERE id=1', description: 'A tiny fixture flow.',
    steps: [
      { edge: 'client>parser', label: 'Send SQL', payload: 'SELECT ...', note: 'text over wire' }, { edge: 'parser>binder', label: 'AST', payload: 'Select(t)', note: '' },
      { edge: 'binder>optimizer', label: 'Bound', payload: 'BoundSelect', note: '' }, { edge: 'optimizer>executor', label: 'Plan', payload: 'IndexScan', note: '' },
      { edge: 'executor>btree', label: 'Lookup', payload: 'key=1', note: '' }, { edge: 'btree>buffer-pool', label: 'Fetch page', payload: 'page 42', note: '' },
      { edge: 'btree>executor', label: 'Tuple', payload: '(1,"a")', note: '' } ] }],
  slots: [
    { id: 'index-structure', title: 'Index structure', component: 'btree', also: ['buffer-pool'], question: 'How is the primary index organised?', default: 'bplustree',
      options: [opt('bplustree', 'B+Tree', [4, 5, 2, 2, 3, 3, 4], { usedBy: ['postgres', 'mysql-innodb'] }),
        opt('lsm', 'LSM-tree', [3, 3, 5, 3, 4, 3, 2], { usedBy: ['rocksdb'], effects: [{ target: 'btree', change: 'compaction thread appears' }, { target: 'wal', change: 'WAL feeds memtable' }] })] },
    { id: 'buffer-eviction', title: 'Buffer eviction', component: 'buffer-pool', also: [], question: 'Which page to evict?', default: 'lru',
      options: [opt('lru', 'LRU', [3, 3, 3, 2, 3, 2, 4]), opt('clock', 'Clock', [3, 3, 3, 3, 3, 4, 5], { usedBy: ['postgres'] })] },
  ],
  rules: [{ id: 'fx1', when: { slot: 'index-structure', option: 'lsm' }, with: { slot: 'buffer-eviction', option: 'clock' }, type: 'synergy', note: 'Fixture rule.' }],
  systems: [
    { id: 'postgres', name: 'PostgreSQL', category: 'OLTP', choices: { 'index-structure': 'bplustree', 'buffer-eviction': 'clock' } },
    { id: 'rocksdb', name: 'RocksDB', category: 'embedded', choices: { 'index-structure': 'lsm', 'buffer-eviction': 'lru' } },
  ],
};
