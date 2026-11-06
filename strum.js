/*
 * WaterStrum: hears the water play the strings.
 *
 * The strings are vertical lines across the tank. For each one we measure
 * how much water stands on it (the column's depth, from the particles under
 * a tent-shaped window around the string) and pluck it when that depth
 * RISES quickly: a wave crest arriving, or the water's edge running onto a
 * dry string. A slow rise never plucks, because the baseline it is compared
 * with creeps up after the water; a fall resets the baseline at once, so the
 * next wave plucks again.
 *
 * No DOM, no allocation per frame: node tests run it against fluid-core.js.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WaterStrum = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

  const DEFAULTS = {
    rise: 0.035,        // depth rise that plucks, as a share of the tank's height
    relax: 0.18,        // seconds for the baseline to catch up with a slow rise
    refractory: 0.07,   // seconds before the same string can pluck again
    softRate: 0.15,     // rise speed (tank heights a second) that plucks softly
    hardRate: 2.4,      // ... and that plucks at full strength
  };

  class WaterStrum {
    constructor(count = 13, opts = {}) {
      this.p = Object.assign({}, DEFAULTS, opts);
      this.n = count;
      this.depth = new Float32Array(count);    // water on each string, share of tank height
      this.base = new Float32Array(count);     // what each string's depth is compared with
      this.prevExcess = new Float32Array(count);
      this.speed = new Float32Array(count);    // smoothed rise speed, tank heights a second
      this.wait = new Float32Array(count);     // refractory time left
      this.armed = new Uint8Array(count).fill(1); // off from a pluck until the water stops rising
      this.peak = new Float32Array(count);
      this.x = new Float32Array(count);        // string positions in sim metres
      this.events = [];                        // plucks found by the last update()
      this.primed = false;
    }

    // Spread the strings evenly over the tank's inner width.
    place(sim) {
      const left = sim.h, width = sim.innerX * sim.h;
      for (let k = 0; k < this.n; k++) this.x[k] = left + (k + 0.5) / this.n * width;
      this.spacing = width / this.n;
      this.primed = false;
    }

    measure(sim) {
      const d = this.depth, n = this.n, x0 = this.x[0], sp = this.spacing, half = sp;
      d.fill(0);
      const pos = sim.pos;
      for (let i = 0; i < sim.numP; i++) {
        const t = (pos[2 * i] - x0) / sp;             // in string spacings from the first string
        const k0 = Math.floor(t);
        for (let k = k0; k <= k0 + 1; k++) {
          if (k < 0 || k >= n) continue;
          const w = 1 - Math.abs(pos[2 * i] - this.x[k]) / half;
          if (w > 0) d[k] += w;
        }
      }
      // particles -> depth: each particle stands for one packing cell of area
      const area = sim.h * sim.h / sim.restDensity, tankH = sim.innerY * sim.h;
      const s = area / half / tankH;
      for (let k = 0; k < n; k++) d[k] *= s;
    }

    // Measure and find the plucks of the frame that just ended. Each event
    // carries `frac`, how far through the frame (0..1) the rise crossed the
    // line, so a quick sweep lands as an even strum and not a clump.
    update(sim, dt) {
      this.measure(sim);
      const p = this.p, ev = this.events;
      ev.length = 0;
      if (!this.primed) { this.base.set(this.depth); this.prevExcess.fill(0); this.primed = true; return ev; }
      const relax = 1 - Math.exp(-dt / p.relax), smooth = 1 - Math.exp(-dt / 0.05);
      for (let k = 0; k < this.n; k++) {
        const d = this.depth[k];
        if (d < this.base[k]) this.base[k] = d;                 // a fall resets at once
        const excess = d - this.base[k];
        const rate = (excess - this.prevExcess[k]) / dt;
        this.speed[k] += (Math.max(0, rate) - this.speed[k]) * smooth;
        this.wait[k] = Math.max(0, this.wait[k] - dt);
        if (!this.armed[k]) {
          // one pluck per wave: wait until the water on this string recedes a
          // little or stops rising, then measure the next rise from there
          if (d > this.peak[k]) this.peak[k] = d;
          if (this.wait[k] === 0 && (d < this.peak[k] - 0.3 * p.rise || this.speed[k] < 0.5 * p.softRate)) {
            this.armed[k] = 1; this.base[k] = d; this.prevExcess[k] = 0;
          }
          continue;
        }
        if (excess >= p.rise && this.wait[k] === 0) {
          const before = this.prevExcess[k];
          const frac = excess > before ? clamp((p.rise - before) / (excess - before), 0, 1) : 1;
          const r = Math.max(this.speed[k], rate, 1e-6);
          const vel = clamp(Math.log(r / p.softRate) / Math.log(p.hardRate / p.softRate), 0, 1);
          ev.push({ string: k, frac, vel: 0.25 + 0.75 * vel, depth: d });
          this.armed[k] = 0; this.peak[k] = d;                  // the next pluck needs a new wave
          this.wait[k] = p.refractory;
          this.prevExcess[k] = 0;
          continue;
        }
        this.base[k] += (d - this.base[k]) * relax;            // a slow rise is caught up with
        this.prevExcess[k] = d - this.base[k];
      }
      return ev;
    }
  }

  return { WaterStrum, DEFAULTS };
});
