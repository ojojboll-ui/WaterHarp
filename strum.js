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
 * Height picks the octave. Above the resting water line lie `span` zone
 * lines, like frets across the strings. A pluck sounds in the octave of the
 * zone the water stands in, and a crest that keeps climbing plucks the string
 * again each time it rises briskly past the next line: a big slosh up the
 * wall plays a rising arpeggio, small waves stay low.
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
    span: 2,            // octave zones above the base one (0 = height does nothing)
    zoneFirst: 0.10,    // first zone line, this far above the resting water line
    zoneStep: 0.14,     // and each next one this much higher (shares of tank height)
  };

  class WaterStrum {
    constructor(count = 13, opts = {}) {
      this.p = Object.assign({}, DEFAULTS, opts);
      this.n = count;
      this.depth = new Float32Array(count);    // water on each string, share of tank height
      this.prevDepth = new Float32Array(count);
      this.base = new Float32Array(count);     // what each string's depth is compared with
      this.prevExcess = new Float32Array(count);
      this.speed = new Float32Array(count);    // smoothed rise speed, tank heights a second
      this.wait = new Float32Array(count);     // refractory time left
      this.armed = new Uint8Array(count).fill(1); // off from a pluck until the water stops rising
      this.peak = new Float32Array(count);
      this.zone = new Uint8Array(count);       // the zone of each string's last pluck
      this.x = new Float32Array(count);        // string positions in sim metres
      this.events = [];                        // plucks found by the last update()
      this.rest = 0;                           // the level the water would settle at
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
      let sum = 0;
      for (let k = 0; k < n; k++) { d[k] *= s; sum += d[k]; }
      // the water's volume is the same however it sloshes, so the mean depth
      // over the strings is its resting level (smoothed, so the lines hold still)
      const mean = sum / n;
      this.rest = this.primed ? this.rest + (mean - this.rest) * 0.02 : mean;
    }

    // Height of zone line i (0-based), as a share of the tank's height.
    zoneLine(i) { return Math.min(0.96, this.rest + this.p.zoneFirst + i * this.p.zoneStep); }
    zoneOf(d) {
      let z = 0;
      while (z < this.p.span && d >= this.zoneLine(z)) z++;
      return z;
    }

    // Measure and find the plucks of the frame that just ended. Each event
    // carries `frac`, how far through the frame (0..1) the rise crossed the
    // line, so a quick sweep lands as an even strum and not a clump, and
    // `octave`, the zone the water stood in.
    update(sim, dt) {
      this.prevDepth.set(this.depth);
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
          if (d > this.peak[k]) this.peak[k] = d;
          // a crest still climbing briskly past the next zone line plucks again, an octave up
          const z = this.zoneOf(d);
          if (z > this.zone[k] && this.wait[k] === 0 && this.speed[k] > p.softRate) {
            const line = this.zoneLine(z - 1), d0 = this.prevDepth[k];
            const frac = d > d0 ? clamp((line - d0) / (d - d0), 0, 1) : 1;
            this.emit(k, frac, this.speed[k], d, z);
            continue;
          }
          // one pluck per wave: wait until the water on this string recedes a
          // little or stops rising, then measure the next rise from there
          if (this.wait[k] === 0 && (d < this.peak[k] - 0.3 * p.rise || this.speed[k] < 0.5 * p.softRate)) {
            this.armed[k] = 1; this.base[k] = d; this.prevExcess[k] = 0;
          }
          continue;
        }
        if (excess >= p.rise && this.wait[k] === 0) {
          const before = this.prevExcess[k];
          const frac = excess > before ? clamp((p.rise - before) / (excess - before), 0, 1) : 1;
          this.emit(k, frac, Math.max(this.speed[k], rate), d, this.zoneOf(d));
          continue;
        }
        this.base[k] += (d - this.base[k]) * relax;            // a slow rise is caught up with
        this.prevExcess[k] = d - this.base[k];
      }
      return ev;
    }

    emit(k, frac, speed, d, zone) {
      const p = this.p;
      const vel = clamp(Math.log(Math.max(speed, 1e-6) / p.softRate) / Math.log(p.hardRate / p.softRate), 0, 1);
      this.events.push({ string: k, frac, vel: 0.25 + 0.75 * vel, depth: d, octave: zone });
      this.armed[k] = 0; this.peak[k] = d; this.zone[k] = zone;   // the next pluck needs a new wave, or a higher zone
      this.wait[k] = p.refractory;
      this.prevExcess[k] = 0;
    }
  }

  return { WaterStrum, DEFAULTS };
});
