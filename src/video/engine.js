// Deterministic timeline engine. renderAt(t) draws the ENTIRE frame (1920x1080) from pure functions of t.
import helpers, { W, H, C, L, LAYERS, clamp, p, ease, text, rrect, hexA, rng } from './helpers.js';

export const TITLE_CARD = 2.6;      // seconds at the start of every chapter used by the engine's title card
const SHORT = { client: 'Client', frontend: 'SQL Frontend', planning: 'Planner', execution: 'Execution', txn: 'Txn & Recovery', storage: 'Storage', distributed: 'Distributed' };
export const FADE = 0.45;           // chapter cross-fade

export function buildTimeline(chapters) {
  let start = 0;
  const list = chapters.map((c, i) => {
    const cues = (c.narration || []).map(n => (typeof n === 'string' ? { at: 0, text: n } : n));
    const ch = { ...c, index: i, num: i + 1, start, end: start + c.duration, cues };
    start += c.duration; return ch;
  });
  return { chapters: list, total: start };
}

export function wrap(ctx, str, maxW) {
  const words = str.split(' '), out = []; let cur = '';
  for (const w of words) { const t2 = cur ? cur + ' ' + w : w; if (ctx.measureText(t2).width > maxW && cur) { out.push(cur); cur = w; } else cur = t2; }
  if (cur) out.push(cur); return out;
}

export function createRenderer(canvas, chapters, opts = {}) {
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const tl = buildTimeline(chapters);
  const state = { captions: opts.captions ?? true, minimap: opts.minimap ?? true, progress: true };
  const starfield = (() => { const r = rng(7); return Array.from({ length: 70 }, () => ({ x: r() * W, y: r() * H, s: .5 + r() * 1.8, v: 6 + r() * 14, a: .15 + r() * .35 })); })();

  function chapterAt(t) { t = clamp(t, 0, tl.total - 1e-6); return tl.chapters.find(c => t >= c.start && t < c.end) || tl.chapters[tl.chapters.length - 1]; }
  function cueAt(t) { const ch = chapterAt(t), lt = t - ch.start; let cur = null; for (const c of ch.cues) if (lt >= c.at) cur = c; return cur ? { ...cur, local: lt - cur.at, chapter: ch } : null; }

  function drawBackground(t, accent) {
    const g = ctx.createRadialGradient(W / 2, H / 2, 100, W / 2, H / 2, 1200); g.addColorStop(0, '#111729'); g.addColorStop(1, C.bg);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(122,162,247,.045)'; ctx.lineWidth = 1; ctx.beginPath();
    const off = (t * 6) % 60; for (let x = -off; x < W; x += 60) { ctx.moveTo(x, 0); ctx.lineTo(x, H); } for (let y = 0; y < H; y += 60) { ctx.moveTo(0, y); ctx.lineTo(W, y); } ctx.stroke();
    for (const s of starfield) { const y = (s.y - t * s.v + H * 10) % H; ctx.fillStyle = hexA(accent, s.a * .5); ctx.fillRect(s.x, y, s.s, s.s); }
  }

  function drawTitleCard(ch, lt) {
    const a = Math.min(p(lt, 0, .4, ease.out), 1 - p(lt, TITLE_CARD - .5, TITLE_CARD)); if (a <= 0) return;
    const col = ch.color || LAYERS[ch.index % LAYERS.length].color;
    ctx.save(); ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(11,14,23,.82)'; ctx.fillRect(0, 0, W, H);
    const u = p(lt, 0, .9, ease.expo);
    text(ctx, String(ch.num).padStart(2, '0'), W / 2, 430 - (1 - u) * 60, { size: 260, weight: 900, color: hexA(col, .22), align: 'center', base: 'middle' });
    text(ctx, ch.title, W / 2 + (1 - u) * 120, 560, { size: 84, weight: 800, align: 'center', base: 'middle', glow: 20, color: C.fg });
    ctx.fillStyle = col; ctx.fillRect(W / 2 - 160 * u, 625, 320 * u, 5);
    if (ch.subtitle) text(ctx, ch.subtitle, W / 2, 685, { size: 30, color: C.dim, align: 'center', weight: 500, alpha: p(lt, .5, 1.1) });
    ctx.restore();
  }

  function drawMiniMap(ch, lt) {
    const focus = typeof ch.focus === 'function' ? ch.focus(lt) : (ch.focus || []);
    const pw = 150, gap = 8, x0 = W - (pw * LAYERS.length + gap * (LAYERS.length - 1)) - 40, y = 28, h = 34;
    LAYERS.forEach((l, i) => {
      const on = focus.includes(l.id), x = x0 + i * (pw + gap);
      ctx.save(); rrect(ctx, x, y, pw, h, 9); ctx.fillStyle = hexA(l.color, on ? .28 : .07); if (on) { ctx.shadowColor = l.color; ctx.shadowBlur = 18; } ctx.fill(); ctx.shadowBlur = 0; ctx.strokeStyle = hexA(l.color, on ? .95 : .3); ctx.lineWidth = on ? 2 : 1; ctx.stroke(); ctx.restore();
      text(ctx, SHORT[l.id], x + pw / 2, y + h / 2 + 1, { size: 15, align: 'center', base: 'middle', color: on ? '#fff' : hexA(l.color, .7), weight: on ? 700 : 500 });
      if (i < LAYERS.length - 1) { ctx.fillStyle = 'rgba(138,147,181,.4)'; ctx.fillRect(x + pw, y + h / 2 - 1, gap, 2); }
    });
    text(ctx, 'WHERE WE ARE', x0, y - 8, { size: 11, color: C.dim, weight: 700 });
    text(ctx, `${String(ch.num).padStart(2, '0')} · ${ch.title}`, 40, 52, { size: 24, color: C.fg, weight: 700 });
  }

  function drawCaption(ch, t) {
    const cue = cueAt(t); if (!cue) return;
    const lt = t - ch.start; if (lt < 0.2) return;
    const a = Math.min(p(cue.local, 0, .3, ease.out), 1 - p(lt, ch.duration - .3, ch.duration));
    ctx.save(); ctx.font = `600 38px ${C.sans}`;
    const ls = wrap(ctx, cue.text, 1720), lh = 52, hh = ls.length * lh + 30, w = Math.min(1800, Math.max(...ls.map(s => ctx.measureText(s).width)) + 70);
    const y0 = 1030 - hh - 12 + (1 - a) * 12;
    ctx.globalAlpha = a; rrect(ctx, W / 2 - w / 2, y0, w, hh, 18); ctx.fillStyle = 'rgba(8,10,18,.84)'; ctx.fill(); ctx.strokeStyle = 'rgba(122,162,247,.25)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#eef1ff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ls.forEach((s, i) => ctx.fillText(s, W / 2, y0 + 15 + lh / 2 + i * lh));
    ctx.restore();
  }

  function renderAt(t) {
    t = clamp(t, 0, tl.total - 1e-6);
    const ch = chapterAt(t), lt = t - ch.start, col = ch.color || LAYERS[ch.index % LAYERS.length].color;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    drawBackground(t, col);
    const ca = Math.min(p(lt, 0, FADE), 1 - p(lt, ch.duration - FADE, ch.duration));
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip(); ctx.globalAlpha = ca;
    try { ch.draw(ctx, lt, helpers); } catch (e) { ctx.restore(); ctx.save(); text(ctx, 'draw error: ' + e.message, 60, 500, { size: 28, color: C.bad }); if (!renderAt._warned) { renderAt._warned = true; console.error('chapter', ch.num, e); } }
    ctx.restore();
    ctx.save(); drawTitleCard(ch, lt); ctx.restore();
    if (state.minimap) { ctx.save(); ctx.globalAlpha = ca; drawMiniMap(ch, lt); ctx.restore(); }
    if (state.captions) { ctx.save(); drawCaption(ch, t); ctx.restore(); }
    if (state.progress) { ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fillRect(0, H - 5, W, 5); ctx.fillStyle = col; ctx.fillRect(0, H - 5, W * t / tl.total, 5); }
    ctx.restore();
  }
  return { renderAt, timeline: tl, total: tl.total, chapterAt, cueAt, state, canvas, ctx };
}
