/**
 * Sound effects, synthesized with Web Audio so there are no sound files to ship.
 * Silent until the first click or key press (browsers require that), and mutable from the menu.
 */
const KEY = "nebula:muted";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = (() => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
})();

function ac(): AudioContext | null {
  if (muted) return null;
  if (!ctx) {
    try {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx.state === "running" ? ctx : null;
}

if (typeof window !== "undefined") {
  const unlock = () => {
    if (!muted) ac();
  };
  addEventListener("pointerdown", unlock, { passive: true });
  addEventListener("keydown", unlock);
}

function tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; slide?: number; delay?: number; attack?: number } = {}) {
  const a = ac();
  if (!a || !master) return;
  const t = a.currentTime + (opts.delay ?? 0);
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = opts.type ?? "sine";
  o.frequency.setValueAtTime(freq, t);
  if (opts.slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * opts.slide), t + dur);
  const peak = opts.gain ?? 0.2;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + (opts.attack ?? 0.008));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

let noiseBuf: AudioBuffer | null = null;
function noise(dur: number, opts: { gain?: number; filter?: number; q?: number; delay?: number; type?: BiquadFilterType; sweep?: number } = {}) {
  const a = ac();
  if (!a || !master) return;
  if (!noiseBuf) {
    noiseBuf = a.createBuffer(1, a.sampleRate, a.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = a.currentTime + (opts.delay ?? 0);
  const src = a.createBufferSource();
  src.buffer = noiseBuf;
  const f = a.createBiquadFilter();
  f.type = opts.type ?? "bandpass";
  f.frequency.setValueAtTime(opts.filter ?? 1200, t);
  if (opts.sweep) f.frequency.exponentialRampToValueAtTime(opts.sweep, t + dur);
  f.Q.value = opts.q ?? 1;
  const g = a.createGain();
  g.gain.setValueAtTime(opts.gain ?? 0.2, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.05);
}

export const sfx = {
  get muted() {
    return muted;
  },
  setMuted(m: boolean) {
    muted = m;
    try {
      localStorage.setItem(KEY, m ? "1" : "0");
    } catch {
      // storage blocked
    }
    if (m) void ctx?.suspend();
    else ac();
  },
  hop(big = false) {
    tone(big ? 330 : 520 + Math.random() * 80, 0.12, { type: "triangle", gain: 0.12, slide: 1.6 });
    noise(0.06, { gain: 0.06, filter: 600 });
  },
  whoosh() {
    noise(0.55, { gain: 0.18, filter: 300, sweep: 3000, q: 2 });
    tone(220, 0.5, { type: "sine", gain: 0.06, slide: 3 });
  },
  nebula() {
    tone(660, 1.3, { type: "sawtooth", gain: 0.05, slide: 0.15, delay: 0.5 });
    noise(1.2, { gain: 0.12, filter: 2400, sweep: 200, q: 4, delay: 0.5 });
  },
  diceShake() {
    for (let i = 0; i < 7; i++) noise(0.04, { gain: 0.16, filter: 2500 + Math.random() * 2000, q: 3, delay: i * 0.07 + Math.random() * 0.03 });
  },
  diceHit(n = 1) {
    for (let i = 0; i < n; i++) {
      noise(0.05, { gain: 0.22, filter: 1800 + Math.random() * 1500, q: 2.5, delay: i * 0.03 });
      tone(180 + Math.random() * 60, 0.06, { type: "square", gain: 0.03, delay: i * 0.03 });
    }
  },
  tick() {
    tone(1800, 0.03, { type: "square", gain: 0.05 });
  },
  spinStop() {
    tone(880, 0.12, { type: "triangle", gain: 0.15 });
    tone(1320, 0.25, { type: "triangle", gain: 0.12, delay: 0.1 });
  },
  card() {
    noise(0.18, { gain: 0.14, filter: 4000, sweep: 1200, q: 0.7 });
    tone(740, 0.08, { type: "sine", gain: 0.05, delay: 0.12 });
  },
  turn() {
    tone(587, 0.15, { type: "triangle", gain: 0.1 });
    tone(880, 0.25, { type: "triangle", gain: 0.1, delay: 0.1 });
  },
  yourTurn() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, { type: "triangle", gain: 0.12, delay: i * 0.08 }));
  },
  click() {
    tone(1200, 0.04, { type: "sine", gain: 0.06 });
  },
  fanfare() {
    const notes = [523, 659, 784, 1047, 784, 1047, 1319];
    notes.forEach((f, i) => tone(f, i === notes.length - 1 ? 0.9 : 0.18, { type: "sawtooth", gain: 0.07, delay: i * 0.13 }));
    notes.forEach((f, i) => tone(f / 2, 0.2, { type: "triangle", gain: 0.08, delay: i * 0.13 }));
    for (let i = 0; i < 6; i++) noise(0.3, { gain: 0.1, filter: 3000, delay: 0.9 + i * 0.18, q: 0.5 });
  },
};
