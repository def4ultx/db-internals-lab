// Validates chapter modules: durations, narration pacing (2.4 wps), totals.
import fs from 'fs'; import path from 'path'; import { pathToFileURL } from 'url';
const dir = path.resolve('src/video/chapters'); let total = 0, words = 0, bad = 0;
for (const f of fs.readdirSync(dir).filter(f => /^\d\d-.*\.js$/.test(f)).sort()) {
  let m; try { m = await import(pathToFileURL(path.join(dir, f)).href); } catch (e) { console.log(f, 'IMPORT FAIL', e.message); bad++; continue; }
  const cues = (m.narration || []).map(n => typeof n === 'string' ? { at: 0, text: n } : n); let w = 0; const issues = [];
  cues.forEach((c, i) => { const n = c.text.split(/\s+/).length; w += n; const end = i + 1 < cues.length ? cues[i + 1].at : m.duration - .3; const need = n / 2.6; if (end - c.at < need - .01) issues.push(`cue${i}@${c.at}s ${n}w needs ${need.toFixed(1)}s has ${(end - c.at).toFixed(1)}s`); if (c.text.length > 188) issues.push(`cue${i} ${c.text.length} chars (may wrap to 3 lines)`); if (i && c.at <= cues[i - 1].at) issues.push(`cue${i} out of order`); });
  if (cues[0] && cues[0].at < 0.5) issues.push('first cue before 0.5s');
  console.log(f.padEnd(26), `dur ${m.duration}s  cues ${cues.length}  words ${w}  ${typeof m.draw === 'function' ? '' : 'NO draw()'}`, issues.length ? '\n   ! ' + issues.join('\n   ! ') : 'ok'); total += m.duration; words += w; bad += issues.length;
}
console.log(`TOTAL ${total}s = ${Math.floor(total / 60)}:${String(Math.round(total % 60)).padStart(2, '0')}  words ${words}  problems ${bad}`);
