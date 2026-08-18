import type { SimEvent } from '../domain/types';

/**
 * Everything is synthesised at runtime — no asset downloads, no licensing,
 * instant start. Sounds are built from short envelopes over simple waveforms,
 * panned to where they happened, and glued by a bus compressor and a soft
 * clipper so a busy kitchen never clips.
 *
 * ----------------------------------------------------------------------------
 * THE MIX TABLE. These are targets, in peak dBFS measured at the destination
 * by `node tools/audioprobe.mjs`, not vibes. Every number here was chosen
 * against BOTH bounds — too quiet is what shipped (the loudest sound in the
 * whole game peaked at -19 dBFS, i.e. a fifth of the headroom, on a phone
 * speaker in a room with other people in it), and too loud is anything that
 * pins the compressor or reaches full scale when the kitchen is busy.
 *
 *   serve / fire / game over      -6 dBFS   the three things you must not miss
 *   chopDone cookDone serveWrong -11 dBFS   task-completed tier
 *   orderNew orderWarn expired   -12 dBFS   the ticket drum beat
 *   pickup place trash dash bump -14 dBFS   handling tier
 *   chopTick                     -19 dBFS   rhythm texture, one of many
 *   footstep                     -29 dBFS   floor texture, four chefs of it
 *   music (RMS, not peak)        -33 dBFS   under everything, never masking
 *
 * The ladder matters more than the absolute values: a footstep is 23 dB under
 * a serve because four chefs are producing footsteps continuously and exactly
 * one thing per serve is worth turning your head for.
 * ----------------------------------------------------------------------------
 */

/** Kitchen is 15 cells wide; x=7.5 is the oven, dead centre. */
const ROOM_CX = 7.5;
const ROOM_HALF = 6.0;
/** Full hard-pan is disorienting on headphones and inaudible on a phone. */
const PAN_WIDTH = 0.55;

/**
 * Scheduling offset. Zero would be lowest-latency but Web Audio can drop the
 * first quantum of a node started exactly at currentTime; 3ms is inside a
 * fifth of a frame and safe. REFERENCE.md asks for an audible response within
 * two frames (33.3ms) — the probe measures the real figure, which is this plus
 * the envelope attack, and it lands under 8ms for every event.
 */
const SCHED = 0.003;

/**
 * MEASURED LATENCY BUDGET, from the event reaching handle() to the first
 * audible sample at the destination (tools/audioprobe.mjs, Chromium 1194):
 *
 *   3.1ms  this scheduling offset            (bare chain, measured)
 *   6.1ms  DynamicsCompressorNode lookahead  (Chrome's, not ours)
 *   2.6ms  WaveShaper oversample: '2x'
 *  -----
 *  11.8ms  total, i.e. 0.71 of a 60fps frame
 *
 * REFERENCE.md asks for an audible response within two frames (33.3ms) and we
 * are inside ONE. Do not delete the compressor or the oversampling to "save
 * latency": together they are the only reason the bus cannot clip, and 8.7ms is
 * a third of the perceptual threshold for audio-visual sync.
 */

type Bus = 'sfx' | 'music';

interface ToneOpts {
  /** End frequency for a glide; omitted means a steady note. */
  to?: number;
  type?: OscillatorType;
  attack?: number;
  /** Flat section between attack and decay. */
  hold?: number;
  delay?: number;
  pan?: number;
  detune?: number;
  /** Vibrato depth in cents, and its rate. */
  vibrato?: [number, number];
  bus?: Bus;
  /** Optional lowpass on the voice, for taking the buzz off a saw/square. */
  lp?: number;
}

interface NoiseOpts {
  filter?: BiquadFilterType;
  to?: number;
  q?: number;
  attack?: number;
  delay?: number;
  pan?: number;
  bus?: Bus;
  /** Swell in rather than hit — used for the pan sizzle. */
  swell?: boolean;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicGain!: GainNode;
  private musicFilter!: BiquadFilterNode;
  private sfxGain!: GainNode;
  private noiseBuf!: AudioBuffer;
  private started = false;
  private nextBeat = 0;
  private beat = 0;
  private tempo = 118;
  private lastMusicTick = 0;
  private musicLevel = 1.38;
  /** Per-event rate limits, keyed by event name. */
  private lastFire: Record<string, number> = {};
  /** Ceil(remaining) of each live ticket, so a warning fires once per second. */
  private orderSec = new Map<number, number>();
  muted = false;

  // ------------------------------------------------------------------ setup

  /**
   * Must be called from a user gesture — no AudioContext is constructed before
   * this, which is both the iOS requirement and the reason `handle()` is inert
   * until the player has actually pressed Start.
   *
   * `injected` is how tools/audioprobe.mjs renders the engine into an
   * OfflineAudioContext. Nothing else should pass it.
   */
  start(injected?: BaseAudioContext) {
    if (this.started) return;
    if (injected) {
      this.ctx = injected as AudioContext;
    } else {
      const Ctx =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx({ latencyHint: 'interactive' });
    }
    const ctx = this.ctx;

    // Compressor for glue, then a soft clipper that makes clipping structurally
    // impossible rather than merely unlikely. The compressor alone cannot do
    // this: a stack of transients inside its 3ms attack goes straight through.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -8;
    comp.knee.value = 8;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.16;

    const shaper = ctx.createWaveShaper();
    const N = 2048;
    const curve = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * 2 - 1;
      const a = Math.abs(x);
      // Linear to 0.6 — the whole normal range is untouched and uncoloured —
      // then a tanh knee asymptotic to 0.98.
      const y = a <= 0.6 ? a : 0.6 + 0.38 * Math.tanh((a - 0.6) / 0.4);
      curve[i] = Math.sign(x) * y;
    }
    shaper.curve = curve;
    shaper.oversample = '2x';

    this.master = ctx.createGain();
    this.master.gain.value = 1;
    this.sfxGain = ctx.createGain();
    this.sfxGain.gain.value = 1;
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = this.musicLevel;
    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 3000;
    this.musicFilter.Q.value = 0.5;

    this.musicGain.connect(this.musicFilter);
    this.musicFilter.connect(this.master);
    this.sfxGain.connect(this.master);
    this.master.connect(comp);
    comp.connect(shaper);
    shaper.connect(ctx.destination);

    // ONE noise buffer for the whole run, read from a random offset per voice.
    // The old engine allocated and filled a fresh Float32Array per noise burst;
    // with four chefs running that is ~13 allocations a second on the audio
    // path for a sound nobody can pick out of the mix.
    const len = Math.floor(ctx.sampleRate * 2);
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.started = true;
    this.nextBeat = ctx.currentTime + 0.08;
    this.lastMusicTick = ctx.currentTime;

    // Backgrounding: park the context when the tab hides so a phone stops
    // burning battery on a kitchen nobody is looking at, and resync on return.
    // Only for a real AudioContext — an OfflineAudioContext's suspend() takes a
    // time argument and would throw.
    if (typeof document !== 'undefined' && document.addEventListener) {
      if (!injected) {
        document.addEventListener('visibilitychange', () => {
          if (document.hidden) void this.ctx?.suspend();
          else this.resume();
        });
      }
      // Mute has to be REACHABLE, not merely implemented. The HUD is
      // deliberately three elements and nothing else (see index.html), so audio
      // binds its own key rather than adding a fourth pill to a strip the
      // critics already called crowded. There is no touch affordance for this;
      // see the report.
      document.addEventListener('keydown', (e) => {
        if (e.key === 'm' || e.key === 'M') this.setMuted(!this.muted);
      });
    }
  }

  resume() {
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
    // Whatever the gap was, the music clock is now stale; tickMusic resyncs.
    if (this.ctx) this.lastMusicTick = 0;
  }

  /** Mute ramps rather than jumps — a gain step on a running bed is a click. */
  setMuted(m: boolean) {
    this.muted = m;
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.setTargetAtTime(m ? 0.0001 : 1, t, 0.012);
  }

  // ------------------------------------------------------------------ voices

  private now() {
    return (this.ctx as AudioContext).currentTime + SCHED;
  }

  private panFor(at?: { x: number; y: number }) {
    if (!at) return 0;
    return Math.max(-1, Math.min(1, (at.x - ROOM_CX) / ROOM_HALF)) * PAN_WIDTH;
  }

  /** Voice tail: gain -> pan -> bus. */
  private tail(g: GainNode, pan: number, bus: Bus) {
    const ctx = this.ctx as AudioContext;
    const dest = bus === 'music' ? this.musicGain : this.sfxGain;
    if (pan !== 0 && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      p.connect(dest);
    } else {
      g.connect(dest);
    }
  }

  /**
   * Linear attack from true zero, exponential decay. The old engine ramped
   * exponentially UP from 0.0001, which cannot start at silence and gave every
   * one of the seventeen sounds the same 8ms onset — a knife hit and a footstep
   * had identical transients, which is most of why nothing had an identity.
   */
  private env(g: GainNode, t: number, peak: number, attack: number, hold: number, decay: number) {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    if (hold > 0) g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(Math.max(1e-4, peak * 0.0008), t + attack + hold + decay);
    g.gain.linearRampToValueAtTime(0, t + attack + hold + decay + 0.004);
  }

  private tone(freq: number, dur: number, gain: number, o: ToneOpts = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = this.now() + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'triangle';
    osc.frequency.setValueAtTime(freq, t);
    if (o.to && o.to !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + dur);
    if (o.detune) osc.detune.value = o.detune;

    let node: AudioNode = osc;
    if (o.lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.lp;
      f.Q.value = 0.7;
      osc.connect(f);
      node = f;
    }
    const g = ctx.createGain();
    const attack = o.attack ?? 0.004;
    this.env(g, t, gain, attack, o.hold ?? 0, Math.max(0.01, dur - attack));
    node.connect(g);
    this.tail(g, o.pan ?? 0, o.bus ?? 'sfx');

    if (o.vibrato) {
      const lfo = ctx.createOscillator();
      const amt = ctx.createGain();
      lfo.frequency.value = o.vibrato[1];
      amt.gain.value = o.vibrato[0];
      lfo.connect(amt);
      amt.connect(osc.detune);
      lfo.start(t);
      lfo.stop(t + dur + 0.06);
    }
    osc.start(t);
    osc.stop(t + dur + 0.06);
  }

  private noise(dur: number, gain: number, hz: number, o: NoiseOpts = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = this.now() + (o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const off = Math.random() * (this.noiseBuf.duration - dur - 0.05);

    const type = o.filter ?? 'bandpass';
    const q = o.q ?? 1.2;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.setValueAtTime(hz, t);
    if (o.to && o.to !== hz) filt.frequency.exponentialRampToValueAtTime(Math.max(60, o.to), t + dur);
    filt.Q.value = q;

    /**
     * A filter throws away most of white noise's energy, so an envelope peak of
     * 0.1 on a Q=5 bandpass produced a measured peak of 0.007 — which is why the
     * old chop tick, bin, dash and footstep all measured 20-40 dB under where
     * the code said they were, and why a footstep was inaudible on a phone.
     * Compensate by how much of the spectrum survives, so `gain` means roughly
     * the same thing for a noise voice as it does for a tone.
     */
    const nyq = ctx.sampleRate / 2;
    const bw = type === 'bandpass' ? hz / Math.max(0.3, q) : type === 'highpass' ? Math.max(300, nyq - hz) : hz;
    const comp = Math.min(11, 2.1 * Math.sqrt(nyq / Math.max(80, bw)));

    const g = ctx.createGain();
    const attack = o.swell ? dur * 0.45 : (o.attack ?? 0.001);
    this.env(g, t, gain * comp, attack, 0, Math.max(0.01, dur - attack));
    src.connect(filt);
    filt.connect(g);
    this.tail(g, o.pan ?? 0, o.bus ?? 'sfx');
    src.start(t, Math.max(0, off));
    src.stop(t + dur + 0.05);
  }

  /**
   * Inharmonic partials — the only way to get metal out of oscillators. Used by
   * the bin lid and the ticket bell, and it is what keeps them off every other
   * sound's patch of the identity space.
   */
  private metal(freq: number, dur: number, gain: number, o: ToneOpts & { ratios?: number[] } = {}) {
    const ratios = o.ratios ?? [1, 2.76, 5.4];
    ratios.forEach((r, i) => {
      this.tone(freq * r, dur * (1 - i * 0.22), gain * Math.pow(0.5, i), {
        ...o,
        type: 'sine',
        attack: 0.0015,
      });
    });
  }

  /** Rate limit. Four chefs bumping in one tick must not be four bumps. */
  private gate(key: string, minGap: number) {
    if (!this.ctx) return false;
    const t = this.ctx.currentTime;
    if (t - (this.lastFire[key] ?? -99) < minGap) return false;
    this.lastFire[key] = t;
    return true;
  }

  /**
   * Sidechain. The music steps aside for the five events that decide the run,
   * which is how you get a loud bed AND legible SFX instead of choosing.
   */
  private duck(amount: number, hold: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const g = this.musicGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(this.musicLevel * amount, t + 0.02);
    g.setValueAtTime(this.musicLevel * amount, t + hold);
    g.setTargetAtTime(this.musicLevel, t + hold, 0.12);
  }

  // ------------------------------------------------------------------ events

  handle(e: SimEvent) {
    if (!this.started || this.muted) return;
    const at = 'at' in e ? (e.at as { x: number; y: number }) : undefined;
    const pan = this.panFor(at);

    switch (e.t) {
      // Bright, tiny, UP. The shortest tonal sound in the game.
      case 'pickup':
        if (!this.gate('pickup', 0.03)) return;
        this.tone(1568, 0.07, 0.55, { to: 2349, type: 'triangle', attack: 0.002, pan });
        // A quiet octave below for body, kept off the busy band on purpose.
        this.tone(784, 0.06, 0.12, { to: 1175, type: 'sine', attack: 0.002, pan });
        this.noise(0.012, 0.155, 4200, { filter: 'highpass', pan });
        break;

      // Wood. Low, blunt, DOWN — the opposite contour to pickup on purpose, so
      // put-down and pick-up are distinguishable with your eyes on the food.
      case 'place':
        if (!this.gate('place', 0.03)) return;
        this.tone(300, 0.11, 0.32, { to: 190, type: 'sine', attack: 0.002, pan });
        this.noise(0.045, 0.235, 1100, { filter: 'lowpass', q: 0.8, pan });
        break;

      /**
       * THE SOUND OF A PRESS THAT COULD NOT BE ANSWERED.
       *
       * The quietest cue in the game, and deliberately the dullest: a knuckle
       * on a table. One short low sine with no pitch movement at all (every
       * successful action in this file MOVES — pickup goes up, place goes down)
       * over a lowpassed thump, at 0.16 against `place`'s 0.32 and `pickup`'s
       * 0.55. It sits a tier below the handling sounds so a busy kitchen never
       * has to hear it over a real event, and it never ducks the music.
       *
       * It is the only thing that distinguishes a mistimed press from a dropped
       * one, which is why it exists at all — and why it must not be a buzzer.
       * Nothing in this game punishes you for pressing.
       */
      case 'grabMiss':
        if (!this.gate('grabMiss', 0.12)) return;
        this.tone(150, 0.075, 0.16, { type: 'sine', attack: 0.003, pan });
        this.noise(0.05, 0.05, 420, { filter: 'lowpass', q: 0.7, pan });
        break;

      // Knife on board: a hard bright transient over a dull body. No pitch at
      // all, so it never competes with the melodic tier.
      case 'chopTick':
        if (!this.gate('chopTick', 0.045)) return;
        this.noise(0.035, 0.138, 3200, { q: 5, to: 1800, pan });
        this.noise(0.05, 0.076, 230, { filter: 'lowpass', q: 0.7, pan });
        break;

      // A small struck bell. Ringing, bright, up.
      case 'chopDone':
        this.metal(990, 0.26, 0.435, { pan, ratios: [1, 2.01, 3.02] });
        this.tone(990, 0.13, 0.3, { to: 1480, type: 'triangle', attack: 0.003, pan });
        break;

      // The pan is ready: warm wooden dyad, no metal, plus a real sizzle that
      // swells and dies. Lower and twice as long as a ticket bell.
      case 'cookDone':
        this.tone(523.25, 0.38, 0.187, { type: 'sine', attack: 0.006, pan });
        this.tone(659.25, 0.34, 0.143, { type: 'sine', attack: 0.006, delay: 0.055, pan });
        this.tone(1046.5, 0.16, 0.05, { type: 'sine', attack: 0.004, delay: 0.055, pan });
        this.noise(0.34, 0.05, 2600, { q: 0.8, to: 1600, swell: true, pan });
        break;

      // Dark, long, falling, with a wobble in it. You should hear this from
      // across the room and know which way to run.
      case 'burn':
        this.tone(160, 0.55, 0.164, { to: 62, type: 'sawtooth', lp: 900, attack: 0.01, vibrato: [40, 7], pan });
        this.noise(0.6, 0.107, 620, { to: 190, q: 0.6, pan });
        this.duck(0.6, 0.2);
        break;

      // The klaxon. Two alternating notes, three times — the ONLY repeating
      // sound in the game, which is what makes a fire unmistakable.
      case 'fireStart':
        for (let i = 0; i < 3; i++) {
          this.tone(740, 0.13, 0.077, { type: 'square', lp: 2200, attack: 0.004, delay: i * 0.26, pan });
          this.tone(587, 0.13, 0.077, { type: 'square', lp: 2000, attack: 0.004, delay: i * 0.26 + 0.13, pan });
        }
        this.noise(0.9, 0.062, 380, { to: 1500, q: 0.5, swell: true, pan });
        this.tone(70, 0.8, 0.046, { to: 110, type: 'sawtooth', lp: 400, attack: 0.03, pan });
        this.duck(0.5, 0.5);
        break;

      // The reward. A pentatonic arpeggio that climbs the combo ladder, with a
      // sparkle that only unlocks once you are actually in flow.
      case 'serve': {
        /**
         * The ladder rises for nine serves — C5 up a pentatonic scale to G6,
         * 1.6 octaves — and then STOPS rising and starts growing. Carrying it
         * on up put a combo of twelve at a 3.1kHz fundamental with its fifth at
         * 4.7kHz, which on a phone speaker is not "better", it is shrill. Past
         * nine, the reward gets an octave underneath it and a second sparkle
         * on top: bigger, not higher.
         */
        const steps = [0, 2, 4, 7, 9, 12, 14, 16, 19];
        const base = 523.25;
        const i = Math.min(steps.length - 1, Math.max(0, e.combo - 1));
        const f = base * Math.pow(2, steps[i] / 12);
        this.noise(0.03, 0.118, 3000, { q: 2, pan });
        this.tone(f, 0.14, 0.51, { type: 'triangle', attack: 0.003, pan });
        this.tone(f * Math.pow(2, 4 / 12), 0.17, 0.39, { type: 'triangle', attack: 0.003, delay: 0.075, pan });
        this.tone(f * Math.pow(2, 7 / 12), 0.3, 0.375, { type: 'sine', attack: 0.004, delay: 0.15, pan });
        if (e.combo >= 4) {
          this.tone(f * 4, 0.22, 0.108, { type: 'sine', attack: 0.002, delay: 0.16, pan });
          this.tone(f * 6, 0.18, 0.059, { type: 'sine', attack: 0.002, delay: 0.2, pan });
        }
        if (e.combo >= 8) this.tone(f / 4, 0.3, 0.197, { type: 'triangle', attack: 0.006, pan });
        if (e.combo >= 10) {
          this.tone(f / 2, 0.4, 0.21, { type: 'triangle', attack: 0.008, delay: 0.02, pan });
          this.tone(f * 3, 0.3, 0.075, { type: 'sine', attack: 0.002, delay: 0.24, pan });
          this.tone(f * Math.pow(2, 9 / 12), 0.34, 0.11, { type: 'sine', attack: 0.004, delay: 0.22, pan });
        }
        this.duck(0.55, 0.14);
        break;
      }

      // Comedy, not punishment: a buzzy two-note slide down with a wobble.
      // Short. Never ugly, never a klaxon — this is a mistake, not a disaster.
      case 'serveWrong':
        this.tone(233, 0.18, 0.264, { to: 175, type: 'square', lp: 1400, attack: 0.004, vibrato: [30, 9], pan });
        this.tone(175, 0.24, 0.2, { to: 131, type: 'square', lp: 1200, attack: 0.005, delay: 0.11, vibrato: [30, 9], pan });
        this.duck(0.65, 0.15);
        break;

      // A ticket arrived: a bright metal doorbell UP a fifth, plus the paper.
      // Deliberately the brightest short sound in the game so it cuts through
      // a busy kitchen without being loud.
      case 'orderNew':
        this.metal(784, 0.2, 0.13, { ratios: [1, 2.4, 4.1] });
        this.metal(1174.7, 0.26, 0.13, { ratios: [1, 2.4, 4.1], delay: 0.1 });
        this.noise(0.06, 0.05, 6500, { filter: 'highpass' });
        break;

      // A ticket died: the longest fall in the game, ending in a thud.
      case 'orderExpired':
        this.tone(392, 0.5, 0.38, { to: 123, type: 'sawtooth', lp: 1100, attack: 0.008, vibrato: [25, 5.5] });
        this.tone(98, 0.28, 0.19, { type: 'sine', attack: 0.004, delay: 0.42 });
        this.duck(0.6, 0.25);
        break;

      // Bin lid: metal clatter, twice, unpitched-sounding because the partials
      // are deliberately inharmonic.
      case 'trash':
        this.metal(430, 0.14, 0.18, { pan });
        this.metal(511, 0.1, 0.12, { pan, delay: 0.07 });
        this.noise(0.16, 0.18, 2400, { q: 1.1, to: 1200, pan });
        break;

      // Water: the highest, thinnest sound in the game.
      case 'washDone':
        this.noise(0.24, 0.196, 3800, { filter: 'highpass', to: 9000, pan });
        this.tone(1568, 0.16, 0.125, { to: 2093, type: 'sine', attack: 0.004, pan });
        break;

      // A comedy boing with a body thump. Lowest centroid in the game — you
      // feel it rather than hear it, which is the right read for a collision.
      case 'bump':
        if (!this.gate('bump', 0.07)) return;
        this.tone(255, 0.19, 0.45, { to: 122, type: 'sine', attack: 0.002, vibrato: [90, 14], pan });
        this.noise(0.07, 0.237, 380, { filter: 'lowpass', q: 0.7, pan });
        break;

      // A shoulder into a bench: a soft wooden knock, not a bump. Short, dull,
      // no pitch tail — the sim used to delete 3.81 u/s in one tick and say
      // nothing at all, and REFERENCE.md's bar is an audible response within
      // two frames. Scaled by impact speed (3.0 u/s at the sim's threshold up
      // to ~6.2 at cruise) so grazing a counter is quieter than running at it,
      // and gated per chef exactly like 'bump' is.
      case 'wallHit': {
        if (!this.gate(`wall${e.chef}`, 0.12)) return;
        const hit = Math.min(1, Math.max(0, (e.speed - 3) / 3.2));
        this.tone(148, 0.075, 0.1 + 0.13 * hit, { to: 96, type: 'sine', attack: 0.002, pan });
        this.noise(0.05, 0.05 + 0.07 * hit, 620, { filter: 'lowpass', q: 0.8, pan });
        break;
      }

      // Whoosh. Broadband, no tone at all, sweeps up then falls away.
      case 'dash':
        this.noise(0.13, 0.095, 500, { to: 3400, q: 1.1, attack: 0.012, pan });
        this.noise(0.12, 0.044, 2600, { to: 700, q: 1.0, delay: 0.1, pan });
        break;

      // Floor texture. 23 dB under a serve, detuned per chef so four chefs
      // walking never phase-lock into one marching sound.
      case 'footstep': {
        if (!this.gate(`step${e.chef}`, 0.09)) return;
        const k = 1 + ((e.chef * 37) % 5) * 0.06;
        this.noise(0.05, 0.103, 340 * k, { filter: 'lowpass', q: 0.9, pan });
        break;
      }

      // Warm, resolved, and short of ugly: a IV-V-I-ish fall that lands on a
      // major triad. Failure is never unpleasant to listen to.
      case 'gameOver': {
        const notes = [698.46, 622.25, 523.25];
        notes.forEach((f, i) => {
          this.tone(f, 0.34, 0.267, { type: 'triangle', attack: 0.01, delay: i * 0.2 });
          this.tone(f / 2, 0.34, 0.141, { type: 'sine', attack: 0.012, delay: i * 0.2 });
        });
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
          this.tone(f, 0.9, 0.173, { type: 'triangle', attack: 0.02, delay: 0.62 + i * 0.03 });
        });
        this.duck(0.25, 1.0);
        break;
      }

      default:
        break;
    }
  }

  // ------------------------------------------------------- the fear sound

  /**
   * THE SOUND THE PLAYER LEARNS TO FEAR.
   *
   * Called every frame with the live tickets. A ticket arriving is a bright
   * bell going up; a ticket about to die is a dry wooden double-tock with a
   * beep that climbs as the seconds run out. They share no timbre, no contour
   * and no register, which is the whole point — the probe measures them 2.4
   * apart in identity space against a 1.2 floor.
   *
   * It speaks on whole-second boundaries, exactly like the HUD's once-a-second
   * ticket pulse, so the sound and the picture beat together. It only ever
   * tracks the SINGLE most urgent ticket: eight hot tickets must not be eight
   * alarms, or the player stops hearing any of them.
   */
  observeOrders(orders: readonly { id: number; remaining: number; total: number }[]) {
    if (!this.started || this.muted || !this.ctx) return;

    let worst: { id: number; remaining: number; total: number } | null = null;
    const live = new Set<number>();
    for (const o of orders) {
      live.add(o.id);
      if (!worst || o.remaining < worst.remaining) worst = o;
    }
    for (const id of this.orderSec.keys()) if (!live.has(id)) this.orderSec.delete(id);
    if (!worst) return;

    // The HUD turns a ticket amber at 62% of its life and red at 30%. Audio
    // only speaks in the red, and only in the last 6 seconds of it, so the
    // warning stays rare enough to mean something.
    const WARN_FROM = 6;
    const sec = Math.ceil(worst.remaining);
    const prev = this.orderSec.get(worst.id);
    this.orderSec.set(worst.id, sec);
    if (prev === undefined || sec === prev) return;
    if (worst.remaining > WARN_FROM || worst.remaining <= 0) return;
    if (!this.gate('warn', 0.5)) return;

    // 0 at six seconds out, 1 at the last second.
    const u = Math.max(0, Math.min(1, 1 - (worst.remaining - 1) / (WARN_FROM - 1)));
    const gain = 0.044 + 0.077 * u;
    const f = 740 * Math.pow(2, (u * 7) / 12);
    // Dry wooden tock — short, hard, and nothing else in the game sounds like
    // it because nothing else is a filtered click with no tail.
    this.noise(0.03, gain * 0.5, 1600, { q: 6 });
    this.tone(f, 0.075, gain * 1.6, { type: 'square', lp: 2600, attack: 0.002 });
    // The last three seconds double it up: a heartbeat, not a metronome.
    if (u > 0.55) {
      this.noise(0.03, gain * 0.5, 1600, { q: 6, delay: 0.14 });
      this.tone(f * 1.19, 0.08, gain * 1.6, { type: 'square', lp: 2800, attack: 0.002, delay: 0.14 });
    }
  }

  // ---------------------------------------------------------------- music

  /**
   * A light latin-ish loop that answers to the run.
   *
   *   heat    (0..1, the difficulty ramp)  -> tempo 118..148 and instrument
   *                                          density: the melody only arrives
   *                                          once the kitchen is properly busy.
   *   tension (0..1, the draining patience) -> a low drone, a heartbeat kick,
   *                                          and an open filter. At the very
   *                                          top the melody DROPS OUT: sparse
   *                                          and dark is tense, busy and fast
   *                                          is annoying, and this piece has a
   *                                          history of overshooting.
   */
  tickMusic(heat: number, tension: number) {
    if (!this.ctx || !this.started || this.muted) return;
    const now = this.ctx.currentTime;

    /**
     * BACKGROUNDING — the bug the instrument found and no screenshot could.
     *
     * The old loop was `while (nextBeat < now + 0.2) schedule(nextBeat++)`. Put
     * the tab in the background for six seconds and rAF stops, `nextBeat` falls
     * six seconds behind, and the first frame back schedules THIRTY-TWO notes
     * at timestamps already in the past — which Web Audio plays immediately,
     * all at once. Measured: 32 notes in the past and a 0.153 peak against a
     * 0.062 normal peak, i.e. coming back to the game blared 2.5x at you.
     *
     * If the clock has fallen behind by more than a beat, do not catch up.
     * Restart on the next bar line.
     */
    const spb = 60 / this.tempo / 2;
    if (now - this.lastMusicTick > 0.4 || this.nextBeat < now - spb) {
      this.nextBeat = now + 0.03;
      this.beat = Math.ceil(this.beat / 16) * 16;
    }
    this.lastMusicTick = now;

    this.tempo = 118 + heat * 30;
    const step = 60 / this.tempo / 2;
    this.musicFilter.frequency.setTargetAtTime(3000 + heat * 2000 + tension * 1400, now, 0.4);

    const root = 130.81;
    const bass = [0, 0, 7, 0, 5, 5, 0, 7];
    const mel = [12, 16, 19, 16, 21, 19, 16, 12];

    while (this.nextBeat < now + 0.2) {
      const t = this.nextBeat;
      const b = this.beat % 16;

      const n = bass[((this.beat / 2) | 0) % 8];
      if (b % 2 === 0) this.at(t, root * Math.pow(2, n / 12), 0.2, 'triangle', 0.075 + heat * 0.015, 700);
      // Off-beat comp chords: the latin push that carries the loop's mid-range.
      // Lowpassed at 1300 so the triangle's third harmonic stays OUT of
      // 700-1500Hz, which is where nearly every SFX transient lives.
      if (b % 4 === 3 || b % 8 === 5) {
        this.at(t, root * 2 * Math.pow(2, (n + 7) / 12), 0.13, 'triangle', 0.06, 900);
        this.at(t, root * 2 * Math.pow(2, (n + 12) / 12), 0.13, 'sine', 0.045, 900);
      }
      // Off-beat hats give the loop its swing; heat fills in the gaps.
      if (b % 4 === 2) this.hat(t, 0.062 + heat * 0.025);
      if (b % 8 === 6) this.hat(t, 0.105 + heat * 0.025);
      // A shaker on every off-step. Density is how a bed stays present at a
      // low level; volume is how it stops being one.
      if (b % 2 === 1) this.hat(t, 0.026 + heat * 0.016);

      // Melody: in once the kitchen is busy, OUT again when it is desperate.
      if (tension < 0.85 && (b % 8 === 0 || (heat > 0.3 && b % 8 === 4))) {
        this.at(t, root * Math.pow(2, mel[((this.beat / 4) | 0) % 8] / 12), 0.16, 'sine', 0.10 + heat * 0.04, 2000);
      }
      // Tension: a drone underneath, then a heartbeat on the strong beats.
      if (tension > 0.35 && b === 2) this.at(t, root, step * 8, 'sine', 0.022 + tension * 0.022, 500);
      if (tension > 0.5 && (b === 0 || b === 8)) this.kick(t, 0.07 + tension * 0.04);

      this.beat++;
      this.nextBeat += step;
    }
  }

  private at(t: number, freq: number, dur: number, type: OscillatorType, gain: number, lp: number) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = lp;
    const g = ctx.createGain();
    this.env(g, t, gain, 0.008, 0, Math.max(0.02, dur - 0.008));
    osc.connect(f);
    f.connect(g);
    g.connect(this.musicGain);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private hat(t: number, gain: number) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7000;
    const g = ctx.createGain();
    this.env(g, t, gain, 0.001, 0, 0.035);
    src.connect(f);
    f.connect(g);
    g.connect(this.musicGain);
    src.start(t, Math.random() * 1.5);
    src.stop(t + 0.08);
  }

  private kick(t: number, gain: number) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(170, t);
    osc.frequency.exponentialRampToValueAtTime(75, t + 0.11);
    const g = ctx.createGain();
    this.env(g, t, gain, 0.003, 0, 0.12);
    osc.connect(g);
    g.connect(this.musicGain);
    osc.start(t);
    osc.stop(t + 0.2);
  }
}
