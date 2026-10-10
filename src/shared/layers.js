// Shared layer palette + order. Every page uses this so colors mean the same thing everywhere.
export const LAYERS = [
  { id: 'client',      name: 'Client & Protocol',        color: '#7aa2f7' },
  { id: 'frontend',    name: 'SQL Frontend',             color: '#bb9af7' },
  { id: 'planning',    name: 'Planning & Optimization',  color: '#e0af68' },
  { id: 'execution',   name: 'Execution & Scheduling',   color: '#9ece6a' },
  { id: 'txn',         name: 'Transactions & Recovery',  color: '#f7768e' },
  { id: 'storage',     name: 'Storage Engine',           color: '#2ac3de' },
  { id: 'distributed', name: 'Distributed & Cloud',      color: '#ff9e64' },
];
export const layerById = Object.fromEntries(LAYERS.map((l, i) => [l.id, { ...l, index: i }]));
export const EDGE_KINDS = {
  control: '#c0caf5', data: '#9ece6a', log: '#f7768e', meta: '#e0af68', network: '#ff9e64',
};
