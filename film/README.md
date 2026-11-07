# The Turf film

A two-minute demo film made in code with [Remotion](https://www.remotion.dev): drawn motion graphics on Gunter's chain, then one real round of Turf played on Solana devnet, then how it is built.

Nothing in the gameplay is mocked. `scripts/capture.ts` opens the game in headless Chrome, stakes a claim, and plays a whole round against the page's own rival bots, moving a real mouse over the real canvas. It records Chrome's screencast and writes down when each thing happened. The edit cuts to those moments, and the narration quotes that round's numbers.

## Rebuild it

```bash
npm install
npm run sfx                      # synthesized stamps, ticks, chain ratchet and a quiet bed
npm run capture                  # needs the game on http://localhost:5274 (npm run dev:devnet in ../web)
npm run voice                    # Deepgram Aura-2 narration and Nova-3 word timings; reads the key from ../../Appwrite/.env
node scripts/timeline.ts         # scene timings and footage windows
npm run render && npm run master # out/turf.mp4
npm run thumbnails               # out/turf-thumbnail-1920.png and -1280.png
```

`node scripts/stills.ts 150 900` renders single frames to `out/check/` for review.

The Deepgram key never leaves its env file: `voice.ts` reads it from the environment and nothing writes it down.
