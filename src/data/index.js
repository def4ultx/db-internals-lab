// Central data access. Each data file is loaded defensively; if missing/empty/throwing we fall back to the fixture.
import fixture from '../explorer/fixture.js';
import { LAYERS } from '../shared/layers.js';

const loaders = import.meta.glob('./{components,edges,flows,designs,rules,systems}.js');

async function load(name, fallback) {
  const key = `./${name}.js`;
  try {
    if (!loaders[key]) throw new Error('missing');
    const mod = await loaders[key]();
    const v = mod.default;
    if (!Array.isArray(v) || v.length === 0) throw new Error('empty');
    return { data: v, source: 'real', mod };
  } catch (e) {
    if (e.message !== 'missing' && e.message !== 'empty') console.warn(`[data] ${name}.js failed to load:`, e);
    return { data: fallback, source: 'fixture', mod: null };
  }
}

const [c, e, f, d, r, s] = await Promise.all([
  load('components', fixture.components), load('edges', fixture.edges), load('flows', fixture.flows),
  load('designs', fixture.slots), load('rules', fixture.rules), load('systems', fixture.systems),
]);

const layerIds = new Set(LAYERS.map((l) => l.id));
export const components = c.data.filter((x) => x && x.id && layerIds.has(x.layer));
const compIds = new Set(components.map((x) => x.id));
export const edges = e.data.filter((x) => x && x.id && compIds.has(x.from) && compIds.has(x.to));
export const flows = f.data.filter((x) => x && x.id && Array.isArray(x.steps));
export const slots = d.data.filter((x) => x && x.id && Array.isArray(x.options) && x.options.length);
export const rules = r.data.filter((x) => x && x.when && x.with);
export const systems = s.data.filter((x) => x && x.id);
export const featureRows = s.mod?.featureRows || [];
export const dataStatus = { components: c.source, edges: e.source, flows: f.source, designs: d.source, rules: r.source, systems: s.source };

export const compById = Object.fromEntries(components.map((x) => [x.id, x]));
export const edgeById = Object.fromEntries(edges.map((x) => [x.id, x]));
export const flowById = Object.fromEntries(flows.map((x) => [x.id, x]));
export const slotById = Object.fromEntries(slots.map((x) => [x.id, x]));
export const systemById = Object.fromEntries(systems.map((x) => [x.id, x]));
export const optionOf = (slotId, optId) => slotById[slotId]?.options.find((o) => o.id === optId);
export const slotsForComponent = (id) => slots.filter((x) => x.component === id || (x.also || []).includes(id));
export const edgesOf = (id) => edges.filter((x) => x.from === id || x.to === id);
export const defaultConfig = () => Object.fromEntries(slots.map((x) => [x.id, x.default || x.options[0].id]));
