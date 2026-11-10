/*
 * MotionLooper: records the effects pad's moves and plays them back in loops.
 *
 * Every effect (filter, space, lfo, gate, trem, pan, chorus) can have a lane:
 * its point [x, y] sampled at SLOTS per beat over the lane's length (1, 2 or
 * 4 bars, in beats, so a lane follows any tempo). Time is the engine's beat
 * count, and a lane's position is that beat modulo its length, so a recording
 * may start at any moment and still loop in time.
 *
 * REC records one pass of the chosen length. Only what the finger touches is
 * written: a pass over an existing lane replaces the parts you play and keeps
 * the rest (overdub). A finger on the pad always wins over playback of the
 * same effect. Erase removes one lane, or all of them.
 *
 * No DOM: node test/looptest.js runs it.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MotionLooper = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const SLOTS = 24;   // per beat: 48 a second at 120 BPM, smooth enough for a thumb

  class MotionLooper {
    constructor() {
      this.lanes = {};          // key -> { beats, data: Float32Array(n * 2), NaN where nothing was played }
      this.rec = null;          // { from, until, beats } while a pass is recording
      this.touch = {};          // key -> { slot, x, y } of the finger's last write, while it is down
      this.held = null;         // the key the finger is on, if any
    }
    has(key) { return !!this.lanes[key]; }
    keys() { return Object.keys(this.lanes); }
    recording() { return !!this.rec; }
    // 0..1 through the pass being recorded
    progress(beat) { return this.rec ? Math.min(1, (beat - this.rec.from) / (this.rec.until - this.rec.from)) : 0; }

    startRecording(beat, beats) { this.rec = { from: beat, until: beat + beats, beats }; this.touch = {}; }
    stopRecording() { this.rec = null; this.touch = {}; }

    erase(key) { if (key == null) this.lanes = {}; else delete this.lanes[key]; }

    lane(key, beats) {
      let l = this.lanes[key];
      if (!l) {
        const n = Math.round(beats * SLOTS);
        l = this.lanes[key] = { beats, data: new Float32Array(n * 2).fill(NaN) };
      }
      return l;
    }
    slotOf(l, beat) {
      const n = l.data.length / 2, b = ((beat % l.beats) + l.beats) % l.beats;
      return Math.min(n - 1, Math.floor(b / l.beats * n));
    }

    // The finger is on the pad at (x, y) on effect `key`. While recording, the
    // slots since its last write are filled in a straight line, so a quick
    // move between frames leaves no holes.
    input(key, x, y, beat) {
      this.held = key;
      // a pass ends exactly where it began, so its last moment must not write over its first
      if (!this.rec || beat >= this.rec.until) return;
      const l = this.lane(key, this.rec.beats), n = l.data.length / 2, s = this.slotOf(l, beat);
      const t = this.touch[key];
      let gap = t ? (s - t.slot + n) % n : 0;
      if (gap > SLOTS) gap = 0;                     // a long jump (a lost frame): just write here
      for (let i = gap; i >= 0; i--) {
        const k = (s - i + n) % n, f = gap ? 1 - i / gap : 1;
        l.data[2 * k] = t && gap ? t.x + (x - t.x) * f : x;
        l.data[2 * k + 1] = t && gap ? t.y + (y - t.y) * f : y;
      }
      this.touch[key] = { slot: s, x, y };
    }
    release() { this.held = null; this.touch = {}; }

    // Where each lane puts its effect at this beat: { key: [x, y] }. The lane
    // the finger is on is left out, and so is a stretch nothing was played in.
    update(beat, out = {}) {
      for (const k in out) delete out[k];
      if (this.rec && beat >= this.rec.until) this.stopRecording();
      for (const key in this.lanes) {
        if (key === this.held) continue;
        const l = this.lanes[key], n = l.data.length / 2;
        const b = ((beat % l.beats) + l.beats) % l.beats, pos = b / l.beats * n;
        const i0 = Math.floor(pos) % n, i1 = (i0 + 1) % n, f = pos - Math.floor(pos);
        const x0 = l.data[2 * i0], y0 = l.data[2 * i0 + 1], x1 = l.data[2 * i1], y1 = l.data[2 * i1 + 1];
        if (x0 === x0 && x1 === x1) out[key] = [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f];
        else if (x0 === x0) out[key] = [x0, y0];
      }
      return out;
    }

    // for saving between visits: lanes as plain numbers, 3 decimals
    toJSON() {
      const o = {};
      for (const k in this.lanes) o[k] = { beats: this.lanes[k].beats, data: Array.from(this.lanes[k].data, v => (v === v ? Math.round(v * 1000) / 1000 : null)) };
      return o;
    }
    load(o) {
      this.lanes = {};
      for (const k in o || {}) {
        const src = o[k];
        if (!src || !Array.isArray(src.data) || !(src.beats > 0)) continue;
        this.lanes[k] = { beats: src.beats, data: Float32Array.from(src.data, v => (v == null ? NaN : v)) };
      }
    }
  }
  return { MotionLooper, SLOTS };
});
