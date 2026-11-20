// Procedural sound effects: everything is synthesised with Web Audio (noise bursts, sweeps and tones), so there are no audio files to load.
export type Kind = "pistol" | "loose" | "thud" | "hit" | "die" | "boom" | "bigboom" | "zap" | "hurt" | "jump" | "jump2" | "land" | "step" | "whoosh" | "surge" | "clink" | "phase" | "scrape" | "ready" | "tick"

const BOOST: Partial<Record<Kind, number>> = { boom: 0.55, bigboom: 0.5, pistol: 0.85, whoosh: 2.4, step: 3.5, scrape: 3.2, jump: 1.8, jump2: 1.6, ready: 1.8, tick: 2.5, phase: 1.6, surge: 1.2, zap: 1.5, hit: 1.6 }

export const makeSfx = (ctx: BaseAudioContext, out: AudioNode) => {
  const noise = (() => { const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b })()
  const env = (g: GainNode, t: number, peak: number, dur: number, attack = 0.004) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur) }
  const burst = (dest: AudioNode, t: number, type: BiquadFilterType, f0: number, f1: number, q: number, peak: number, dur: number, attack = 0.004) => {
    const s = ctx.createBufferSource(); s.buffer = noise; const f = ctx.createBiquadFilter(), g = ctx.createGain()
    f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur)
    env(g, t, peak, dur, attack); s.connect(f); f.connect(g); g.connect(dest); s.start(t, Math.random()); s.stop(t + dur + 0.05)
  }
  const tone = (dest: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, peak: number, dur: number, attack = 0.003) => {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur)
    env(g, t, peak, dur, attack); o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05)
  }
  const play = (kind: Kind, dest: AudioNode = out, v = 1) => {
    const t = ctx.currentTime + 0.005
    v *= BOOST[kind] ?? 1
    switch (kind) {
      case "pistol": burst(dest, t, "bandpass", 3200, 900, 0.8, 0.9 * v, 0.16, 0.001); tone(dest, t, "sine", 180, 45, 0.9 * v, 0.14); burst(dest, t, "lowpass", 600, 120, 0.7, 0.5 * v, 0.28); break
      case "loose": tone(dest, t, "triangle", 330, 120, 0.5 * v, 0.28); burst(dest, t, "highpass", 2500, 1200, 0.7, 0.25 * v, 0.1); burst(dest, t + 0.02, "bandpass", 900, 300, 1.4, 0.3 * v, 0.35); break
      case "thud": tone(dest, t, "sine", 110, 38, 0.8 * v, 0.16); burst(dest, t, "lowpass", 700, 150, 0.7, 0.45 * v, 0.14); break
      case "hit": tone(dest, t, "square", 420, 160, 0.28 * v, 0.07); burst(dest, t, "bandpass", 2200, 900, 1, 0.5 * v, 0.1); break
      case "die": tone(dest, t, "sawtooth", 260, 38, 0.5 * v, 0.5); burst(dest, t, "lowpass", 2400, 80, 0.8, 0.7 * v, 0.5); tone(dest, t + 0.05, "square", 700, 90, 0.2 * v, 0.3); break
      case "boom": burst(dest, t, "lowpass", 3000, 70, 0.7, 1.3 * v, 1.4, 0.002); tone(dest, t, "sine", 90, 26, 1.4 * v, 1.1); burst(dest, t, "bandpass", 1500, 300, 0.6, 0.5 * v, 0.25, 0.001); break
      case "bigboom": burst(dest, t, "lowpass", 2400, 50, 0.7, 1.6 * v, 3.0, 0.003); tone(dest, t, "sine", 72, 20, 1.8 * v, 2.4); burst(dest, t + 0.03, "lowpass", 900, 60, 0.7, 0.9 * v, 3.4); burst(dest, t, "bandpass", 1500, 250, 0.6, 0.5 * v, 0.4, 0.001); break
      case "zap": tone(dest, t, "sawtooth", 1100, 180, 0.32 * v, 0.14); burst(dest, t, "highpass", 3500, 1500, 0.6, 0.15 * v, 0.09); break
      case "hurt": tone(dest, t, "sine", 190, 70, 0.8 * v, 0.22); burst(dest, t, "lowpass", 1200, 200, 0.7, 0.5 * v, 0.22); break
      case "jump": tone(dest, t, "sine", 240, 520, 0.18 * v, 0.1); burst(dest, t, "bandpass", 800, 1600, 0.8, 0.12 * v, 0.1); break
      case "jump2": tone(dest, t, "sine", 380, 820, 0.2 * v, 0.12); burst(dest, t, "bandpass", 1400, 3000, 0.8, 0.14 * v, 0.14); break
      case "land": tone(dest, t, "sine", 95, 40, 0.5 * v, 0.14); burst(dest, t, "lowpass", 500, 120, 0.7, 0.35 * v, 0.14); break
      case "step": burst(dest, t, "lowpass", 520 + Math.random() * 160, 160, 0.8, 0.16 * v, 0.07); break
      case "whoosh": burst(dest, t, "bandpass", 500, 2200, 1.1, 0.55 * v, 0.28, 0.06); break
      case "surge": burst(dest, t, "bandpass", 400, 3200, 1.0, 0.9 * v, 0.5, 0.05); tone(dest, t, "sine", 140, 420, 0.3 * v, 0.4, 0.05); burst(dest, t + 0.05, "highpass", 2500, 600, 0.6, 0.25 * v, 0.4); break
      case "clink": tone(dest, t, "square", 620, 330, 0.18 * v, 0.06); burst(dest, t, "bandpass", 3000, 1500, 1.6, 0.25 * v, 0.07); tone(dest, t + 0.06, "sine", 180, 80, 0.5 * v, 0.1); break
      case "phase": burst(dest, t, "bandpass", 300, 3500, 1.4, 0.5 * v, 0.45, 0.08); tone(dest, t, "sine", 160, 640, 0.18 * v, 0.4, 0.05); break
      case "scrape": burst(dest, t, "bandpass", 900 + Math.random() * 400, 700, 2, 0.22 * v, 0.12, 0.01); break
      case "ready": tone(dest, t, "sine", 880, 1320, 0.12 * v, 0.1); break
      case "tick": tone(dest, t, "square", 900, 700, 0.1 * v, 0.03); break
    }
  }
  // the bow string: a creak whose pitch rises with the draw; a single node set that is started and stopped
  const draw = (() => {
    let src: AudioBufferSourceNode | null = null, f: BiquadFilterNode | null = null, g: GainNode | null = null
    return {
      start() { if (src) return; src = ctx.createBufferSource(); src.buffer = noise; src.loop = true; f = ctx.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 6; f.frequency.value = 300; g = ctx.createGain(); g.gain.value = 0.0001; src.connect(f); f.connect(g); g.connect(out); src.start() },
      set(x: number) { if (!f || !g) return; f.frequency.setTargetAtTime(260 + 900 * x, ctx.currentTime, 0.03); g.gain.setTargetAtTime(0.1 + 0.2 * x, ctx.currentTime, 0.03) },
      stop() { if (!src || !g) return; g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.02); const s = src; setTimeout(() => s.stop(), 150); src = f = g = null },
    }
  })()
  return { play, draw }
}

export type Sfx = ReturnType<typeof createSfx>

// the live audio engine: created on the first user gesture, with 3D positioned sounds, distance falloff and a master limiter
export const createSfx = () => {
  let ctx: AudioContext | null = null, engine: ReturnType<typeof makeSfx> | null = null, master: GainNode | null = null, muted = false
  const init = () => {
    if (ctx) { if (ctx.state === "suspended") void ctx.resume(); return }
    ctx = new AudioContext(); master = ctx.createGain(); master.gain.value = 0.55
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6; master.connect(comp); comp.connect(ctx.destination)
    engine = makeSfx(ctx, master)
  }
  const listener = (pos: { x: number; y: number; z: number }, fwd: { x: number; y: number; z: number }) => {
    if (!ctx) return
    const l = ctx.listener, t = ctx.currentTime
    if (l.positionX) { l.positionX.setValueAtTime(pos.x, t); l.positionY.setValueAtTime(pos.y, t); l.positionZ.setValueAtTime(pos.z, t); l.forwardX.setValueAtTime(fwd.x, t); l.forwardY.setValueAtTime(fwd.y, t); l.forwardZ.setValueAtTime(fwd.z, t); l.upX.setValueAtTime(0, t); l.upY.setValueAtTime(1, t); l.upZ.setValueAtTime(0, t) }
  }
  // play(kind) is heard in the head; play(kind, position) comes from the world
  const play = (kind: Kind, at?: { x: number; y: number; z: number }, v = 1) => {
    if (!ctx || !engine || !master || muted) return
    if (!at) { engine.play(kind, master, v); return }
    const p = ctx.createPanner(); p.panningModel = "equalpower"; p.distanceModel = "inverse"; p.refDistance = kind === "bigboom" ? 30 : kind === "boom" ? 14 : 6; p.rolloffFactor = 1.3; p.maxDistance = 400
    p.positionX.value = at.x; p.positionY.value = at.y; p.positionZ.value = at.z
    const g = ctx.createGain(); g.gain.value = 1; p.connect(g); g.connect(master); engine.play(kind, p, v)
    setTimeout(() => { p.disconnect(); g.disconnect() }, 3500)
  }
  return {
    init, listener, play,
    draw: { start: () => { if (!muted) engine?.draw.start() }, set: (x: number) => engine?.draw.set(x), stop: () => engine?.draw.stop() },
    toggleMute: () => { muted = !muted; if (muted) engine?.draw.stop(); return muted },
  }
}
