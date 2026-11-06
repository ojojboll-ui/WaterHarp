# WaterHarp

A water harp for your phone. Water sloshes over thirteen invisible strings. Hold a chord with your left thumb, then tilt the phone or drag through the water: every wave that runs onto a string plucks it, so a quick tilt sweeps the chord like a strum.

**Play it:** https://ojojboll-ui.github.io/WaterHarp/ (on a phone; tap Start and allow motion access)

- Hold the phone sideways. On an iPhone, turn rotation lock on: the harp turns itself to fit the way you hold it.
- Left: chord buttons (C G Am F Dm Em). The pad sounds only while a button is held.
- Middle: the water. Tilt to slosh it, or drag a finger through it.
- Right: space for the effects pad (filter, space, modulation, with motion recording), coming next.
- On a computer: hold keys 1–6 for chords, and the arrow keys to tilt.

## How the water plays

`strum.js` measures how much water stands on each string, every frame, from the particles in a tent-shaped window around it. A string is plucked when that depth **rises quickly**: a wave crest arriving, or the water's edge running onto it. A slow rise never plucks, because the baseline it is compared with creeps up after the water. After a pluck, the string waits until the water on it stops rising or starts to recede, so one wave plucks it once. The pluck's strength comes from how fast the water rose, and its timing is interpolated within the frame, so a quick sweep lands as an even strum.

`node test/strumtest.js` runs the detector against the liquid in a few gestures (still water, slow tilt, quick tilt, rocking, finger drag) and prints every pluck.

## Run locally

```
node serve.js
```

- PC: http://localhost:8092
- Phone on the same Wi-Fi: https://&lt;your-ip&gt;:8444 (self-signed certificate; the Settings sheet shows a QR code). Motion access needs https.

## Parts

| File | What |
|---|---|
| `fluid-core.js` | FLIP liquid from [FluidSim](https://github.com/ojojboll-ui/FluidSim), with the drift correction scaled by cell size and time step |
| `strum.js` | hears the water play the strings |
| `engine.js` | sound: plucked voices, the pad, ensemble and echo, forked from Touch Grass's web port of Chordtroller |
| `index.html` | the instrument |
| `test/` | `strumtest.js`, `padtest.js`, `resttest.js` (resting water stays at rest), `coretest.js` (the liquid at 4–200 cells) |
