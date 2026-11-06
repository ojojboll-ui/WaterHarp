// node test/coretest.js — sweeps sizes, checks for NaN, leaks and volume loss
const { FluidSim } = require('../fluid-core.js');
function run(cells, aspect, shape, width, fill, steps, gfun) {
  const sim = new FluidSim({ cellsX: cells, aspect, shape, width, fill });
  const t0 = process.hrtime.bigint();
  let bad = 0;
  for (let k = 0; k < steps; k++) {
    const [gx, gy] = gfun(k / 60);
    sim.gx = gx; sim.gy = gy;
    sim.step(1 / 60);
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / steps;
  for (let i = 0; i < sim.numP * 2; i++) if (!isFinite(sim.pos[i])) bad++;
  let out = 0;
  for (let i = 0; i < sim.numP; i++) {
    const x = sim.pos[2*i], y = sim.pos[2*i+1];
    if (x < sim.h*0.99 || x > sim.W - sim.h*0.99 || y < sim.h*0.99 || y > sim.H - sim.h*0.99) out++;
    if (shape === 'circle' && Math.hypot(x - sim.cx, y - sim.cy) > sim.cR * 1.001) out++;
  }
  sim.computeField();
  const ow = Math.max(2, Math.round(cells / 2)), oh = Math.max(2, Math.round(ow * sim.aspect));
  const cov = new Float32Array(ow * oh); sim.rasterize(ow, oh, cov);
  let lit = 0, n = 0; for (const c of cov) if (c >= 0) { lit += c; n++; }
  console.log(`${String(cells).padStart(4)} cells ${shape.padEnd(6)} ${sim.nx}x${sim.ny} p=${String(sim.numP).padStart(6)} ` +
    `fill=${fill} -> lit ${(lit / n).toFixed(3)} (${ow}x${oh})  ${ms.toFixed(2)} ms/step  sub=${sim.lastSubsteps} NaN=${bad} out=${out}`);
}
const still = () => [0, 9.81];
const slosh = t => [9.81 * Math.sin(t * 2.5), 9.81 * Math.cos(t * 2.5)];
for (const c of [4, 8, 16, 32, 64, 128]) run(c, 1, 'box', 1, 0.4, 240, still);
for (const c of [6, 16, 48]) run(c, 1, 'circle', 0.5, 0.5, 240, slosh);
run(48, 2.1, 'box', 1, 0.4, 600, slosh);
run(200, 2.1, 'box', 1, 0.4, 20, still);
