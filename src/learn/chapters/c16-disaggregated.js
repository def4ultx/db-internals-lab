import { h, slider, C } from '../kit.js';

function mount(el) {
  const sz = slider({ label: 'scan size (GB)', min: 1, max: 2000, value: 200, onInput: draw });
  const hit = slider({ label: 'local cache hit %', min: 0, max: 100, value: 70, fmt: (v) => v + '%', onInput: draw });
  const par = slider({ label: 'parallel S3 requests', min: 1, max: 512, value: 64, onInput: draw });
  const obj = slider({ label: 'object size (MB)', min: 1, max: 256, value: 16, onInput: draw });
  const out = h('div', { class: 'out' });
  function draw() {
    const GB = sz.get(), H = hit.get() / 100, P = par.get(), O = obj.get();
    const nvmeBW = 3.0; // GB/s per drive, one drive
    const tLocal = GB / nvmeBW;
    const miss = GB * (1 - H); const nObj = miss * 1024 / O; const perReq = 0.03 + O / 1024 / 0.09 / 1; // 30ms first byte + O MB at ~90 MB/s per stream
    const waves = Math.ceil(nObj / P); const tS3 = nObj ? waves * perReq : 0; const agg = Math.min(P * 0.09, 10); // NIC cap ~10 GB/s (80 Gbps)
    const tS3b = nObj ? Math.max(tS3, miss / agg) : 0;
    const tTier = GB * H / nvmeBW + tS3b;
    const cost = nObj * 0.0004 / 1000; // $0.0004 per 1000 GET
    const egress = miss * 0.0; // same region: free
    out.innerHTML = `all on local NVMe (3 GB/s):  ${tLocal.toFixed(1)} s\nS3 + cache (${(H * 100).toFixed(0)}% hit):    <b class="${tTier < tLocal * 2 ? 'good' : 'warn'}">${tTier.toFixed(1)} s</b>   (${Math.round(nObj).toLocaleString()} GETs of ${O} MB, ${waves} waves x ${(perReq * 1000).toFixed(0)} ms; aggregate cap ~${agg.toFixed(1)} GB/s)\nrequest cost ≈ $${cost.toFixed(4)} per scan (GET at $0.0004 / 1000) + storage $${(GB * 0.023).toFixed(2)}/month vs ~$${(GB * 0.08).toFixed(2)}/month for provisioned SSD.\nObservations: tiny objects are dominated by 20-50 ms first-byte latency, so the engine reads large ranges, parallelises widely, caches hot data on local NVMe, and prefetches column chunks.`;
  }
  el.append(h('div', { class: 'row' }, sz.el, hit.el), h('div', { class: 'row' }, par.el, obj.el), out); draw();
}

export default {
  n: 16, title: 'Disaggregated storage / S3', minutes: 14, cmu: 'CMU 15-721 L19-L20 (Cloud databases, lakehouse)',
  components: ['disaggregated-storage', 'replication', 'wal'],
  goals: ['Contrast shared-nothing, shared-disk and disaggregated (compute/storage split) architectures.', 'Explain Aurora, Snowflake, Neon and lakehouse table formats (Delta/Iceberg/Hudi) at a design level.', 'Estimate scan time and cost against object storage with caching and parallelism.'],
  body: `
<h2>Three architectures</h2>
<table><tr><th></th><th>Shared-nothing</th><th>Shared-disk</th><th>Disaggregated / cloud-native</th></tr>
<tr><td>Data lives</td><td>on each node's local disks</td><td>on a SAN or network volume all nodes can reach</td><td>in a separate storage service (object store, log service)</td></tr>
<tr><td>Scale compute</td><td>repartition data</td><td>add nodes, coordinate caches</td><td>add/remove stateless compute in seconds</td></tr>
<tr><td>Examples</td><td>Cassandra, ClickHouse (classic), StarRocks (classic), Vitess shards</td><td>Oracle RAC, early cloud DBs</td><td>Snowflake, Aurora, Neon, BigQuery, StarRocks shared-data, Databricks</td></tr></table>
<h2>The log is the database (Aurora)</h2>
<p>Aurora MySQL/PostgreSQL ships only <b>redo log records</b> from the compute node to a distributed storage fleet of 6 copies across 3 availability zones (write quorum 4/6, read quorum 3/6, segments of 10 GB). Storage nodes materialize pages from redo continuously, so the compute node never writes pages or does checkpoints, crash recovery is just storage catching up, and read replicas share the same storage. Network traffic drops by roughly an order of magnitude compared with mirrored MySQL that sends WAL plus pages plus binlog.</p>
<h2>Snowflake and warehouses on S3</h2>
<p>Data is stored in immutable, compressed, columnar micro-partitions (50-500 MB uncompressed) in object storage with min/max metadata in a metadata service; stateless virtual warehouses cache files on local SSD and push down filters. Storage is cheap and durable (S3: 11 nines, ~$23 per TB-month), compute is billed per second and can be scaled or paused independently.</p>
<div data-demo="0"></div>
<h2>Object storage properties that shape engines</h2>
<ul><li>First-byte latency 20-50 ms (S3 Standard); throughput ~90 MB/s per stream, so parallel range GETs of 8-16 MB are standard. S3 Express One Zone brings ~single-digit ms.</li>
<li>Immutable objects: no in-place update or append (S3 now supports conditional writes with <code>If-None-Match</code>, and since 2024 compare-and-swap style conditional PUTs), so LSM/columnar designs fit naturally.</li>
<li>Request costs: ~$0.0004 per 1,000 GETs, $0.005 per 1,000 PUTs. Many tiny files are slow and expensive: compaction becomes essential.</li>
<li>Strong read-after-write consistency since Dec 2020, but listing and renames are not atomic; do not use the object store as a file system.</li></ul>
<h2>Table formats: transactions on a bucket</h2>
<p>Delta Lake, Apache Iceberg and Hudi add a <b>transaction log or manifest tree</b> over Parquet files: a commit atomically publishes a new snapshot (a list of data files plus stats) using an atomic conditional write (put-if-absent on the next log version, or a catalog pointer swap). Readers pick a snapshot, which gives MVCC, time travel and schema evolution; writers use optimistic concurrency and retry on conflict. Deletes use delete files / deletion vectors and are applied at read time until compaction.</p>
<h2>Caching tiers</h2>
<p>RAM buffer pool (~100 ns) to local NVMe cache (~100 us) to object store (~30 ms). The hit rate matters enormously: at 90% hit, average read ≈ 3 ms dominated by the 10% misses. Systems add result caches, metadata caches (file lists, footers) and cache-aware scheduling (assign the same micro-partitions to the same node, consistent hashing).</p>
<div class="callout ripple"><div class="t">What disaggregation changes elsewhere</div><p>Recovery shrinks (stateless compute), replication moves into the storage service, elasticity replaces capacity planning, the buffer pool becomes a cache with cold-start cost, and the commit path becomes network round trips to a log quorum rather than a local fsync.</p></div>`,
  demos: [{ title: 'Scan time and cost calculator', caption: 'Compare a local NVMe scan with an object-store scan fronted by a cache.', mount }],
  tradeoffs: { head: ['Architecture', 'Pros', 'Cons'], rows: [['Shared-nothing', 'Data locality, fast local I/O, no shared bottleneck', 'Rebalancing on resize; compute and storage scale together'], ['Shared-disk', 'Easy elasticity of compute', 'Shared storage latency, cache coherence'], ['Disaggregated + log service', 'Fast failover, cheap replicas, independent scaling', 'Network hop on every miss and commit; cold caches'], ['Object-store lakehouse', 'Cheapest storage, open formats, many engines', 'High latency, commit via conditional writes, small-file problem']] },
  ripples: [{ to: 'Buffer pool', text: 'becomes a multi-tier cache with explicit warm-up and prefetch policy.' }, { to: 'WAL / recovery', text: 'the log service owns durability; compute nodes are disposable.' }, { to: 'Execution', text: 'engines issue wide parallel range reads and use footers/zone maps to avoid fetching bytes.' }, { to: 'Concurrency control', text: 'multi-writer commit relies on atomic metadata swaps and optimistic retries.' }],
  quiz: [{ q: 'What does Aurora send from the database node to storage?', options: ['Full data pages', 'Redo log records', 'Binlog only'], answer: 1, why: 'Storage nodes apply redo to build pages themselves.' }, { q: 'Why read 8-16 MB ranges from S3?', options: ['S3 requires it', 'To amortize 20-50 ms first-byte latency and per-request cost', 'To avoid compression'], answer: 1, why: 'Per-request overhead dominates small reads.' }, { q: 'How do Delta/Iceberg commit atomically on S3?', options: ['Rename directory', 'Conditional put/atomic pointer swap of a new snapshot or log entry', 'Two-phase commit across files'], answer: 1, why: 'Only one writer can create the next version; others retry.' }],
  refs: [{ title: 'Verbitski et al., Amazon Aurora (SIGMOD 2017)', url: 'https://www.amazon.science/publications/amazon-aurora-design-considerations-for-high-throughput-cloud-native-relational-databases' }, { title: 'Dageville et al., The Snowflake Elastic Data Warehouse (SIGMOD 2016)', url: 'https://dl.acm.org/doi/10.1145/2882903.2903741' }, { title: 'Armbrust et al., Delta Lake (VLDB 2020)', url: 'https://www.vldb.org/pvldb/vol13/p3411-armbrust.pdf' }, { title: 'Apache Iceberg table spec', url: 'https://iceberg.apache.org/spec/' }, { title: 'CMU 15-721 schedule', url: 'https://15721.courses.cs.cmu.edu/spring2024/schedule.html' }, { title: 'Neon architecture', url: 'https://neon.tech/docs/introduction/architecture-overview' }],
};
