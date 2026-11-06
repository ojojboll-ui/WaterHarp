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
 * lines, like frets across the strings, cutting the height from the water
 * line to the top into equal bands. A pluck sounds in the octave of the
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
    zoneTop: 0.95,      // the zones split the height from the water line up to here evenly
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
      this.flow = new Float32Array(count);     // water flowing across each string (see measure)
      this.vxSum = new Float32Array(count); this.wSum = new Float32Array(count);
      this.dropWait = new Float32Array(count);
      this.drops = [];                         // loose droplets that crossed a string last update()
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
      this.prevX = new Float32Array(sim.numP);
      this.primed = false;
    }

    measure(sim, dt = 1 / 60) {
      const d = this.depth, n = this.n, x0 = this.x[0], sp = this.spacing, half = sp;
      const vs = this.vxSum, ws = this.wSum;
      d.fill(0); vs.fill(0); ws.fill(0);
      const pos = sim.pos, vel = sim.vel;
      for (let i = 0; i < sim.numP; i++) {
        const t = (pos[2 * i] - x0) / sp;             // in string spacings from the first string
        const k0 = Math.floor(t);
        for (let k = k0; k <= k0 + 1; k++) {
          if (k < 0 || k >= n) continue;
          const w = 1 - Math.abs(pos[2 * i] - this.x[k]) / half;
          if (w > 0) { d[k] += w; vs[k] += w * vel[2 * i]; }
        }
      }
      // particles -> depth: each particle stands for one packing cell of area
      const area = sim.h * sim.h / sim.restDensity, tankH = sim.innerY * sim.h, tankW = sim.innerX * sim.h;
      const s = area / half / tankH;
      let sum = 0;
      // flow: depth times the water's mean sideways speed there, in tank widths
      // a second, smoothed over ~60 ms; still water reads zero, however deep
      const fa = this.primed ? 1 - Math.exp(-dt / 0.06) : 1;
      for (let k = 0; k < n; k++) {
        const mean = d[k] > 0 ? vs[k] / d[k] : 0;
        d[k] *= s; sum += d[k];
        this.flow[k] += (d[k] * Math.abs(mean) / tankW - this.flow[k]) * fa;
      }
      // the water's volume is the same however it sloshes, so the mean depth
      // over the strings is its resting level (smoothed, so the lines hold still)
      const mean = sum / n;
      this.rest = this.primed ? this.rest + (mean - this.rest) * 0.02 : mean;
    }

    // Height of zone line i (0-based), as a share of the tank's height: the
    // span from the water line to zoneTop is cut into span + 1 equal bands
    zoneLine(i) { const top = Math.max(this.p.zoneTop, this.rest + 0.1); return this.rest + (i + 1) * (top - this.rest) / (this.p.span + 1); }
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
      this.measure(sim, dt);
      const p = this.p, ev = this.events;
      ev.length = 0;
      if (!this.primed) { this.base.set(this.depth); this.prevExcess.fill(0); this.keepX(sim); this.primed = true; return ev; }
      this.findDrops(sim, dt);
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

    keepX(sim) {
      if (!this.prevX || this.prevX.length !== sim.numP) this.prevX = new Float32Array(sim.numP);
      for (let i = 0; i < sim.numP; i++) this.prevX[i] = sim.pos[2 * i];
    }

    // Loose droplets that flew across a string since the last frame. A
    // particle is loose when the 3x3 cells around it hold little water (a
    // splash, or spray thrown off a crest), unlike one in the body or at its
    // surface. At most one drop per string per frame, then a short wait.
    findDrops(sim, dt) {
      const out = this.drops, p = this.p, n = this.n, x0 = this.x[0], sp = this.spacing;
      out.length = 0;
      for (let k = 0; k < n; k++) this.dropWait[k] = Math.max(0, this.dropWait[k] - dt);
      const pos = sim.pos, vel = sim.vel, dens = sim.density, ny = sim.ny, nx = sim.nx, inv = sim.invH;
      const loose = (p.looseK ?? 1.2) * sim.restDensity, tankW = sim.innerX * sim.h;
      for (let i = 0; i < sim.numP; i++) {
        const xa = this.prevX[i], xb = pos[2 * i];
        const ta = (xa - x0) / sp, tb = (xb - x0) / sp;
        const k = Math.ceil(Math.min(ta, tb));                 // the string whose line lies between
        if (k > Math.floor(Math.max(ta, tb)) || k < 0 || k >= n || this.dropWait[k] > 0) continue;
        const ci = Math.floor(xb * inv), cj = Math.floor(pos[2 * i + 1] * inv);
        let around = 0;
        for (let a = ci - 1; a <= ci + 1; a++) for (let b = cj - 1; b <= cj + 1; b++)
          if (a >= 0 && a < nx && b >= 0 && b < ny) around += dens[a * ny + b];
        if (around > loose) continue;
        const speed = Math.hypot(vel[2 * i], vel[2 * i + 1]) / tankW;   // tank widths a second
        out.push({ string: k, frac: clamp((k - ta) / (tb - ta), 0, 1), speed, y: 1 - (pos[2 * i + 1] - sim.h) / (sim.innerY * sim.h) });
        this.dropWait[k] = p.dropWait ?? 0.06;
      }
      for (let i = 0; i < sim.numP; i++) this.prevX[i] = pos[2 * i];
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
