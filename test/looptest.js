// node test/looptest.js -> the motion looper: record, loop, overdub, erase,
// the finger winning over playback, tempo independence, save and load.
const { MotionLooper } = require('../loops.js');
let fails = 0;
const ok = (cond, what) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`); if (!cond) fails++; };
const near = (a, b, e = 0.02) => Math.abs(a - b) <= e;
const FPS = 60;

// one bar (4 beats) at 120 BPM; the finger sweeps x 0 -> 1 over the bar, y fixed
function recordRamp(lp, startBeat, beats = 4, bpm = 120, key = 'filter') {
  lp.startRecording(startBeat, beats);
  const frames = Math.round(beats * 60 / bpm * FPS);
  for (let f = 0; f <= frames; f++) {
    const beat = startBeat + f * bpm / 60 / FPS;
    lp.input(key, f / frames, 0.5, beat);
    lp.update(beat);
  }
  lp.release();
  lp.update(startBeat + beats + 0.01);   // past the end: the pass closes
}

{
  const lp = new MotionLooper();
  recordRamp(lp, 0);
  ok(!lp.recording(), 'the pass stops by itself after one loop');
  const a = lp.update(4 + 1)['filter'], b = lp.update(4 + 3)['filter'];
  ok(a && near(a[0], 0.25) && near(a[1], 0.5), `plays back a quarter in: ${a && a[0].toFixed(3)}`);
  ok(b && near(b[0], 0.75), `and three quarters in: ${b && b[0].toFixed(3)}`);
  const c = lp.update(400 + 2)['filter'];
  ok(c && near(c[0], 0.5), `still in time a hundred bars later: ${c && c[0].toFixed(3)}`);
}
{
  // started mid-bar: the lane is indexed by beat, so it lines up anyway
  const lp = new MotionLooper();
  recordRamp(lp, 2.5);
  const v = lp.update(8 + 2.5)['filter'];
  ok(v && near(v[0], 0, 0.03), `a pass started at beat 2.5 replays its start at 2.5 of a later bar: ${v && v[0].toFixed(3)}`);
}
{
  // overdub only the second half: the first half survives
  const lp = new MotionLooper();
  recordRamp(lp, 0);
  lp.startRecording(4, 4);
  for (let f = 0; f <= 120; f++) { const beat = 4 + f / 30; lp.update(beat); if (beat >= 6) lp.input('filter', 0.1, 0.9, beat); }
  lp.release(); lp.update(8.01);
  const first = lp.update(8 + 1)['filter'], second = lp.update(8 + 3)['filter'];
  ok(first && near(first[0], 0.25) && near(first[1], 0.5), `overdub keeps the untouched first half: ${first && first.map(v => v.toFixed(2))}`);
  ok(second && near(second[0], 0.1) && near(second[1], 0.9), `and replaces the half played: ${second && second.map(v => v.toFixed(2))}`);
}
{
  // a lane the finger is on is not played back; other lanes are
  const lp = new MotionLooper();
  recordRamp(lp, 0, 4, 120, 'filter');
  recordRamp(lp, 4, 4, 120, 'gate');
  lp.input('filter', 0.9, 0.9, 9);
  const v = lp.update(9);
  ok(!('filter' in v) && 'gate' in v, 'the finger wins over its own lane, other lanes keep playing');
  lp.release();
  ok('filter' in lp.update(9), 'and the lane comes back when the finger lifts');
}
{
  // a part never played stays silent (no value), not zero
  const lp = new MotionLooper();
  lp.startRecording(0, 4);
  for (let f = 0; f <= 120; f++) { const beat = f / 30; lp.update(beat); if (beat < 1) lp.input('lfo', 0.5, 0.5, beat); }
  lp.release(); lp.update(4.01);
  ok('lfo' in lp.update(4.5) && !('lfo' in lp.update(6.5)), 'a stretch nothing was played in gives no value');
}
{
  // the same lane at a different tempo: positions are in beats, so it follows
  const lp = new MotionLooper();
  recordRamp(lp, 0, 4, 90);
  const v = lp.update(12 + 2)['filter'];
  ok(v && near(v[0], 0.5), `recorded at 90 BPM, half way at beat 2 of any bar: ${v && v[0].toFixed(3)}`);
}
{
  // a jerky finger: frames dropped, the gap is filled in a line
  const lp = new MotionLooper();
  lp.startRecording(0, 4);
  lp.input('pan', 0, 0, 0.0); lp.input('pan', 1, 1, 0.5);
  lp.release();
  const v = lp.update(4 + 0.25)['pan'];
  ok(v && near(v[0], 0.5, 0.05), `a gap between two writes is filled in a line: ${v && v[0].toFixed(3)}`);
}
{
  // two bars and four bars side by side, erase one, erase all, save and load
  const lp = new MotionLooper();
  recordRamp(lp, 0, 8, 120, 'trem');
  recordRamp(lp, 8, 16, 120, 'chorus');
  const s = JSON.parse(JSON.stringify(lp.toJSON()));
  const lp2 = new MotionLooper(); lp2.load(s);
  const a = lp.update(40 + 5), b = lp2.update(40 + 5);
  ok(near(a.trem[0], b.trem[0], 0.002) && near(a.chorus[0], b.chorus[0], 0.002), 'saved and loaded lanes play the same');
  lp.erase('trem');
  ok(!lp.has('trem') && lp.has('chorus'), 'erase one lane');
  lp.erase();
  ok(lp.keys().length === 0, 'erase all');
}
console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exitCode = fails ? 1 : 0;
