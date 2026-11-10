# WaterHarp

A water harp for your phone. Water sloshes over thirteen invisible strings. Hold a chord with your left thumb, then tilt the phone or drag through the water: every wave that runs onto a string plucks it, so a quick tilt sweeps the chord like a strum.

**Play it:** https://ojojboll-ui.github.io/WaterHarp/ (on a phone; tap Start and allow motion access)

- Hold the phone sideways. On an iPhone, turn rotation lock on: the harp turns itself to fit the way you hold it.
- Left: chord buttons. The pad sounds only while a button is held. Choose your own 4 to 8 chords in Settings, or a ready-made set (Pop in C, Pop in G, Sad in Am, Dreamy in F, Blues in A).
- Middle: the water. Tilt to slosh it, or drag a finger through it.
- Height is pitch: dashed lines across the strings mark octaves. The higher the water climbs a string, the higher it sounds, so a big slosh up the wall plays a rising arpeggio.
- Three more layers, each with its own level in Settings: water **flowing** across a string makes it sing (Glass or Juno pad), **droplets** flying across a string ring a bell an octave up, and **deep water** on a string darkens its tone.
- String voices: Harp, Omni, Vibes, Guitar, four Juno presets (Keys, Brass, Strings, Bass) and Acid 303, a 303-style bass line that slides when the water sweeps fast.
- Water presets (the pill on the right steps through them; all of them in Settings): Water, Puddle, Swell, Splash, Honey, Moon.
- Right: the effects pad. Three pages: **Filter** (X cutoff, Y resonance), **Space** (X echo, Y reverb, echo in 1/8, dotted 1/8 or 1/4) and **Mod** (LFO on the filter, Gate, Tremolo, Autopan, Chorus/vibrato: X rate, Y depth). Every effect keeps its own point, so several modulations run at once; double-tap the pad to reset the one shown. Everything follows one tempo: tap it, or step it with − and +. **REC** records the pad's moves for 1, 2 or 4 bars and loops them, so your thumb is free for the water. Pressing REC on an effect that already loops overdubs only the parts you play; hold REC to erase the loop of the effect shown (or every loop, if it has none). Loops are saved between visits.
- Sounds in Settings set the strings, layers, water and effects pad in one go: Harp Lake, Acid Puddle, Juno Swell, Moon Bells, Honey Keys, Splash Brass. Save your own in three slots.
- On a computer: hold keys 1–8 for chords, and the arrow keys to tilt.

## How the water plays

`strum.js` measures how much water stands on each string, every frame, from the particles in a tent-shaped window around it. A string is plucked when that depth **rises quickly**: a wave crest arriving, or the water's edge running onto it. A slow rise never plucks, because the baseline it is compared with creeps up after the water. After a pluck, the string waits until the water on it stops rising or starts to recede, so one wave plucks it once. The pluck's strength comes from how fast the water rose, and its timing is interpolated within the frame, so a quick sweep lands as an even strum.

Above the resting water line lie zone lines that cut the height from the water line to the top of the tank into equal bands. A pluck sounds in the octave of the zone the water stands in, and a crest that keeps climbing briskly past the next line plucks the string again, an octave up. Notes stay between E2 and G7.

`node test/strumtest.js` runs the detector against the liquid in a few gestures (still water, slow tilt, quick tilt, rocking, finger drag) and prints every pluck.
`node test/presettest.js` does the same for every water preset, and counts the plucks per octave zone.
`node test/flowtest.js` shows the flow and the droplets per preset and gesture; `node test/layertest.js` renders the flow layer, the bells and every string voice offline.
`node test/fxtest.js` checks the effects chain: transparent at rest, each effect doing its job, its cost.
`node test/looptest.js` checks the motion looper: loop timing, overdub, the finger winning over playback, tempo, save and load.

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
| `strum.js` | hears the water play the strings: plucks, the octave from the height, the flow across each string, droplets |
| `presets.js` | the water presets |
| `loops.js` | records and loops the effects pad's moves |
| `engine.js` | sound: plucked voices, Juno presets, the acid line, the flow layer, bells, the pad, ensemble and echo, forked from Touch Grass's web port of Chordtroller |
| `index.html` | the instrument |
| `test/` | `strumtest.js`, `presettest.js`, `padtest.js`, `resttest.js` (resting water stays at rest), `coretest.js` (the liquid at 4–200 cells) |
