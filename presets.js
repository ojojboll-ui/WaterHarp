/*
 * Water presets: how the liquid behaves, and so how it strums.
 * size  = tank width in metres (small = quick waves, fast sweeps)
 * fill  = share of the tank filled
 * flip  = liveliness: 0 thick and calm (PIC), 1 lively and splashy (FLIP)
 * damping = how fast motion dies out, per second
 * gravity = how hard a tilt pulls, in g
 * Shared by the page and test/presettest.js.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WaterPresets = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  return {
    Water:  { size: 0.35, fill: 0.30, flip: 0.90, damping: 0.05, gravity: 1.0,  note: 'The default: clear sweeps that slosh back a few times.' },
    Puddle: { size: 0.25, fill: 0.14, flip: 0.92, damping: 0.08, gravity: 1.0,  note: 'A thin layer that runs across the board: quick, light strums.' },
    Swell:  { size: 1.20, fill: 0.45, flip: 0.95, damping: 0.02, gravity: 1.0,  note: 'A big tank: slow swells that keep rolling.' },
    Splash: { size: 0.30, fill: 0.30, flip: 0.98, damping: 0.01, gravity: 1.4,  note: 'Lively and wild: many plucks, crests that climb high.' },
    Honey:  { size: 0.35, fill: 0.35, flip: 0.05, damping: 1.50, gravity: 1.0,  note: 'Thick and slow: one soft sweep per tilt, then still.' },
    Moon:   { size: 0.45, fill: 0.30, flip: 0.95, damping: 0.02, gravity: 0.25, note: 'Low gravity: floating, slow waves that rise high.' },
  };
});
