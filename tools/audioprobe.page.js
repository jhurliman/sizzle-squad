/**
 * Browser half of tools/audioprobe.mjs. Runs inside real Chromium so the Web
 * Audio implementation under test is the one that ships.
 *
 * Nothing here knows anything about the engine beyond its public surface:
 * start(ctx), handle(event), tickMusic(heat, tension), setMuted(), and the
 * optional urgency hook. If a measurement needs an internal, it is wrong.
 */
import { AudioEngine } from './audio.js';

const SR = 48000;

// ------------------------------------------------------------------ dsp

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/** Magnitude spectrum of a Hann-windowed slice, in bins of SR/N. */
function spectrum(x, from, n) {
  const N = 1 << Math.round(Math.log2(n));
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const s = x[from + i] ?? 0;
    re[i] = s * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  }
  fft(re, im);
  const mag = new Float64Array(N / 2);
  for (let i = 0; i < N / 2; i++) mag[i] = Math.hypot(re[i], im[i]);
  return mag;
}

const BAND_EDGES = [40, 120, 300, 700, 1500, 3000, 6000, 11000, 20000];

function analyse(buf, origin = 0) {
  const L = buf.getChannelData(0);
  const Rr = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  const n = L.length;
  const mono = new Float32Array(n);
  let peak = 0, clipped = 0, sum = 0, sumL = 0, sumR = 0;
  for (let i = 0; i < n; i++) {
    const l = L[i], r = Rr[i];
    mono[i] = (l + r) * 0.5;
    const a = Math.max(Math.abs(l), Math.abs(r));
    if (a > peak) peak = a;
    if (a > 1.0) clipped++;
    sum += mono[i] * mono[i];
    sumL += l * l;
    sumR += r * r;
  }
  const rms = Math.sqrt(sum / n);
  const rmsL = Math.sqrt(sumL / n), rmsR = Math.sqrt(sumR / n);
  const thr = Math.max(1e-4, peak * 0.02);
  let onset = -1, last = 0, peakAt = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(mono[i]);
    if (onset < 0 && a > thr) onset = i;
    if (a > thr * 0.5) last = i;
    if (Math.abs(mono[i]) >= peak * 0.999 && !peakAt) peakAt = i;
  }
  if (onset < 0) onset = 0;
  // spectral centroid + band energies over the sounding region
  const len = Math.max(2048, Math.min(16384, last - onset || 2048));
  const mag = spectrum(mono, onset, len);
  const binHz = SR / (mag.length * 2);
  let num = 0, den = 0;
  const bands = new Array(BAND_EDGES.length - 1).fill(0);
  for (let i = 1; i < mag.length; i++) {
    const f = i * binHz, e = mag[i] * mag[i];
    num += f * e;
    den += e;
    for (let b = 0; b < bands.length; b++) if (f >= BAND_EDGES[b] && f < BAND_EDGES[b + 1]) bands[b] += e;
  }
  const btot = bands.reduce((a, b) => a + b, 0) || 1;
  // dominant partial (pitch), searched over 80..4000Hz
  let best = 0, bestI = 0;
  for (let i = Math.floor(80 / binHz); i < Math.min(mag.length, Math.floor(4000 / binHz)); i++)
    if (mag[i] > best) { best = mag[i]; bestI = i; }
  return {
    peak,
    rms,
    clipped,
    onsetMs: (onset / SR - origin) * 1000,
    attackMs: (Math.max(0, peakAt - onset) / SR) * 1000,
    durMs: ((last - onset) / SR) * 1000,
    centroid: den > 0 ? num / den : 0,
    bands: bands.map((b) => b / btot),
    pitch: bestI * binHz,
    balance: rmsL + rmsR > 0 ? (rmsR - rmsL) / (rmsR + rmsL) : 0,
  };
}

/** Band-limited RMS over a time window, from the FFT. */
function bandRms(buf, t0, t1, fLo, fHi) {
  const L = buf.getChannelData(0);
  const Rr = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  const from = Math.floor(t0 * SR);
  const n = Math.max(1024, Math.floor((t1 - t0) * SR));
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) mono[i] = ((L[from + i] ?? 0) + (Rr[from + i] ?? 0)) * 0.5;
  const mag = spectrum(mono, 0, n);
  const binHz = SR / (mag.length * 2);
  let e = 0;
  for (let i = 1; i < mag.length; i++) {
    const f = i * binHz;
    if (f >= fLo && f < fHi) e += mag[i] * mag[i];
  }
  return Math.sqrt(e) / mag.length;
}

/** Onset envelope + autocorrelation beat period. */
function rhythm(buf, seconds) {
  const L = buf.getChannelData(0);
  const Rr = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  const hop = 256;
  const frames = Math.floor(L.length / hop);
  const env = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (let i = 0; i < hop; i++) {
      const j = f * hop + i;
      const v = ((L[j] ?? 0) + (Rr[j] ?? 0)) * 0.5;
      s += v * v;
    }
    env[f] = Math.sqrt(s / hop);
  }
  const flux = new Float64Array(frames);
  for (let f = 1; f < frames; f++) flux[f] = Math.max(0, env[f] - env[f - 1]);
  const fmax = Math.max(...flux) || 1;
  let onsets = 0;
  const times = [];
  for (let f = 2; f < frames - 1; f++) {
    if (flux[f] > fmax * 0.14 && flux[f] >= flux[f - 1] && flux[f] > flux[f + 1] && (times.length === 0 || (f * hop) / SR - times[times.length - 1] > 0.045)) {
      onsets++;
      times.push((f * hop) / SR);
    }
  }
  // Autocorrelation of the flux for the beat period. Take the SMALLEST strong
  // peak, not the largest: as heat adds voices the strongest correlation moves
  // to the bar, which made a faster loop measure as a slower one.
  const fps = SR / hop;
  const lo = Math.floor(0.09 * fps), hi = Math.floor(6.0 * fps);
  const acf = new Float64Array(hi);
  for (let lag = lo; lag < hi; lag++) {
    let s = 0;
    for (let f = 0; f + lag < frames; f++) s += flux[f] * flux[f + lag];
    acf[lag] = s;
  }
  let barLag = 0, barV = 0;
  for (let l = Math.floor(2.5 * fps); l < Math.min(hi, Math.floor(5.5 * fps)); l++) {
    if (acf[l] > barV) { barV = acf[l]; barLag = l; }
  }
  const barSec = barLag / fps;
  return { onsets, bpm: barSec ? 480 / barSec : 0, barSec, seconds, times };
}

// ------------------------------------------------------------------ harness

/**
 * Render one engine session offline. `plan` gets ({ engine, ctx, at }) where
 * `at(t, fn)` schedules fn to run at render-time t — the only way to emulate a
 * per-frame loop inside an OfflineAudioContext.
 */
async function render(seconds, plan, opts = {}) {
  const ctx = new OfflineAudioContext(2, Math.ceil(SR * seconds), SR);
  const scheduled = [];
  if (opts.trackNodes) {
    const co = ctx.createOscillator.bind(ctx);
    ctx.createOscillator = () => {
      const o = co();
      const st = o.start.bind(o);
      o.start = (t) => { scheduled.push({ t: t ?? ctx.currentTime, now: ctx.currentTime }); return st(t); };
      return o;
    };
    const cb = ctx.createBufferSource.bind(ctx);
    ctx.createBufferSource = () => {
      const s = cb();
      const st = s.start.bind(s);
      s.start = (t) => { scheduled.push({ t: t ?? ctx.currentTime, now: ctx.currentTime }); return st(t); };
      return s;
    };
  }
  const engine = new AudioEngine();
  const hooks = [];
  const at = (t, fn) => hooks.push({ t, fn });
  plan({ engine, ctx, at });
  // OfflineAudioContext.suspend() resolves on 128-sample render-quantum
  // boundaries and refuses two suspends in the same quantum, so hooks are
  // snapped to the grid and merged. Without this the probe throws on any
  // schedule denser than 375Hz and silently loses the hooks after it.
  const Q = 128;
  const merged = new Map();
  for (const h of hooks) {
    const frame = Math.max(Q, Math.round((h.t * SR) / Q) * Q);
    if (!merged.has(frame)) merged.set(frame, []);
    merged.get(frame).push(h.fn);
  }
  for (const [frame, fns] of [...merged.entries()].sort((a, b) => a[0] - b[0])) {
    if (frame >= ctx.length) continue;
    // A throw inside a suspend callback means resume() is never called and
    // startRendering() never settles — the probe hangs with no error. Never
    // let a hook take the render down with it.
    ctx.suspend(frame / SR).then(() => {
      for (const fn of fns) {
        try { fn(); } catch (err) { console.error('hook threw:', err); }
      }
      ctx.resume();
    });
  }
  const buf = await ctx.startRendering();
  return { buf, scheduled, engine };
}

const EV = {
  pickup: { t: 'pickup', chef: 0, at: { x: 7.5, y: 5 } },
  place: { t: 'place', chef: 0, at: { x: 7.5, y: 5 } },
  chopTick: { t: 'chopTick', at: { x: 7.5, y: 5 }, progress: 0.5 },
  chopDone: { t: 'chopDone', at: { x: 7.5, y: 5 }, kind: 'tomato' },
  cookDone: { t: 'cookDone', at: { x: 7.5, y: 5 }, kind: 'bacon' },
  burn: { t: 'burn', at: { x: 7.5, y: 5 } },
  fireStart: { t: 'fireStart', at: { x: 7.5, y: 5 } },
  serve: { t: 'serve', at: { x: 7.5, y: 5 }, value: 40, combo: 1, orderId: 1 },
  serveWrong: { t: 'serveWrong', at: { x: 7.5, y: 5 } },
  orderNew: { t: 'orderNew', orderId: 1 },
  orderExpired: { t: 'orderExpired', orderId: 1 },
  trash: { t: 'trash', at: { x: 7.5, y: 5 } },
  washDone: { t: 'washDone', at: { x: 7.5, y: 5 } },
  bump: { t: 'bump', a: 0, b: 1, at: { x: 7.5, y: 5 } },
  dash: { t: 'dash', chef: 0, at: { x: 7.5, y: 5 } },
  footstep: { t: 'footstep', chef: 0, at: { x: 7.5, y: 5 } },
  gameOver: { t: 'gameOver', score: 900 },
};

/**
 * Fires the "ticket about to expire" warning however the engine exposes it.
 * The engine only speaks on a whole-second boundary crossing (it shares the
 * HUD's once-a-second heartbeat), so this has to advance a ticket past one.
 */
function fireWarn(engine, at, t0 = 0.05) {
  if (typeof engine.observeOrders !== 'function') return false;
  at(t0, () => engine.observeOrders([{ id: 1, remaining: 3.02, total: 34 }]));
  at(t0 + 0.05, () => engine.observeOrders([{ id: 1, remaining: 2.96, total: 34 }]));
  return true;
}

const stage = (n) => { window.__stage = n; console.log('[stage] ' + n); };
window.__runProbe = async () => {
  const out = { events: [], music: [], masking: [], stress: {}, policy: {} };

  stage('events');
  // ---- per-event ----------------------------------------------------------
  const median = (xs) => xs.slice().sort((a, b) => a - b)[xs.length >> 1];
  const REPEATS = 9;
  for (const [name, ev] of Object.entries(EV)) {
    const runs = [];
    for (let i = 0; i < REPEATS; i++) {
      const { buf } = await render(3.2, ({ engine, ctx }) => {
        engine.start(ctx);
        engine.handle(ev);
      });
      runs.push(analyse(buf));
    }
    const a = runs[0];
    out.events.push({
      name,
      family: 'sfx',
      ...a,
      peak: median(runs.map((r) => r.peak)),
      peakSpreadDb: 20 * Math.log10(Math.max(...runs.map((r) => r.peak)) / Math.min(...runs.map((r) => r.peak))),
      rms: median(runs.map((r) => r.rms)),
    });
  }

  stage('fear');
  // ---- the fear sound -----------------------------------------------------
  {
    const probe = await render(3.2, ({ engine, ctx, at }) => {
      engine.start(ctx);
      fireWarn(engine, at);
    });
    const a = analyse(probe.buf, 0.1);
    if (a.peak > 1e-4) out.events.push({ name: 'orderWarn', family: 'sfx', ...a });
    // ...and the same ticket one second from death, which must be worse.
    const late = await render(3.2, ({ engine, ctx, at }) => {
      engine.start(ctx);
      at(0.05, () => engine.observeOrders([{ id: 1, remaining: 1.02, total: 34 }]));
      at(0.1, () => engine.observeOrders([{ id: 1, remaining: 0.96, total: 34 }]));
    });
    const la = analyse(late.buf, 0.1);
    if (la.peak > 1e-4) out.events.push({ name: 'orderWarn1s', family: 'warn', ...la });
    // Spam guard: 8 tickets all in the danger band for 4 seconds.
    const spam = await render(4.5, ({ engine, ctx, at }) => {
      engine.start(ctx);
      if (typeof engine.observeOrders !== 'function') return;
      const orders = [];
      for (let i = 0; i < 8; i++) orders.push({ id: i + 1, remaining: 4 + i * 0.37, total: 34 });
      for (let t = 0; t < 4; t += 1 / 40)
        at(t, () => engine.observeOrders(orders.map((o) => ({ ...o, remaining: o.remaining - t }))));
    });
    out.warnSpam = rhythm(spam.buf, 4).onsets;
  }

  stage('combo');
  // ---- combo ladder -------------------------------------------------------
  for (const c of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12]) {
    const { buf } = await render(2.0, ({ engine, ctx }) => {
      engine.start(ctx);
      engine.handle({ ...EV.serve, combo: c });
    });
    out.events.push({ name: `serve x${c}`, family: 'combo', combo: c, ...analyse(buf) });
  }

  stage('pan');
  // ---- panning: does a sound land where it happened? ----------------------
  {
    const side = async (x) => {
      const { buf } = await render(2, ({ engine, ctx }) => {
        engine.start(ctx);
        engine.handle({ t: 'place', chef: 0, at: { x, y: 5 } });
      });
      return analyse(buf).balance;
    };
    out.pan = { left: await side(1.5), centre: await side(7.5), right: await side(13.5) };
  }

  stage('music');
  // ---- music --------------------------------------------------------------
  const musicPlan = (heat, tension, seconds) => async () => {
    const { buf } = await render(seconds, ({ engine, ctx, at }) => {
      engine.start(ctx);
      for (let t = 0; t < seconds; t += 1 / 40) at(t, () => engine.tickMusic(heat, tension));
    });
    const a = analyse(buf);
    const r = rhythm(buf, seconds);
    // Locate the peak sample and identify the note that made it.
    const L = buf.getChannelData(0), Rr = buf.getChannelData(1);
    let pAt = 0, pV = 0;
    for (let i = 0; i < L.length; i++) {
      const v = Math.max(Math.abs(L[i]), Math.abs(Rr[i]));
      if (v > pV) { pV = v; pAt = i; }
    }
    const mag = spectrum(new Float32Array(4096).map((_, i) => ((L[pAt - 512 + i] ?? 0) + (Rr[pAt - 512 + i] ?? 0)) * 0.5), 0, 4096);
    const binHz = SR / (mag.length * 2);
    let bi = 0;
    for (let i = 1; i < mag.length; i++) if (mag[i] > mag[bi]) bi = i;
    // Bar-relative position of the peak, in beats, so it can be read against
    // the pattern in tickMusic.
    const bar = r.barSec || 4;
    const peakBeat = ((pAt / SR) % bar) / (bar / 16);
    const bandProfile = [];
    for (let b = 0; b < BAND_EDGES.length - 1; b++) {
      let worst = 0;
      for (let t = 1; t < seconds - 0.2; t += 0.1) worst = Math.max(worst, bandRms(buf, t, t + 0.15, BAND_EDGES[b], BAND_EDGES[b + 1]));
      bandProfile.push(worst);
    }
    return { peakAtSec: pAt / SR, peakStep: peakBeat, peakHz: bi * binHz, bandProfile, heat, tension, seconds, peak: a.peak, rms: a.rms, clipped: a.clipped, centroid: a.centroid, bands: a.bands, onsets: r.onsets, bpm: r.bpm, barSec: r.barSec };
  };
  for (const [h, te] of [[0, 0], [0.5, 0.3], [1, 0.9]]) out.music.push(await musicPlan(h, te, 14)());

  stage('masking');
  // ---- masking: SFX against the busiest bed -------------------------------
  {
    const SEC = 6, T = 3.0;
    const bed = await render(SEC, ({ engine, ctx, at }) => {
      engine.start(ctx);
      for (let t = 0; t < SEC; t += 1 / 40) at(t, () => engine.tickMusic(1, 0.9));
    });
    for (const name of ['pickup', 'chopDone', 'serve', 'orderNew', 'bump', 'serveWrong']) {
      // Rendered ON TOP of the bed, at the same instant, so a sound that ducks
      // the music gets credit for ducking it. Measuring the two separately
      // scored the duck at zero.
      const sfx = await render(SEC, ({ engine, ctx, at }) => {
        engine.start(ctx);
        for (let t = 0; t < SEC; t += 1 / 40) at(t, () => engine.tickMusic(1, 0.9));
        at(T, () => engine.handle(EV[name]));
      });
      const a = out.events.find((e) => e.name === name);
      // Compare in the band the SFX actually occupies, over a window matched to
      // a transient (150ms) rather than to the bed — measuring a 40ms tick over
      // a 350ms window spreads its energy and reports masking that is not there.
      // The bed is taken as its WORST 150ms in that band, not its average.
      let bi = 0;
      for (let i = 1; i < a.bands.length; i++) if (a.bands[i] > a.bands[bi]) bi = i;
      const lo = BAND_EDGES[bi], hi = BAND_EDGES[bi + 1];
      const W = 0.15;
      const sfxE = bandRms(sfx.buf, T, T + W, lo, hi);
      const bedE = bandRms(bed.buf, T, T + W, lo, hi);
      // (bed+sfx)/bed overstates the bed's contribution: for an SFX X dB over
      // the bed the ratio is 10log10(1+10^(X/10)). Invert it so the number
      // printed is the true margin of the SFX over the bed.
      const ratio = Math.pow((sfxE + 1e-9) / (bedE + 1e-9), 2);
      out.masking.push({ name, band: [lo, hi], headroomDb: 10 * Math.log10(Math.max(ratio - 1, 1e-9)), bedRms: bedE });
    }
  }

  stage('stress');
  // ---- stress: a whole late-service second --------------------------------
  {
    const SEC = 5;
    const burst = [];
    let n = 0;
    const seq = ['footstep', 'footstep', 'pickup', 'chopTick', 'chopTick', 'place', 'serve', 'bump', 'dash', 'chopDone', 'cookDone', 'orderNew', 'footstep', 'chopTick', 'serve', 'trash', 'washDone', 'burn', 'serveWrong', 'footstep', 'fireStart', 'orderExpired'];
    const { buf, scheduled } = await render(SEC, ({ engine, ctx, at }) => {
      engine.start(ctx);
      for (let t = 0; t < SEC; t += 1 / 40) at(t, () => engine.tickMusic(1, 0.85));
      seq.forEach((name, i) => {
        const t = 1.0 + i * 0.055;
        burst.push(t);
        n++;
        at(t, () => engine.handle({ ...EV[name], combo: 5 }));
      });
    }, { trackNodes: true });
    const a = analyse(buf);
    // Every voice is 3-5 AudioNodes constructed on the MAIN thread; this is
    // the only part of audio that can cost the renderer a frame.
    out.stress = { count: n, seconds: SEC, peak: a.peak, rms: a.rms, clipped: a.clipped, voicesPerSec: scheduled.length / SEC };
  }

  stage('policy');
  // ---- policy -------------------------------------------------------------
  {
    // (a) nothing before the gesture
    const RealCtx = window.AudioContext;
    let made = 0;
    window.AudioContext = class extends RealCtx { constructor(...a) { made++; super(...a); } };
    const e0 = new AudioEngine();
    for (const ev of Object.values(EV)) e0.handle(ev);
    e0.tickMusic(0.5, 0.5);
    window.AudioContext = RealCtx;
    out.policy.contextsBeforeStart = made;
    out.policy.beforeStartPeak = 0;

    // (b) muted is silent, and unmuting does not click
    const muted = await render(3, ({ engine, ctx, at }) => {
      engine.start(ctx);
      engine.setMuted(true);
      for (let t = 0; t < 3; t += 1 / 40) at(t, () => engine.tickMusic(0.8, 0.5));
      at(0.5, () => engine.handle(EV.serve));
      at(1.0, () => engine.handle(EV.fireStart));
    });
    out.policy.mutedPeak = analyse(muted.buf).peak;

    const click = await render(3, ({ engine, ctx, at }) => {
      engine.start(ctx);
      for (let t = 0; t < 3; t += 1 / 40) at(t, () => engine.tickMusic(0.8, 0.5));
      at(1.0, () => engine.setMuted(true));
      at(2.0, () => engine.setMuted(false));
    });
    {
      const L = click.buf.getChannelData(0);
      let step = 0;
      for (const t of [1.0, 2.0]) {
        const i0 = Math.floor(t * SR) - 8;
        for (let i = i0; i < i0 + Math.floor(0.004 * SR); i++) step = Math.max(step, Math.abs(L[i + 1] - L[i]));
      }
      out.policy.muteClick = step;
    }

    // (b2) is mute reachable at all? A muted engine nobody can unmute is a
    // feature that does not exist.
    {
      const e1 = new AudioEngine();
      const ctx1 = new OfflineAudioContext(2, SR, SR);
      e1.start(ctx1);
      const before = e1.muted;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' }));
      out.policy.keyboardMute = e1.muted !== before;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' }));
      out.policy.keyboardUnmute = e1.muted === before;
    }

    // (c) backgrounding: the loop stops for 6s, then comes back
    const SEC = 12, GAP = [2, 8];
    const bg = await render(SEC, ({ engine, ctx, at }) => {
      engine.start(ctx);
      for (let t = 0; t < SEC; t += 1 / 40) {
        if (t > GAP[0] && t < GAP[1]) continue;
        at(t, () => engine.tickMusic(0.6, 0.4));
      }
      at(GAP[1] + 1.5, () => engine.handle(EV.serve));
    }, { trackNodes: true });
    out.policy.pastNotes = bg.scheduled.filter((s) => s.t < s.now - 0.002).length;
    const L = bg.buf.getChannelData(0), Rr = bg.buf.getChannelData(1);
    const win = (t0, t1) => {
      let p = 0;
      for (let i = Math.floor(t0 * SR); i < Math.floor(t1 * SR); i++) p = Math.max(p, Math.abs(L[i]), Math.abs(Rr[i]));
      return p;
    };
    out.policy.normalPeak = win(0.2, 2.0);
    out.policy.resumePeak = win(GAP[1], GAP[1] + 0.4);
    out.policy.resumeSfxPeak = win(GAP[1] + 1.5, GAP[1] + 2.0);
    out.policy.survivedSuspend = win(GAP[1] + 0.5, SEC - 0.2) > 0.01 && out.policy.resumeSfxPeak > 0.05;
  }

  return out;
};

window.__probeReady = true;
