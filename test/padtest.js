// node test/padtest.js -> the pad sounds only while a chord is held, plucks come through
const { TouchGrassEngine } = require('../engine.js');
const E = TouchGrassEngine(), sr = 48000, eng = new E.GrassEngine(sr, 48);
for (const c of [{ t: 'voice', v: 1 }, { t: 'ring', v: 3.5 }, { t: 'drone', v: 0.35 }, { t: 'tone', v: 1 }]) eng.command(c);
const L = new Float32Array(sr / 10), R = new Float32Array(sr / 10);
const rms = () => { eng.render(L, R, L.length); let s = 0; for (const x of L) s += x * x; return Math.sqrt(s / L.length); };
const db = x => (20 * Math.log10(x + 1e-9)).toFixed(1).padStart(6);
const row = (label, n) => { const v = []; for (let i = 0; i < n; i++) v.push(db(rms())); console.log(label.padEnd(24), v.join(' ')); };
row('silence', 3);
eng.command({ t: 'chord', root: 9, quality: 1 });
row('Am held (pad)', 8);
eng.command({ t: 'chordOff' });
row('released', 12);
eng.command({ t: 'chord', root: 0, quality: 0 });
row('C held', 4);
E.plate(0, 0).forEach((n, i) => eng.command({ t: 'pluckNote', note: n, vel: 0.8, delay: i * 0.03, bright: 0.9 }));
row('C + strum', 6);
eng.command({ t: 'chordOff' });
row('released, strings ring', 10);
