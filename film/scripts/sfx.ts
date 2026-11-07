// Synthesizes the film's sound effects and its quiet music bed (no samples, no licences):
// public/sfx/{stamp,press,thud,whoosh,tick,ratchet,paper,chime,typing,bed}.wav
//
//   node scripts/sfx.ts

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SR = 48000;
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "sfx");
mkdirSync(out, { recursive: true });

// Deterministic noise, so the sounds are the same on every run.
let seed = 0x2f6e2b1;
const noise = () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return ((seed >>> 0) / 0xffffffff) * 2 - 1;
};

const buf = (seconds: number) => new Float32Array(Math.ceil(seconds * SR));

function wav(name: string, data: Float32Array, peak = 0.89) {
  let max = 0;
  for (const v of data) max = Math.max(max, Math.abs(v));
  const gain = max > 0 ? peak / max : 1;
  const pcm = Buffer.alloc(44 + data.length * 2);
  pcm.write("RIFF", 0);
  pcm.writeUInt32LE(36 + data.length * 2, 4);
  pcm.write("WAVEfmt ", 8);
  pcm.writeUInt32LE(16, 16);
  pcm.writeUInt16LE(1, 20);
  pcm.writeUInt16LE(1, 22);
  pcm.writeUInt32LE(SR, 24);
  pcm.writeUInt32LE(SR * 2, 28);
  pcm.writeUInt16LE(2, 32);
  pcm.writeUInt16LE(16, 34);
  pcm.write("data", 36);
  pcm.writeUInt32LE(data.length * 2, 40);
  data.forEach((v, i) => pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v * gain)) * 32767), 44 + i * 2));
  writeFileSync(join(out, `${name}.wav`), pcm);
  console.log(`${name}.wav  ${(data.length / SR).toFixed(2)}s`);
}

/** One-pole low-pass, in place. */
function lowpass(x: Float32Array, hz: number) {
  const a = Math.exp((-2 * Math.PI * hz) / SR);
  let y = 0;
  for (let i = 0; i < x.length; i++) x[i] = y = (1 - a) * x[i] + a * y;
  return x;
}
function highpass(x: Float32Array, hz: number) {
  const lp = lowpass(Float32Array.from(x), hz);
  for (let i = 0; i < x.length; i++) x[i] -= lp[i];
  return x;
}
/** A small room: a few damped feedback delays. */
function room(x: Float32Array, mix = 0.18) {
  const taps = [0.031, 0.047, 0.061, 0.083].map((s) => Math.round(s * SR));
  const y = Float32Array.from(x);
  for (const d of taps) {
    let z = 0;
    for (let i = d; i < y.length; i++) {
      z = 0.7 * z + 0.3 * y[i - d];
      y[i] += z * 0.35 * mix * 4;
    }
  }
  for (let i = 0; i < x.length; i++) x[i] = x[i] * (1 - mix) + y[i] * mix;
  return x;
}

function knock(x: Float32Array, at: number, freq: number, gain: number) {
  const s = Math.round(at * SR);
  let phase = 0;
  for (let i = 0; i < 0.3 * SR && s + i < x.length; i++) {
    const t = i / SR;
    const f = freq * Math.pow(0.42, Math.min(1, t / 0.18));
    phase += (2 * Math.PI * f) / SR;
    x[s + i] += Math.sin(phase) * gain * Math.exp(-t / 0.055);
    x[s + i] += Math.sin(phase * 0.5) * gain * 0.6 * Math.exp(-t / 0.09);
  }
  const click = new Float32Array(Math.round(0.05 * SR));
  for (let i = 0; i < click.length; i++) click[i] = noise() * Math.pow(1 - i / click.length, 3);
  lowpass(click, 2200);
  click.forEach((v, i) => {
    if (s + i < x.length) x[s + i] += v * gain * 1.6;
  });
}

// Rubber stamp: a low, dull thump.
{
  const x = buf(0.6);
  knock(x, 0.004, 130, 1);
  const n = new Float32Array(Math.round(0.09 * SR));
  for (let i = 0; i < n.length; i++) n[i] = noise() * Math.pow(1 - i / n.length, 2);
  lowpass(n, 900);
  n.forEach((v, i) => (x[i + 200] += v * 2.2));
  wav("stamp", room(x, 0.12), 0.8);
}
// Printing press: the platen coming down, with iron ringing above the thump.
{
  const x = buf(0.9);
  knock(x, 0.004, 110, 1);
  for (const [hz, life] of [[410, 0.05], [733, 0.04], [1187, 0.03], [1730, 0.02]]) {
    for (let i = 0; i < x.length; i++) {
      const t = i / SR;
      x[i] += Math.sin(2 * Math.PI * hz * t) * 0.22 * Math.exp(-t / life);
    }
  }
  wav("press", room(x, 0.16), 0.85);
}
// Deep thud for big moments.
{
  const x = buf(1.4);
  let phase = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    phase += (2 * Math.PI * (48 + 40 * Math.exp(-t / 0.08))) / SR;
    x[i] = Math.sin(phase) * Math.exp(-t / 0.35);
  }
  wav("thud", room(x, 0.25), 0.85);
}
// Whoosh: noise through a rising band.
{
  const x = buf(0.8);
  let lp = 0;
  let lp2 = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / x.length;
    const hz = 250 + 3200 * t * t;
    const a = Math.exp((-2 * Math.PI * hz) / SR);
    lp = (1 - a) * noise() + a * lp;
    lp2 = (1 - a) * lp + a * lp2;
    x[i] = (lp - lp2) * Math.sin(Math.PI * t) ** 1.5 * 6;
  }
  wav("whoosh", x, 0.6);
}
// A key or a button.
{
  const x = buf(0.06);
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    x[i] = noise() * Math.exp(-t / 0.004) + Math.sin(2 * Math.PI * 1900 * t) * 0.4 * Math.exp(-t / 0.01);
  }
  wav("tick", highpass(x, 900), 0.5);
}
// The numbering machine: a run of brass clicks, loopable.
{
  const x = buf(1);
  for (let k = 0; k < 18; k++) {
    const s = Math.round((k / 18) * SR);
    const hz = 2100 + (k % 3) * 260;
    for (let i = 0; i < 0.016 * SR; i++) {
      const t = i / SR;
      x[s + i] += (noise() * 0.6 * Math.exp(-t / 0.0015) + Math.sin(2 * Math.PI * hz * t) * Math.exp(-t / 0.005)) * (k % 2 ? 0.7 : 1);
    }
  }
  wav("ratchet", highpass(x, 700), 0.5);
}
// Typing: four seconds of uneven keystrokes, loopable.
{
  const x = buf(4);
  let t = 0.02;
  while (t < 3.95) {
    const s = Math.round(t * SR);
    const pitch = 1500 + noise() * 500;
    for (let i = 0; i < 0.03 * SR && s + i < x.length; i++) {
      const u = i / SR;
      x[s + i] += (noise() * Math.exp(-u / 0.003) + Math.sin(2 * Math.PI * pitch * u) * 0.3 * Math.exp(-u / 0.008)) * (0.6 + 0.4 * Math.abs(noise()));
    }
    t += 0.07 + Math.abs(noise()) * 0.09 + (Math.abs(noise()) > 0.93 ? 0.18 : 0);
  }
  wav("typing", highpass(x, 800), 0.5);
}
// Paper: a short sheet sliding onto a desk.
{
  const x = buf(0.42);
  for (let i = 0; i < x.length; i++) {
    const t = i / x.length;
    x[i] = noise() * Math.sin(Math.PI * Math.min(1, t * 1.6)) * (0.6 + 0.4 * Math.sin(t * 90));
  }
  highpass(x, 1600);
  lowpass(x, 7000);
  wav("paper", x, 0.45);
}
// Chime: a soft bell.
{
  const x = buf(1.6);
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    x[i] = [1, 2.76, 5.4].reduce((s, m, k) => s + Math.sin(2 * Math.PI * 784 * m * t) * Math.exp(-t / (0.5 / (k + 1))) / (k + 1), 0);
  }
  wav("chime", x, 0.5);
}

// The bed: a slow minor progression on soft detuned saws over a quiet pulse. 64 s, seamless.
{
  const BAR = 4;
  const LOOP = 16 * BAR;
  const x = buf(LOOP + 6);
  const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
  const chords = [
    [50, 53, 57, 62], // Dm
    [46, 50, 53, 58], // Bb
    [43, 46, 50, 55], // Gm
    [45, 49, 52, 57], // A
  ];
  for (let bar = 0; bar < 16; bar++) {
    const chord = chords[bar % 4];
    const start = bar * BAR;
    for (const n of chord) {
      const f = midi(n);
      for (const det of [-0.12, 0, 0.13]) {
        const fr = f * Math.pow(2, det / 12);
        let ph = 0;
        for (let i = 0; i < (BAR + 2) * SR; i++) {
          const t = i / SR;
          const env = Math.min(1, t / 1.4) * (t > BAR ? Math.exp(-(t - BAR) / 0.7) : 1);
          ph += fr / SR;
          const saw = 2 * (ph - Math.floor(ph + 0.5));
          const k = Math.round(start * SR) + i;
          if (k < x.length) x[k] += saw * env * 0.05;
        }
      }
    }
    // Root an octave down, and a soft heartbeat on beats 1 and 3.
    const root = midi(chord[0] - 12);
    for (let i = 0; i < BAR * SR; i++) {
      const t = i / SR;
      const k = Math.round(start * SR) + i;
      x[k] += Math.sin(2 * Math.PI * root * t) * 0.16 * Math.min(1, t / 0.8);
      const beat = t % 2;
      x[k] += Math.sin(2 * Math.PI * 52 * beat) * Math.exp(-beat / 0.12) * 0.22;
    }
  }
  lowpass(x, 900);
  // Wrap the tail past the loop point onto its start.
  const loop = x.slice(0, LOOP * SR);
  for (let i = LOOP * SR; i < x.length; i++) loop[i - LOOP * SR] += x[i];
  wav("bed", room(loop, 0.2), 0.7);
}
