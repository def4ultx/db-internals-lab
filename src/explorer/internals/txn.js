// internals-E1: transaction & recovery views. Merges txn-a/b/c.
import { views as a } from './txn-a.js';
import { views as b } from './txn-b.js';
import { views as c } from './txn-c.js';
export const views = { ...a, ...b, ...c };
