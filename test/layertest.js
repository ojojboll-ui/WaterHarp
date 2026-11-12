// node test/layertest.js -> the bow layer and the string voices,
// rendered offline. Bow: loudness as the flow swells, holds and stops (it
// must fall silent), and the cost with all 13 strings singing. Voices: a
// sweep of the Am plate, loudness over time and the cost. NaN checks all over.
const { TouchGrassEngine } = require('../engine.js');
const E = TouchGrassEngine(), sr = 48000;
const AM = E.plate(9, 1).map(n => n - 12);   // Am, low register
const blk = new Float32Array(sr / 20), blkR = new Float32Array(sr / 20);
const db = x => (20 * Math.log10(x + 1e-9)).toFixed(0).padStart(4);

function render(eng, n) {
  let s = 0, peak = 0, bad = false;
  for (let b = 0; b < n; b++) {
    eng.render(blk, blkR, blk.length);
    for (const x of blk) { s += x * x; peak = Math.max(peak, Math.abs(x)); if (!isFinite(x)) bad = true; }
  }
  return { rms: Math.sqrt(s / (n * blk.length)), peak, bad };
}
function engine() {
  const eng = new E.GrassEngine(sr, 48);
  eng.command({ t: 'drone', v: 0 }); eng.command({ t: 'tone', v: 1 }); eng.command({ t: 'ring', v: 3.5 });
  return eng;
}

console.log('BOW LAYER: four strings, flow swells for 1 s, holds 1 s, stops (dB per 0.25 s)');
for (const [mode, name] of [[0, 'GLASS'], [1, 'JUNO']]) {
  const eng = engine();
  eng.command({ t: 'bowMode', v: mode }); eng.command({ t: 'layers', bow: 1 });
  const row = []; let bad = false;
  for (let f = 0; f < 60; f++) {
    const lv = new Array(13).fill(0), t = f / 20, level = t < 1 ? t : t < 2 ? 1 : 0;
    for (const k of [3, 5, 7, 9]) lv[k] = level;
    eng.command({ t: 'bow', lv, nt: AM, br: new Array(13).fill(0.7) });
    const r = render(eng, 1); bad = bad || r.bad;
    if (f % 5 === 4) row.push(db(r.rms));
  }
  const all = new Array(13).fill(1);
  eng.command({ t: 'bow', lv: all, nt: AM, br: all });
  const t0 = process.hrtime.bigint(); const r = render(eng, 20); const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`  ${name.padEnd(5)} ${row.join(' ')} | 13 strings ${db(r.rms)} dB, ${(ms / 10).toFixed(1)}% of real time | NaN ${bad || r.bad}`);
}

console.log('\nSTRING VOICES: a sweep of Am over 0.6 s (dB per 0.25 s), peak, cost');
for (const [v, name] of [[1, 'Harp'], [7, 'Juno Keys'], [6, 'Juno Brass'], [8, 'Juno Strings']]) {
  const eng = engine();
  eng.command({ t: 'voice', v });
  AM.forEach((n, i) => eng.command({ t: 'pluckNote', note: n, vel: i % 4 === 0 ? 0.9 : 0.6, delay: i * 0.05, bright: 0.8 }));
  const row = []; let peak = 0, bad = false;
  const t0 = process.hrtime.bigint();
  for (let f = 0; f < 16; f++) { const r = render(eng, 5); row.push(db(r.rms)); peak = Math.max(peak, r.peak); bad = bad || r.bad; }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`  ${name.padEnd(12)} ${row.join(' ')} | peak ${peak.toFixed(2)} | ${(ms / 40).toFixed(1)}% of real time | NaN ${bad}`);
}
