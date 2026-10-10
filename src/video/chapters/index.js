// Auto-collects chapters/NN-*.js in numeric order. Each exports `default` or named {title,duration,narration,draw,...}.
const mods = import.meta.glob('./[0-9][0-9]-*.js', { eager: true });
export default Object.keys(mods).sort().map(k => { const m = mods[k]; return m.default || m.chapter || m; });
