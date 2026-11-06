// node test/strumtest.js  -> how the water plays the strings in a few gestures.
// Prints each pluck as time, string and strength, so you can see whether a
// tilt sweeps the strings in order and whether still water stays quiet.
const { FluidSim } = require('../fluid-core.js');
const { WaterStrum } = require('../strum.js');

const opts = { cellsX: +process.env.CELLS || 40, aspect: +process.env.ASPECT || 0.78, width: +process.env.WIDTH || 0.35, fill: +process.env.FILL || 0.3 };
const DT = 1 / 60;

function run(name, gravityAt, seconds, poke) {
  const sim = new FluidSim(Object.assign({ shape: 'box' }, opts));
  const strum = new WaterStrum(13);
  strum.place(sim);
  // settle first
  for (let i = 0; i < 120; i++) { sim.gx = 0; sim.gy = 9.81; sim.step(DT); strum.update(sim, DT); }
  const out = [];
  for (let f = 0; f < seconds * 60; f++) {
    const t = f * DT, a = gravityAt(t) * Math.PI / 180;
    sim.gx = 9.81 * Math.sin(a); sim.gy = 9.81 * Math.cos(a);
    if (poke) poke(sim, t); else sim.obstacle.active = false;
    sim.step(DT);
    for (const e of strum.update(sim, DT)) out.push({ t: t + e.frac * DT, s: e.string, v: e.vel });
  }
  const line = out.map(e => `${e.t.toFixed(2)}:${e.s}${e.v > 0.75 ? '!' : e.v < 0.45 ? '.' : ''}`).join(' ');
  console.log(`\n${name}  (${out.length} plucks)\n  ${line || '-'}`);
  return out;
}

const ramp = (t, t0, t1, a0, a1) => t <= t0 ? a0 : t >= t1 ? a1 : a0 + (a1 - a0) * (t - t0) / (t1 - t0);
console.log('tank', opts, '  string:time, ! = hard, . = soft');
run('still water', () => 0, 3);
run('slow tilt 0 -> 15 deg over 3 s', t => ramp(t, 0, 3, 0, 15), 4);
run('quick tilt 0 -> 25 deg in 0.15 s', t => ramp(t, 0.2, 0.35, 0, 25), 3);
run('quick tilt -25 -> +25 (rock across)', t => t < 1.5 ? ramp(t, 0, 0.15, 0, -25) : ramp(t, 1.5, 1.7, -25, 25), 3.5);
run('finger drags left to right through the water', () => 0, 2.5, (sim, t) => {
  const ob = sim.obstacle, x0 = sim.h * 2, x1 = sim.h * (sim.innerX - 1), T = 0.8;
  if (t < 0.2 || t > 0.2 + T) { ob.active = false; return; }
  ob.active = true; ob.r = sim.h * 3;
  ob.x = x0 + (x1 - x0) * (t - 0.2) / T; ob.y = sim.h * (1 + sim.innerY * 0.82);
  ob.vx = (x1 - x0) / T; ob.vy = 0;
});
