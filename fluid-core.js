/*
 * fluid-core.js - portable 2D liquid (FLIP/PIC) for tilt games, LED matrices,
 * screensavers, phones and watches.
 *
 * Algorithm: particles carry the fluid, a staggered MAC grid makes it
 * incompressible each substep (after Matthias Müller, "Ten Minute Physics" #18,
 * written from scratch here). No DOM, no allocation inside step(): every array
 * is made in build, so this ports line for line to C on a microcontroller.
 *
 * Coordinates: metres, x to the right, y DOWN (screen convention). The tank
 * is `width` metres wide inside a one-cell solid border. Gravity (gx, gy) is in
 * m/s^2 in the same frame: (0, 9.81) pulls toward the bottom of the screen.
 *
 * Resolution is three separate choices:
 *   cellsX        - simulation cells across the tank (cost)
 *   field         - a smoothed coverage image at 2x cell resolution (computeField)
 *   rasterize()   - any output size, from 2x2 LEDs to thousands of pixels.
 *                   Bigger output pixels average (antialias), smaller ones
 *                   interpolate, so the surface stays smooth at every scale.
 * Simulate at least ~2x finer than an LED matrix: an 8x8 matrix looks best
 * from a 16-24 cell sim.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FluidCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FLUID = 0, AIR = 1, SOLID = 2;
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  const DEFAULT_PARAMS = {
    flipRatio: 0.9,      // 0 = PIC (thick, calm), 1 = pure FLIP (lively, noisy)
    damping: 0.05,       // velocity loss per second (viscosity-like)
    pressureIters: 40,   // Gauss-Seidel iterations per substep
    overRelax: 1.9,
    driftK: 1.0,         // pushes compressed regions apart (keeps volume)
    driftShare: 0.4,     // share of the excess packing removed per substep
    separateIters: 2,    // particle push-apart passes
    minSubsteps: 1,
    maxSubsteps: 4,      // substeps grow when particles move fast
    cflCells: 2.0,       // allowed travel per substep, in cells
    gravCells: 0.45,     // ... and how far gravity alone may move water per substep: small tanks need more steps
    blurPasses: 2,       // field smoothing (each pass ~ half a cell)
  };

  class FluidSim {
    constructor(opts = {}) {
      this.params = Object.assign({}, DEFAULT_PARAMS, opts.params || {});
      this.gx = 0; this.gy = 9.81;
      this.obstacle = { active: false, x: 0, y: 0, vx: 0, vy: 0, r: 0 };
      this.time = 0; this.maxSpeed = 0; this.lastSubsteps = 1;
      this.build(opts);
    }

    /* Geometry: { cellsX, aspect (h/w), shape 'box'|'circle', width (m), fill 0..1 } */
    build(o = {}) {
      this.cellsX = Math.max(3, Math.round(o.cellsX ?? this.cellsX ?? 48));
      this.aspect = o.aspect ?? this.aspect ?? 1;
      this.shape = o.shape ?? this.shape ?? 'box';
      if (this.shape === 'circle') this.aspect = 1;
      this.width = o.width ?? this.width ?? 1;
      this.fill = clamp(o.fill ?? this.fill ?? 0.4, 0.005, 0.95);

      const innerX = this.cellsX;
      const innerY = Math.max(3, Math.round(innerX * this.aspect));
      this.innerX = innerX; this.innerY = innerY;
      const h = this.width / innerX;
      this.h = h; this.invH = 1 / h;
      const nx = innerX + 2, ny = innerY + 2;
      this.nx = nx; this.ny = ny;
      this.W = nx * h; this.H = ny * h;
      const N = nx * ny;
      this.u = new Float32Array(N); this.v = new Float32Array(N);
      this.du = new Float32Array(N); this.dv = new Float32Array(N);
      this.prevU = new Float32Array(N); this.prevV = new Float32Array(N);
      this.s = new Float32Array(N);
      this.cellType = new Uint8Array(N);
      this.density = new Float32Array(N);

      // tank shape: solid border, plus everything outside the circle
      this.cx = this.W / 2; this.cy = this.H / 2;
      this.cR = Math.min(innerX, innerY) * h / 2;
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
        let solid = i === 0 || j === 0 || i === nx - 1 || j === ny - 1;
        if (!solid && this.shape === 'circle') {
          const dx = (i + 0.5) * h - this.cx, dy = (j + 0.5) * h - this.cy;
          solid = dx * dx + dy * dy > this.cR * this.cR;
        }
        this.s[i * ny + j] = solid ? 0 : 1;
      }

      // particles: hexagonal packing, spacing 2r
      const r = 0.3 * h; this.pr = r;
      const dx = 2 * r, dy = Math.sqrt(3) / 2 * dx;
      this.restDensity = (h * h) / (dx * dy); // particles per cell when packed
      const area = this.shape === 'circle' ? Math.PI * this.cR * this.cR : innerX * innerY * h * h;
      const target = Math.max(1, Math.round(this.fill * area / (dx * dy)));
      this._seed(target, dx, dy);

      // spatial hash for push-apart
      this.pInv = 1 / (2.2 * r);
      this.pnx = Math.floor(this.W * this.pInv) + 1;
      this.pny = Math.floor(this.H * this.pInv) + 1;
      const pnc = this.pnx * this.pny;
      this.cellCount = new Int32Array(pnc);
      this.cellFirst = new Int32Array(pnc + 1);
      this.cellIds = new Int32Array(this.numP);

      // render field, 2x the cell resolution, row-major (texture order)
      this.fnx = nx * 2; this.fny = ny * 2;
      const FN = this.fnx * this.fny;
      this.F = new Float32Array(FN);   // coverage, ~1 inside the liquid
      this.S = new Float32Array(FN);   // speed, ~1 = brisk sloshing
      this.tmpA = new Float32Array(FN); this.tmpB = new Float32Array(FN);
      this.mask = new Float32Array(FN); this.maskBlur = new Float32Array(FN);
      const hf = h / 2;
      this.fieldRest = (hf * hf) / (dx * dy);
      for (let y = 0; y < this.fny; y++) for (let x = 0; x < this.fnx; x++) {
        const px = (x + 0.5) * hf, py = (y + 0.5) * hf;
        let inside = px > h && px < this.W - h && py > h && py < this.H - h;
        if (inside && this.shape === 'circle') {
          const ddx = px - this.cx, ddy = py - this.cy;
          inside = ddx * ddx + ddy * ddy < this.cR * this.cR;
        }
        this.mask[y * this.fnx + x] = inside ? 1 : 0;
      }
      this.maskBlur.set(this.mask);
      for (let k = 0; k < this.params.blurPasses; k++) this._blur(this.maskBlur, this.tmpA);
      this.speedRef = 0.5 * Math.sqrt(9.81 * Math.min(innerX, innerY) * h);
      this.time = 0;
      return this;
    }

    // Place `target` particles, filling "downhill" along the current gravity.
    _seed(target, dx, dy) {
      const h = this.h, r = this.pr;
      const cand = [];
      const x0 = h + r, x1 = this.W - h - r, y0 = h + r, y1 = this.H - h - r;
      const R2 = (this.cR - r) * (this.cR - r);
      let row = 0;
      for (let y = y0; y <= y1; y += dy, row++) {
        for (let x = x0 + (row & 1 ? r : 0); x <= x1; x += dx) {
          if (this.shape === 'circle') {
            const ddx = x - this.cx, ddy = y - this.cy;
            if (ddx * ddx + ddy * ddy > R2) continue;
          }
          cand.push(x, y);
        }
      }
      const n = cand.length / 2;
      const gl = Math.hypot(this.gx, this.gy);
      const gx = gl > 1e-6 ? this.gx / gl : 0, gy = gl > 1e-6 ? this.gy / gl : 1;
      // binary search the level k so that count(key >= k) ~= target
      let lo = -1e9, hi = 1e9, minK = Infinity, maxK = -Infinity;
      for (let i = 0; i < n; i++) { const k = cand[2 * i] * gx + cand[2 * i + 1] * gy; if (k < minK) minK = k; if (k > maxK) maxK = k; }
      lo = minK - 1; hi = maxK + 1;
      const want = Math.min(target, n);
      for (let it = 0; it < 40; it++) {
        const mid = 0.5 * (lo + hi);
        let c = 0;
        for (let i = 0; i < n; i++) if (cand[2 * i] * gx + cand[2 * i + 1] * gy >= mid) c++;
        if (c > want) lo = mid; else hi = mid;
      }
      this.pos = new Float32Array(want * 2);
      this.vel = new Float32Array(want * 2);
      let p = 0;
      for (let i = 0; i < n && p < want; i++) {
        if (cand[2 * i] * gx + cand[2 * i + 1] * gy >= hi) { this.pos[2 * p] = cand[2 * i]; this.pos[2 * p + 1] = cand[2 * i + 1]; p++; }
      }
      for (let i = 0; i < n && p < want; i++) { // top up any rounding shortfall
        const k = cand[2 * i] * gx + cand[2 * i + 1] * gy;
        if (k < hi && k >= lo) { this.pos[2 * p] = cand[2 * i]; this.pos[2 * p + 1] = cand[2 * i + 1]; p++; }
      }
      this.numP = p;
    }

    /* Change the tank's physical size without losing the current state. */
    setWidth(w) {
      const k = w / this.width;
      if (!isFinite(k) || k <= 0 || k === 1) return;
      this.width = w; this.h *= k; this.invH = 1 / this.h; this.W *= k; this.H *= k;
      this.pr *= k; this.cR *= k; this.cx *= k; this.cy *= k; this.pInv /= k;
      this.speedRef *= Math.sqrt(k);
      for (let i = 0; i < this.numP * 2; i++) { this.pos[i] *= k; this.vel[i] *= k; }
      for (let i = 0; i < this.u.length; i++) { this.u[i] *= k; this.v[i] *= k; }
    }

    step(dt) {
      if (!(dt > 0)) return;
      const P = this.params;
      // Substeps: enough that the fastest particle crosses at most cflCells per
      // step, and that gravity alone moves water at most gravCells (g sdt^2 < gravCells h).
      // Without the second rule a small tank (cells of a few mm) jitters and splashes at rest.
      const g = Math.hypot(this.gx, this.gy);
      const nGrav = Math.ceil(Math.sqrt(g * dt * dt / (this.h * (P.gravCells ?? 0.45))));
      const n = clamp(Math.max(Math.ceil(this.maxSpeed * dt / (this.h * P.cflCells)), nGrav), P.minSubsteps, P.maxSubsteps);
      this.lastSubsteps = n;
      const sdt = dt / n;
      for (let k = 0; k < n; k++) {
        this._integrate(sdt);
        if (P.separateIters > 0) this._pushApart(Math.ceil(P.separateIters / n));
        this._collide();
        this._toGrid();
        this._updateDensity();
        this._project(sdt);
        this._toParticles();
      }
      this.time += dt;
    }

    _integrate(sdt) {
      const pos = this.pos, vel = this.vel;
      const gx = this.gx * sdt, gy = this.gy * sdt;
      const damp = Math.exp(-this.params.damping * sdt);
      const vmax = 4 * this.h / sdt, vmax2 = vmax * vmax;
      let m2 = 0;
      for (let i = 0; i < this.numP; i++) {
        let vx = (vel[2 * i] + gx) * damp, vy = (vel[2 * i + 1] + gy) * damp;
        let v2 = vx * vx + vy * vy;
        if (v2 > vmax2) { const s = vmax / Math.sqrt(v2); vx *= s; vy *= s; v2 = vmax2; }
        if (v2 > m2) m2 = v2;
        vel[2 * i] = vx; vel[2 * i + 1] = vy;
        pos[2 * i] += vx * sdt; pos[2 * i + 1] += vy * sdt;
      }
      this.maxSpeed = Math.sqrt(m2);
    }

    _pushApart(iters) {
      const pos = this.pos, pInv = this.pInv, pnx = this.pnx, pny = this.pny;
      const count = this.cellCount, first = this.cellFirst, ids = this.cellIds, np = this.numP;
      const pnc = pnx * pny;
      count.fill(0);
      for (let i = 0; i < np; i++) {
        const xi = clamp(Math.floor(pos[2 * i] * pInv), 0, pnx - 1);
        const yi = clamp(Math.floor(pos[2 * i + 1] * pInv), 0, pny - 1);
        count[xi * pny + yi]++;
      }
      let acc = 0;
      for (let c = 0; c < pnc; c++) { acc += count[c]; first[c] = acc; }
      first[pnc] = acc;
      for (let i = 0; i < np; i++) {
        const xi = clamp(Math.floor(pos[2 * i] * pInv), 0, pnx - 1);
        const yi = clamp(Math.floor(pos[2 * i + 1] * pInv), 0, pny - 1);
        const c = xi * pny + yi;
        first[c]--; ids[first[c]] = i;
      }
      const minDist = 2 * this.pr, minDist2 = minDist * minDist;
      for (let it = 0; it < iters; it++) {
        for (let i = 0; i < np; i++) {
          let px = pos[2 * i], py = pos[2 * i + 1];
          const pxi = Math.floor(px * pInv), pyi = Math.floor(py * pInv);
          const xa = Math.max(pxi - 1, 0), ya = Math.max(pyi - 1, 0);
          const xb = Math.min(pxi + 1, pnx - 1), yb = Math.min(pyi + 1, pny - 1);
          for (let xi = xa; xi <= xb; xi++) for (let yi = ya; yi <= yb; yi++) {
            const c = xi * pny + yi;
            for (let j = first[c], e = first[c + 1]; j < e; j++) {
              const id = ids[j];
              if (id <= i) continue; // each pair once
              let dx = pos[2 * id] - px, dy = pos[2 * id + 1] - py;
              const d2 = dx * dx + dy * dy;
              if (d2 > minDist2 || d2 === 0) continue;
              const d = Math.sqrt(d2), s = 0.5 * (minDist - d) / d;
              dx *= s; dy *= s;
              px -= dx; py -= dy;
              pos[2 * id] += dx; pos[2 * id + 1] += dy;
            }
          }
          pos[2 * i] = px; pos[2 * i + 1] = py;
        }
      }
    }

    _collide() {
      const pos = this.pos, vel = this.vel, h = this.h, r = this.pr;
      const minX = h + r, maxX = this.W - h - r, minY = h + r, maxY = this.H - h - r;
      const ob = this.obstacle, oR = ob.r + r, oR2 = oR * oR;
      const circle = this.shape === 'circle', cx = this.cx, cy = this.cy, Rp = this.cR - r, Rp2 = Rp * Rp;
      for (let i = 0; i < this.numP; i++) {
        let x = pos[2 * i], y = pos[2 * i + 1];
        if (ob.active) {
          const dx = x - ob.x, dy = y - ob.y, d2 = dx * dx + dy * dy;
          if (d2 < oR2) {
            const d = Math.sqrt(d2) || 1e-6, k = oR / d;
            x = ob.x + dx * k; y = ob.y + dy * k;
            vel[2 * i] = ob.vx; vel[2 * i + 1] = ob.vy;
          }
        }
        if (circle) {
          const dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy;
          if (d2 > Rp2) {
            const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
            x = cx + nx * Rp; y = cy + ny * Rp;
            const vn = vel[2 * i] * nx + vel[2 * i + 1] * ny;
            if (vn > 0) { vel[2 * i] -= vn * nx; vel[2 * i + 1] -= vn * ny; }
          }
        }
        if (x < minX) { x = minX; vel[2 * i] = 0; }
        if (x > maxX) { x = maxX; vel[2 * i] = 0; }
        if (y < minY) { y = minY; vel[2 * i + 1] = 0; }
        if (y > maxY) { y = maxY; vel[2 * i + 1] = 0; }
        pos[2 * i] = x; pos[2 * i + 1] = y;
      }
    }

    _toGrid() {
      const nx = this.nx, ny = this.ny, h = this.h, inv = this.invH, h2 = 0.5 * h;
      const pos = this.pos, vel = this.vel, cellType = this.cellType, s = this.s;
      this.prevU.set(this.u); this.prevV.set(this.v);
      this.du.fill(0); this.dv.fill(0); this.u.fill(0); this.v.fill(0);
      for (let i = 0; i < cellType.length; i++) cellType[i] = s[i] === 0 ? SOLID : AIR;
      for (let i = 0; i < this.numP; i++) {
        const xi = clamp(Math.floor(pos[2 * i] * inv), 0, nx - 1);
        const yi = clamp(Math.floor(pos[2 * i + 1] * inv), 0, ny - 1);
        const c = xi * ny + yi;
        if (cellType[c] === AIR) cellType[c] = FLUID;
      }
      for (let comp = 0; comp < 2; comp++) {
        const ox = comp === 0 ? 0 : h2, oy = comp === 0 ? h2 : 0;
        const f = comp === 0 ? this.u : this.v, d = comp === 0 ? this.du : this.dv;
        for (let i = 0; i < this.numP; i++) {
          const x = clamp(pos[2 * i], h, (nx - 1) * h) - ox;
          const y = clamp(pos[2 * i + 1], h, (ny - 1) * h) - oy;
          const x0 = Math.min(Math.floor(x * inv), nx - 2), tx = (x - x0 * h) * inv, x1 = Math.min(x0 + 1, nx - 2);
          const y0 = Math.min(Math.floor(y * inv), ny - 2), ty = (y - y0 * h) * inv, y1 = Math.min(y0 + 1, ny - 2);
          const sx = 1 - tx, sy = 1 - ty;
          const w0 = sx * sy, w1 = tx * sy, w2 = tx * ty, w3 = sx * ty;
          const n0 = x0 * ny + y0, n1 = x1 * ny + y0, n2 = x1 * ny + y1, n3 = x0 * ny + y1;
          const pv = vel[2 * i + comp];
          f[n0] += pv * w0; d[n0] += w0;
          f[n1] += pv * w1; d[n1] += w1;
          f[n2] += pv * w2; d[n2] += w2;
          f[n3] += pv * w3; d[n3] += w3;
        }
        for (let i = 0; i < f.length; i++) if (d[i] > 0) f[i] /= d[i];
        const prev = comp === 0 ? this.prevU : this.prevV;
        for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
          const c = i * ny + j, solid = cellType[c] === SOLID;
          if (comp === 0) { if (solid || (i > 0 && cellType[c - ny] === SOLID)) f[c] = prev[c]; }
          else if (solid || (j > 0 && cellType[c - 1] === SOLID)) f[c] = prev[c];
        }
      }
    }

    _updateDensity() {
      const nx = this.nx, ny = this.ny, h = this.h, inv = this.invH, h2 = 0.5 * h;
      const d = this.density, pos = this.pos;
      d.fill(0);
      for (let i = 0; i < this.numP; i++) {
        const x = clamp(pos[2 * i], h, (nx - 1) * h) - h2;
        const y = clamp(pos[2 * i + 1], h, (ny - 1) * h) - h2;
        const x0 = Math.floor(x * inv), tx = (x - x0 * h) * inv, x1 = Math.min(x0 + 1, nx - 2);
        const y0 = Math.floor(y * inv), ty = (y - y0 * h) * inv, y1 = Math.min(y0 + 1, ny - 2);
        const sx = 1 - tx, sy = 1 - ty;
        if (x0 < nx && y0 < ny) d[x0 * ny + y0] += sx * sy;
        if (x1 < nx && y0 < ny) d[x1 * ny + y0] += tx * sy;
        if (x1 < nx && y1 < ny) d[x1 * ny + y1] += tx * ty;
        if (x0 < nx && y1 < ny) d[x0 * ny + y1] += sx * ty;
      }
    }

    _project(sdt) {
      const nx = this.nx, ny = this.ny, u = this.u, v = this.v, s = this.s, ct = this.cellType;
      const P = this.params, iters = P.pressureIters, omega = P.overRelax;
      const rest = this.restDensity, dens = this.density;
      // Drift compensation as a divergence: remove a share of the excess packing
      // per substep. In velocity units that is share * (excess / rest) * h / sdt,
      // so it means the same at any cell size and step. (A bare excess-in-particles
      // term, as in the usual FLIP demos, overcorrects many times over in a small
      // tank and the resting water boils.)
      const k = P.driftK * (P.driftShare ?? 0.4) * this.h / (rest * Math.max(sdt, 1e-6));
      this.prevU.set(u); this.prevV.set(v);
      for (let it = 0; it < iters; it++) {
        for (let i = 1; i < nx - 1; i++) for (let j = 1; j < ny - 1; j++) {
          const c = i * ny + j;
          if (ct[c] !== FLUID) continue;
          const left = c - ny, right = c + ny, top = c - 1, bottom = c + 1;
          const sx0 = s[left], sx1 = s[right], sy0 = s[top], sy1 = s[bottom];
          const st = sx0 + sx1 + sy0 + sy1;
          if (st === 0) continue;
          let div = u[right] - u[c] + v[bottom] - v[c];
          if (k > 0) { const comp = dens[c] - rest; if (comp > 0) div -= k * comp; }
          const p = (-div / st) * omega;
          u[c] -= sx0 * p; u[right] += sx1 * p;
          v[c] -= sy0 * p; v[bottom] += sy1 * p;
        }
      }
    }

    _toParticles() {
      const nx = this.nx, ny = this.ny, h = this.h, inv = this.invH, h2 = 0.5 * h;
      const pos = this.pos, vel = this.vel, ct = this.cellType, flip = this.params.flipRatio;
      for (let comp = 0; comp < 2; comp++) {
        const ox = comp === 0 ? 0 : h2, oy = comp === 0 ? h2 : 0;
        const f = comp === 0 ? this.u : this.v, prev = comp === 0 ? this.prevU : this.prevV;
        const off = comp === 0 ? ny : 1;
        for (let i = 0; i < this.numP; i++) {
          const x = clamp(pos[2 * i], h, (nx - 1) * h) - ox;
          const y = clamp(pos[2 * i + 1], h, (ny - 1) * h) - oy;
          const x0 = Math.min(Math.floor(x * inv), nx - 2), tx = (x - x0 * h) * inv, x1 = Math.min(x0 + 1, nx - 2);
          const y0 = Math.min(Math.floor(y * inv), ny - 2), ty = (y - y0 * h) * inv, y1 = Math.min(y0 + 1, ny - 2);
          const sx = 1 - tx, sy = 1 - ty;
          const n0 = x0 * ny + y0, n1 = x1 * ny + y0, n2 = x1 * ny + y1, n3 = x0 * ny + y1;
          const v0 = (ct[n0] !== AIR || ct[n0 - off] !== AIR) ? sx * sy : 0;
          const v1 = (ct[n1] !== AIR || ct[n1 - off] !== AIR) ? tx * sy : 0;
          const v2 = (ct[n2] !== AIR || ct[n2 - off] !== AIR) ? tx * ty : 0;
          const v3 = (ct[n3] !== AIR || ct[n3 - off] !== AIR) ? sx * ty : 0;
          const d = v0 + v1 + v2 + v3;
          if (d > 0) {
            const pic = (v0 * f[n0] + v1 * f[n1] + v2 * f[n2] + v3 * f[n3]) / d;
            const corr = (v0 * (f[n0] - prev[n0]) + v1 * (f[n1] - prev[n1]) + v2 * (f[n2] - prev[n2]) + v3 * (f[n3] - prev[n3])) / d;
            const pv = vel[2 * i + comp];
            vel[2 * i + comp] = (1 - flip) * pic + flip * (pv + corr);
          }
        }
      }
    }

    // separable [1 2 1]/4 blur in place
    _blur(a, tmp) {
      const w = this.fnx, hgt = this.fny;
      for (let y = 0; y < hgt; y++) {
        const r = y * w;
        for (let x = 0; x < w; x++) {
          const l = a[r + (x > 0 ? x - 1 : x)], m = a[r + x], rr = a[r + (x < w - 1 ? x + 1 : x)];
          tmp[r + x] = 0.25 * l + 0.5 * m + 0.25 * rr;
        }
      }
      for (let y = 0; y < hgt; y++) {
        const up = (y > 0 ? y - 1 : y) * w, r = y * w, dn = (y < hgt - 1 ? y + 1 : y) * w;
        for (let x = 0; x < w; x++) a[r + x] = 0.25 * tmp[up + x] + 0.5 * tmp[r + x] + 0.25 * tmp[dn + x];
      }
    }

    /*
     * Build the coverage field F (~0 air, ~1 liquid, >1 compressed) and speed
     * field S (0..~2) at 2x cell resolution. Call once per rendered frame.
     */
    computeField() {
      const fnx = this.fnx, fny = this.fny, F = this.F, S = this.S, pos = this.pos, vel = this.vel;
      F.fill(0); S.fill(0);
      const inv = 2 * this.invH, sref = 1 / this.speedRef;
      for (let i = 0; i < this.numP; i++) {
        let fx = pos[2 * i] * inv - 0.5, fy = pos[2 * i + 1] * inv - 0.5;
        let x0 = Math.floor(fx), y0 = Math.floor(fy);
        let tx = fx - x0, ty = fy - y0;
        if (x0 < 0) { x0 = 0; tx = 0; } else if (x0 > fnx - 2) { x0 = fnx - 2; tx = 1; }
        if (y0 < 0) { y0 = 0; ty = 0; } else if (y0 > fny - 2) { y0 = fny - 2; ty = 1; }
        const sp = Math.hypot(vel[2 * i], vel[2 * i + 1]) * sref;
        const c = y0 * fnx + x0;
        const w0 = (1 - tx) * (1 - ty), w1 = tx * (1 - ty), w2 = (1 - tx) * ty, w3 = tx * ty;
        F[c] += w0; F[c + 1] += w1; F[c + fnx] += w2; F[c + fnx + 1] += w3;
        S[c] += w0 * sp; S[c + 1] += w1 * sp; S[c + fnx] += w2 * sp; S[c + fnx + 1] += w3 * sp;
      }
      for (let k = 0; k < this.params.blurPasses; k++) { this._blur(F, this.tmpA); this._blur(S, this.tmpA); }
      const mask = this.mask, mb = this.maskBlur, invRest = 1 / this.fieldRest;
      for (let i = 0; i < F.length; i++) {
        if (mask[i] > 0) {
          const f = F[i];
          S[i] = f > 1e-6 ? S[i] / f : 0;
          F[i] = f * invRest / Math.max(mb[i], 0.2);
        } else { F[i] = -1; S[i] = 0; }
      }
      // extend values one cell past the wall so bilinear lookups stay full at the edge
      const A = this.tmpA, B = this.tmpB;
      A.set(F); B.set(S);
      for (let y = 0; y < fny; y++) for (let x = 0; x < fnx; x++) {
        const i = y * fnx + x;
        if (mask[i] > 0) continue;
        let sf = 0, ss = 0, n = 0;
        if (x > 0 && mask[i - 1] > 0) { sf += A[i - 1]; ss += B[i - 1]; n++; }
        if (x < fnx - 1 && mask[i + 1] > 0) { sf += A[i + 1]; ss += B[i + 1]; n++; }
        if (y > 0 && mask[i - fnx] > 0) { sf += A[i - fnx]; ss += B[i - fnx]; n++; }
        if (y < fny - 1 && mask[i + fnx] > 0) { sf += A[i + fnx]; ss += B[i + fnx]; n++; }
        if (n) { F[i] = sf / n; S[i] = ss / n; } else F[i] = 0;
      }
    }

    /* Bilinear lookup of F/S in field cells (fx, fy measured from the field origin). */
    _sample(arr, fx, fy) {
      const fnx = this.fnx, fny = this.fny;
      fx -= 0.5; fy -= 0.5;
      let x0 = Math.floor(fx), y0 = Math.floor(fy);
      let tx = fx - x0, ty = fy - y0;
      if (x0 < 0) { x0 = 0; tx = 0; } else if (x0 > fnx - 2) { x0 = fnx - 2; tx = 1; }
      if (y0 < 0) { y0 = 0; ty = 0; } else if (y0 > fny - 2) { y0 = fny - 2; ty = 1; }
      const c = y0 * fnx + x0;
      return (arr[c] * (1 - tx) + arr[c + 1] * tx) * (1 - ty) + (arr[c + fnx] * (1 - tx) + arr[c + fnx + 1] * tx) * ty;
    }

    /*
     * Render the tank interior to outW x outH values in [0,1] (liquid share of
     * each pixel). Pixels outside a round tank get -1. `spd` (optional) gets
     * the mean speed of the liquid in each pixel. Call computeField() first.
     * For physical LEDs, apply gamma (~2.2) when converting to PWM.
     * aa = false gives hard pixels: each one is fully on when liquid covers
     * at least half of it, otherwise off.
     */
    rasterize(outW, outH, cov, spd, threshold = 0.5, softness = 0.12, aa = true) {
      const x0 = 2, y0 = 2, iw = this.fnx - 4, ih = this.fny - 4;
      const pw = iw / outW, ph = ih / outH;
      const ssx = clamp(Math.ceil(pw), 1, 8), ssy = clamp(Math.ceil(ph), 1, 8);
      const lo = threshold - softness, hi = threshold + softness, inv = 1 / (ssx * ssy);
      const circle = this.shape === 'circle';
      for (let py = 0; py < outH; py++) for (let px = 0; px < outW; px++) {
        const o = py * outW + px;
        if (circle) {
          const dx = (px + 0.5) / outW - 0.5, dy = (py + 0.5) / outH - 0.5;
          if (dx * dx + dy * dy > 0.25) { cov[o] = -1; if (spd) spd[o] = 0; continue; }
        }
        let a = 0, as = 0;
        for (let sy = 0; sy < ssy; sy++) {
          const fy = y0 + (py + (sy + 0.5) / ssy) * ph;
          for (let sx = 0; sx < ssx; sx++) {
            const fx = x0 + (px + (sx + 0.5) / ssx) * pw;
            const w = smoothstep(lo, hi, this._sample(this.F, fx, fy));
            a += w;
            if (spd && w > 0) as += w * this._sample(this.S, fx, fy);
          }
        }
        cov[o] = aa ? a * inv : (a * inv >= 0.5 ? 1 : 0);
        if (spd) spd[o] = a > 0 ? as / a : 0;
      }
    }

    /* Inner tank rectangle in field-texture coordinates (for GPU renderers). */
    fieldUV() { return [2 / this.fnx, 2 / this.fny, (this.fnx - 2) / this.fnx, (this.fny - 2) / this.fny]; }

    /* Map a 0..1 position inside the tank's inner rectangle to sim metres. */
    tankToSim(tx, ty) { return [this.h + tx * this.innerX * this.h, this.h + ty * this.innerY * this.h]; }
  }

  return { FluidSim, DEFAULT_PARAMS, smoothstep };
});
