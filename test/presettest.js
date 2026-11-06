// node test/presettest.js -> for every water preset: still water must stay
// silent, and a quick tilt and a rock across must strum. Also counts the
// plucks per octave zone (base/+1/+2), so the zone lines can be checked
// against what the water really does. SPAN=1 node test/presettest.js for fewer zones.
const { FluidSim } = require('../fluid-core.js');
const { WaterStrum } = require('../strum.js');
const PRESETS = require('../presets.js');
const DT = 1 / 60, SPAN = process.env.SPAN != null ? +process.env.SPAN : 2;

function run(p, angleAt, seconds) {
  const sim = new FluidSim({ cellsX: 40, aspect: 0.74, width: p.size, fill: p.fill, shape: 'box',
    params: { flipRatio: p.flip, damping: p.damping, pressureIters: 30 } });
  const strum = new WaterStrum(13, { span: SPAN }); strum.place(sim);
  const g = 9.81 * p.gravity;
  for (let i = 0; i < 180; i++) { sim.gx = 0; sim.gy = g; sim.step(DT); strum.update(sim, DT); }
  const ev = [];
  for (let f = 0; f < seconds * 60; f++) {
    const a = angleAt(f * DT) * Math.PI / 180;
    sim.gx = g * Math.sin(a); sim.gy = g * Math.cos(a);
    sim.step(DT);
    for (const e of strum.update(sim, DT)) ev.push(Object.assign({ t: f * DT }, e));
  }
  const lines = [];
  for (let i = 0; i < SPAN; i++) lines.push(strum.zoneLine(i).toFixed(2));
  return { ev, rest: strum.rest, lines: lines.join(',') || '-' };
}
const ramp = (t, t0, t1, a0, a1) => t <= t0 ? a0 : t >= t1 ? a1 : a0 + (a1 - a0) * (t - t0) / (t1 - t0);
const bands = ev => { const n = new Array(SPAN + 1).fill(0); for (const e of ev) n[e.octave]++; return n.join('/'); };

console.log(`octave zones above the base: ${SPAN}. Plucks per zone (base/+1/+2)`);
for (const [name, p] of Object.entries(PRESETS)) {
  const still = run(p, () => 0, 3);
  const tilt = run(p, t => ramp(t, 0.2, 0.35, 0, 25), 3);
  const rock = run(p, t => t < 1.5 ? ramp(t, 0, 0.15, 0, -25) : ramp(t, 1.5, 1.7, -25, 25), 3.5);
  const first = tilt.ev.slice(0, 13).map(e => e.string + (e.octave ? "'".repeat(e.octave) : '')).join(' ');
  console.log(`${name.padEnd(7)} rest ${tilt.rest.toFixed(2)} lines ${tilt.lines.padEnd(9)} | still ${String(still.ev.length).padStart(2)}` +
    ` | tilt ${String(tilt.ev.length).padStart(3)} zones ${bands(tilt.ev).padEnd(9)} | rock ${String(rock.ev.length).padStart(3)} zones ${bands(rock.ev).padEnd(9)} | tilt starts ${first}`);
}
