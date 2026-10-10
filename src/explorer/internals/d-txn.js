// internals-E2 (part): distributed-commit + logical-clocks views. Merged by distributed.js.
import { commitView } from './d-commit.js';
import { clockView } from './d-clocks.js';
export const views = { 'distributed-commit': commitView, 'logical-clocks': clockView };
