// node test/flowtest.js -> what the bow layer would hear, and the droplets that leave flecks.
// flow: per string, depth x mean sideways speed of the water on it (tank
// widths a second); a flowing string should sing, still water stay silent.
// drops: loose particles (little water around them) crossing a string.
const { FluidSim } = require('../fluid-core.js');
const { WaterStrum } = require('../strum.js');
const PRESETS = require('../presets.js');
const DT = 1 / 60;

function run(p, angleAt, seconds) {
  const sim = new FluidSim({ cellsX: 40, aspect: 0.74, width: p.size, fill: p.fill, shape: 'box',
    params: { flipRatio: p.flip, damping: p.damping, pressureIters: 30 } });
  const strum = new WaterStrum(13); strum.place(sim);
  const g = 9.81 * p.gravity;
  for (let i = 0; i < 180; i++) { sim.gx = 0; sim.gy = g; sim.step(DT); strum.update(sim, DT); }
  const per = [];   // per second: [max flow over strings, mean flow, drops]
  for (let f = 0; f < seconds * 60; f++) {
    const a = angleAt(f * DT) * Math.PI / 180;
    sim.gx = g * Math.sin(a); sim.gy = g * Math.cos(a);
    sim.step(DT);
    strum.update(sim, DT);
    const s = Math.floor(f / 60);
    per[s] = per[s] || [0, 0, 0];
    let mx = 0, sum = 0;
    for (let k = 0; k < 13; k++) { mx = Math.max(mx, strum.flow[k]); sum += strum.flow[k]; }
    per[s][0] = Math.max(per[s][0], mx); per[s][1] += sum / 13 / 60;
    per[s][2] += strum.drops.length;
  }
  return per.map(([m, a, d]) => `${m.toFixed(3)}/${a.toFixed(3)}/${d}`).join('  ');
}
const ramp = (t, t0, t1, a0, a1) => t <= t0 ? a0 : t >= t1 ? a1 : a0 + (a1 - a0) * (t - t0) / (t1 - t0);
console.log('per second: max flow / mean flow / droplet crossings');
for (const name of Object.keys(PRESETS)) {
  const p = PRESETS[name];
  console.log(`\n${name}`);
  console.log('  still        ', run(p, () => 0, 3));
  console.log('  slow tilt 15 ', run(p, t => ramp(t, 0, 3, 0, 15), 4));
  console.log('  quick tilt 25', run(p, t => ramp(t, 0.2, 0.35, 0, 25), 5));
  console.log('  rocking      ', run(p, t => 25 * Math.sin(t * 2 * Math.PI / 1.6), 5));
}
