// node test/fxtest.js -> the effects pad's chain, rendered offline.
// At rest (filter open, no modulation) it must leave the sound alone; each
// effect must do what it says; nothing may turn NaN; and it must be cheap.
const { TouchGrassEngine } = require('../engine.js');
const E = TouchGrassEngine(), sr = 48000;
const AM = E.plate(9, 1).map(n => n - 12);

function make(fx, bypass) {
  const eng = new E.GrassEngine(sr, 48);
  eng.command({ t: 'drone', v: 0.35 }); eng.command({ t: 'tone', v: 1 }); eng.command({ t: 'voice', v: 1 });
  eng.command({ t: 'chord', root: 9, quality: 1 });
  eng.command({ t: 'space', send: 0, fb: 0, div: 1 });           // no echo, so only the chain is heard
  if (fx) eng.command(Object.assign({ t: 'fx', bpm: 120 }, fx));
  if (bypass) eng.fx.process = () => {};
  return eng;
}
// two seconds: a strum every half second; returns L and R
function play(eng) {
  const n = sr * 2, L = new Float32Array(n), R = new Float32Array(n), B = 480;
  for (let i = 0; i < n; i += B) {
    if (i % (sr / 2) === 0) AM.forEach((note, k) => eng.command({ t: 'pluckNote', note, vel: 0.7, delay: k * 0.02 }));
    eng.render(L, R, B, i);
  }
  return { L, R };
}
const rms = (a, from = 0, to = a.length) => { let s = 0; for (let i = from; i < to; i++) s += a[i] * a[i]; return Math.sqrt(s / (to - from)); };
const hf = a => { const d = new Float32Array(a.length - 1); for (let i = 1; i < a.length; i++) d[i - 1] = a[i] - a[i - 1]; return rms(d) / (rms(a) + 1e-12); };
const db = x => (20 * Math.log10(x + 1e-12)).toFixed(1);
const nan = o => [...o.L, ...o.R].some(x => !isFinite(x));

const ref = play(make(null, true)), rest = play(make({}, false));
let diff = 0; for (let i = 0; i < ref.L.length; i++) diff = Math.max(diff, Math.abs(ref.L[i] - rest.L[i]));
console.log(`at rest: level ${db(rms(rest.L))} dB vs ${db(rms(ref.L))} dB without the chain, brightness ${hf(rest.L).toFixed(3)} vs ${hf(ref.L).toFixed(3)}, largest sample difference ${diff.toFixed(4)}`);

const dark = play(make({ cut: 0.25, res: 0.2 }));
const reso = play(make({ cut: 0.45, res: 0.95 }));
console.log(`filter cut 0.25: brightness ${hf(dark.L).toFixed(3)} (open ${hf(rest.L).toFixed(3)}), level ${db(rms(dark.L))} dB | cut 0.45 res 0.95: level ${db(rms(reso.L))} dB, peak ${Math.max(...reso.L.map(Math.abs)).toFixed(2)} | NaN ${nan(dark) || nan(reso)}`);

// the filter LFO at 1/4 (index 3) and full depth: brightness per eighth note should swing
const lfo = play(make({ cut: 0.6, res: 0.3, lfoRate: 3, lfoDepth: 1 }));
const win = sr * 60 / 120 / 2, swings = [];
for (let i = 0; i + win <= lfo.L.length; i += win) swings.push(hf(lfo.L.subarray(i, i + win)).toFixed(2));
console.log(`filter LFO 1/4: brightness per 1/8 note ${swings.join(' ')}`);

// the gate at 1/16 (index 2), full depth: on for the first half of each 1/16, off for the rest
const gate = play(make({ gateRate: 2, gateDepth: 1 }));
const step = sr * 60 / 120 / 4, onoff = [];
for (let s = 4; s < 12; s++) { const a = Math.round(s * step); onoff.push(db(rms(gate.L, a + 100, a + step / 2 - 100)) + '/' + db(rms(gate.L, a + step / 2 + 300, a + step - 100))); }
console.log(`gate 1/16: dB on/off per step ${onoff.join('  ')}`);

// tremolo 1/8 and autopan 1/2
const trem = play(make({ tremRate: 4, tremDepth: 1 }));
const t8 = sr * 60 / 120 / 2, tw = [];
for (let i = 0; i < 8; i++) tw.push(db(rms(trem.L, Math.round(i * t8 / 2), Math.round((i + 1) * t8 / 2))));
console.log(`tremolo 1/8: dB per 1/16 ${tw.join(' ')}`);
const pan = play(make({ panRate: 2, panDepth: 1 }));
const half = sr * 60 / 120 * 2, pw = [];
for (let i = 0; i < 4; i++) { const a = Math.round(i * half / 4), b = Math.round((i + 1) * half / 4); pw.push(`${db(rms(pan.L, a, b))}|${db(rms(pan.R, a, b))}`); }
console.log(`autopan 1/2: L|R dB per 1/8 ${pw.join('  ')}`);

const cho = play(make({ choRate: 5, choDepth: 1 }));
console.log(`vibrato depth 1: level ${db(rms(cho.L))} dB, NaN ${nan(cho)}`);

// cost: everything on
const all = make({ cut: 0.5, res: 0.6, lfoRate: 3, lfoDepth: 0.6, gateRate: 2, gateDepth: 0.8, tremRate: 4, tremDepth: 0.5, panRate: 2, panDepth: 0.7, choRate: 1, choDepth: 0.4 });
const t0 = process.hrtime.bigint(); const o = play(all); const ms = Number(process.hrtime.bigint() - t0) / 1e6;
const t1 = process.hrtime.bigint(); play(make(null, true)); const ms0 = Number(process.hrtime.bigint() - t1) / 1e6;
console.log(`cost: ${(ms / 20).toFixed(1)}% of real time with every effect on, ${(ms0 / 20).toFixed(1)}% without the chain | NaN ${nan(o)}`);
