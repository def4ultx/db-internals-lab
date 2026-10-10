// internals-C: storage-engine views. Merges the per-topic files.
import { views as buffer } from './storage_buffer.js';
import { views as btree } from './storage_btree.js';
import { views as trees } from './storage_trees.js';
import { views as lsm } from './storage_lsm.js';
import { views as table } from './storage_table.js';
import { views as access } from './storage_access.js';
export const views = { ...buffer, ...btree, ...trees, ...lsm, ...table, ...access };
