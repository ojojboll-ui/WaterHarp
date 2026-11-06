const { FluidSim } = require('../fluid-core.js');
function test(params, o = {}) {
  const sim = new FluidSim(Object.assign({ cellsX: 40, aspect: 0.78, width: 0.35, fill: 0.3, shape: 'box', params }, o));
  let med = 0, n = 0, top = 0, lvl = 0;
  for (let i = 0; i < 420; i++) {
    sim.step(1/60);
    if (i >= 300 && i % 10 === 0) {
      const sp = [], ys = [];
      for (let p = 0; p < sim.numP; p++) { sp.push(Math.hypot(sim.vel[2*p], sim.vel[2*p+1])); ys.push(sim.pos[2*p+1]); }
      sp.sort((a,b)=>a-b); ys.sort((a,b)=>a-b); med += sp[sp.length>>1]; n++;
      const H = sim.innerY*sim.h;
      top = Math.max(top, 1 - (ys[0] - sim.h)/H);
      lvl += 1 - (ys[Math.floor(ys.length*0.02)] - sim.h)/H;   // surface ~ the 2% highest particles
    }
  }
  return `speed ${(med/n).toFixed(3)} level ${(lvl/n).toFixed(2)} top ${top.toFixed(2)}`;
}
for (const o of [{ width: 0.35 }, { width: 1 }, { width: 0.35, cellsX: 24 }, { width: 0.35, cellsX: 80 }])
  for (const share of [0.05, 0.15, 0.3, 0.6])
    console.log(JSON.stringify(o).padEnd(30), 'share', String(share).padEnd(5), test({ driftShare: share }, o));
