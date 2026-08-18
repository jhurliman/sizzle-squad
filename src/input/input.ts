import type { InputSnapshot, Vec2 } from '../domain/types';

/**
 * One input abstraction, three device stories:
 *  - touch: floating thumbstick that spawns wherever the thumb lands, plus a
 *    three-disc action cluster in the bottom-right corner.
 *  - keyboard: WASD/arrows, Space = grab, Shift = dash, J/K = use.
 *  - gamepad: left stick, A = grab, X = use, B = dash.
 * Everything converges on InputSnapshot so the sim never knows the difference.
 *
 * MEASURED, NOT GUESSED. tools/touchprobe.mjs drives real Chromium touch
 * events (CDP Input.dispatchTouchEvent — the same path a finger takes, not the
 * scripted __game.setInput hook every other tool uses) and reads back the
 * per-frame `trace` below. Every constant in this file has a number from that
 * probe attached to it.
 */

export type DeviceKind = 'touch' | 'desktop';

export interface TouchStickView {
  active: boolean;
  /**
   * The MATH origin: the point the emitted vector is measured from. It trails
   * the thumb by exactly one radius during a sprint (see the drag in
   * pointermove) and is never drawn — see `anchor`.
   */
  origin: Vec2;
  knob: Vec2;
  /**
   * WHERE THE CONTROL IS DRAWN, WHICH IS NOT WHERE THE MATH HAPPENS.
   *
   * These used to be the same point, and that was the wave-2 verdict against
   * this piece: the drag that keeps a sprint saturated walked the whole
   * control — a 124px ring plus an opaque cream knob — 438px in one second of
   * held run (51% of an 852px screen), parked it at 0.50,0.33 of the frame
   * over the pizza oven and across an order balloon, and left it reading as a
   * third order bubble. shots/w2-touch-crit/iphone-portrait-sprint-up.jpg.
   *
   * The two jobs are not the same job. Steering wants a reference that follows
   * the thumb (it is what buys angle error 0.00deg and magnitude 1.000 across
   * a 700px drag). Drawing wants a control that stays where the player put it.
   * So `origin` still drags and `anchor` does not: it is fixed at the press
   * point, nudged only far enough to keep the whole ring on the glass, and the
   * knob is drawn from it at the true deflection. Measured after
   * (tools/stickprobe.mjs): drawn drift 0px at 250/500/750/1000ms of a 500px/s
   * held run, against 63/188/313/438px before; 0 of 20 bounded sprints move the
   * ring off the point the thumb pressed; ring 100% on glass at every edge
   * press; and every fidelity number in touchprobe.mjs unchanged to the digit —
   * sprint lag 62.00px, magnitude 1.000, angle error 0.00deg, 45deg of turn
   * still costing 56px of lateral thumb after a 300px sprint.
   */
  anchor: Vec2;
  radius: number;
}

/**
 * TRAVEL TO FULL SPEED. 62 CSS px = 10.3mm on a 15 Pro.
 *
 * Bounds: under ~40px the stick is twitchy and a held diagonal wanders (one
 * pixel of thumb tremor is 2.5% of deflection); over ~80px the thumb has to
 * sweep further than a thumb comfortably swings from a resting grip, and at
 * full deflection it has left the ring art entirely. Everything shipping in
 * this genre sits at 50-75. 62 is also exactly half of `.stick-ring`'s 124px
 * diameter in styles.css and the clamp main.ts applies to the knob, so the
 * three numbers are one number. NOT CHANGED THIS ROUND: the probe measures
 * angle error 0.00deg and magnitude 1.000 across a 700px sprint, which is the
 * evidence that the current travel works.
 */
const STICK_RADIUS = 62;

/**
 * DEADZONE. 0.06 of travel = 3.7px.
 *
 * Bounds: 0 lets a resting thumb's tremor (1-2px on glass) walk the chef;
 * the previous 0.14 cost 9px — 1.5mm — before the chef moved at all, which is
 * the entire fine-positioning band a player uses to line up on a station. A
 * touch stick has no hardware drift to null out, so it needs roughly 2x
 * tremor, not 6x. Probe: first movement at 9px -> 4px.
 */
const STICK_DEADZONE = 0.06;

/**
 * How far outside the action cluster a press still refuses to steer. 14px is
 * about a thumb radius: it means a press aimed at a disc and missed does
 * nothing at all, rather than spawning a stick under a thumb that is about to
 * slide back onto the disc. It is also the ONLY dead region left on screen
 * (probe: 46.8% of the frame dead -> 3.5%).
 */
const CLUSTER_MARGIN = 14;

/**
 * HOW FAR THE DRAWN RING KEEPS ITS RIM FROM THE GLASS EDGE.
 *
 * Bounds: 0 puts the rim exactly on the edge, where a 5px rim and its dark
 * halo are half-cut and the control reads as damaged; much over ~12 and a
 * thumb resting at the bottom of the screen — the commonest place a thumb
 * lands — throws the ring further up into the play field than it needs to be.
 * 8 is the drop-shadow's own reach (0 2px 10px in styles.css), so the whole
 * painted object clears the edge. Probe before: ring 40% on glass at a corner
 * press, 55% at a side, 61% at the bottom. After: 100/100/100.
 */
const STICK_EDGE_PAD = 8;

/**
 * WHEN A THUMB HAS CHANGED ITS MIND, AND WHAT THAT USED TO COST.
 *
 * The origin drag parks the math origin a full radius BEHIND the thumb, so a
 * reversal had to walk the thumb back across the whole ring before the chef
 * turned: probe measured the emitted vector flipping sign only after 66px of
 * travel back (~82ms at a brisk 800px/s) and 90% the other way at 120px
 * (~150ms), on top of the sim's own 100ms to reverse x. A stick at rest flips
 * at 4px. So a change of mind cost four times what it costs standing still,
 * and it cost it in the middle of a rush.
 *
 * A reversal is the thumb moving AGAINST the direction it is currently
 * commanding, so the test is a dot product, and the two guards are what keep
 * it from firing on ordinary play:
 *  - DOT: -0.5 is 120deg. Pure negative (90deg) would fire on a wide arc turn,
 *    which is not a change of mind and must not lose its deflection.
 *  - MIN_PX: 2px per frame. Thumb tremor on glass is 1-2px; a brisk thumb
 *    covers 13px in a frame. Below this we are recentring on noise.
 *  - MIN_DEFLECT: half of travel. Under that the tax being fixed is only a few
 *    px anyway, and recentring a barely-deflected stick would eat exactly the
 *    fine positioning a player uses to line up on a station.
 *
 * After: the emitted vector flips at 9px of travel back (the probe steps 3px,
 * and 4 of those 9 are the deadzone the stick has when standing still) and
 * reaches 90% the other way at 60px — 75ms at 800px/s, against 150ms. The
 * guards cost nothing measurable: an arc turn still swings 45deg for 56px of
 * lateral thumb, exactly as it did before this existed.
 */
const REVERSE_DOT = -0.5;
const REVERSE_MIN_PX = 2;
const REVERSE_MIN_DEFLECT = 0.5;

/**
 * Coast after a pointercancel. iOS cancels a pointer when a system gesture
 * starts under the thumb, and the run is not over just because the OS blinked:
 * before this, a cancel mid-sprint dropped the move vector from 1.000 to 0.000
 * in one frame and the chef stopped dead in the middle of the kitchen. A clean
 * pointerup still stops instantly — that one is the player's decision.
 */
const CANCEL_COAST_MS = 150;

/** One frame of what the thumb asked for and what the sim was told. */
export interface InputTraceRow {
  t: number;
  active: boolean;
  ox: number;
  oy: number;
  kx: number;
  ky: number;
  mx: number;
  my: number;
  grab: boolean;
  use: boolean;
  dash: boolean;
  pointers: number;
}

/**
 * HAPTICS, AND THE FACT THAT iOS HAS NONE.
 *
 * navigator.vibrate does not exist in Safari on iOS — no version, no flag. The
 * whole haptic language of this game (a tap on grab, a thump on a burn) has
 * therefore never fired once on the device most of these players are holding.
 * Safari 17.4+ does ship <input type="checkbox" switch>, and toggling one
 * plays the system's light impact; that is the only haptic a web page can
 * produce on iOS today. Feature-detected off the IDL attribute, built lazily,
 * and completely inert everywhere else.
 */
let iosSwitch: HTMLLabelElement | null = null;
let iosSwitchChecked = false;
let iosSwitchOk = false;

function iosHapticAvailable(): boolean {
  if (!iosSwitchChecked) {
    iosSwitchChecked = true;
    try {
      iosSwitchOk = typeof document !== 'undefined' && 'switch' in document.createElement('input');
    } catch {
      iosSwitchOk = false;
    }
  }
  return iosSwitchOk;
}

function iosPulse() {
  if (!iosSwitch) {
    const label = document.createElement('label');
    label.setAttribute('aria-hidden', 'true');
    label.style.cssText =
      'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.setAttribute('switch', '');
    box.tabIndex = -1;
    label.appendChild(box);
    document.body.appendChild(label);
    iosSwitch = label;
  }
  iosSwitch.click();
}

/**
 * One pulse of `ms`. Android/Chrome gets the real duration; iOS gets one
 * system impact, or two spaced impacts for anything the game asked to be felt
 * as heavy (a serve combo, a burn), because impact strength is not ours to set.
 */
export function haptic(ms: number) {
  if (navigator.vibrate) {
    navigator.vibrate(ms);
    return;
  }
  if (!iosHapticAvailable()) return;
  iosPulse();
  if (ms >= 25) window.setTimeout(iosPulse, 70);
}

/**
 * Keep the whole drawn ring inside one axis of the viewport. On a viewport
 * narrower than the ring itself there is no answer, so it centres rather than
 * inverting the clamp — the pan clamp whose floor sat above its ceiling is a
 * bug this project has already shipped once.
 */
function clampAxis(v: number, extent: number): number {
  const lo = STICK_RADIUS + STICK_EDGE_PAD;
  const hi = extent - STICK_RADIUS - STICK_EDGE_PAD;
  if (hi <= lo) return extent / 2;
  return Math.max(lo, Math.min(hi, v));
}

export class InputManager {
  readonly stick: TouchStickView = {
    active: false,
    origin: { x: 0, y: 0 },
    knob: { x: 0, y: 0 },
    anchor: { x: 0, y: 0 },
    radius: STICK_RADIUS,
  };

  device: DeviceKind = 'desktop';

  /**
   * INSTRUMENTATION. Nothing about a thumbstick is visible in a screenshot:
   * whether the origin kept up with a sprint, whether a second finger stole
   * the first one's pointer, whether a cancel left the chef running. Every
   * sample() writes one row here when `traceOn`, and tools/touchprobe.mjs
   * drives REAL Chromium touch events and reads it back.
   */
  traceOn = false;
  readonly trace: InputTraceRow[] = [];

  private keys = new Set<string>();
  private moveVec: Vec2 = { x: 0, y: 0 };
  private grabQueued = false;
  private dashQueued = false;
  private stickPointer: number | null = null;
  /**
   * Every pointer that is down, outside the cluster, in the order it landed.
   * The stick is first-come — a second finger never steals it mid-sprint — but
   * when the owning finger goes away the newest of these takes over instantly
   * at its own position. Without it, the commonest thumb habit there is (roll
   * onto a second finger, lift the first) stopped the chef until the player
   * lifted everything and pressed again: probe `roll.stillSteering` was false.
   */
  private candidates = new Map<number, Vec2>();
  /** Every pointer down anywhere, so a held button cannot outlive its finger. */
  private livePointers = new Set<number>();
  private useButton = false;
  private usePad = false;
  private padPrev = { grab: false, dash: false };
  private cancelAt = -1;
  private cancelVec: Vec2 = { x: 0, y: 0 };
  /** Last thumb position of the owning pointer, for the per-frame delta. */
  private lastThumb: Vec2 = { x: 0, y: 0 };
  /**
   * :active DOES NOT FIRE ON A REAL TOUCH PRESS. The probe reads
   * getComputedStyle(disc).transform with a finger down on it and gets `none`
   * on all three discs — the browser holds the active state back while it
   * decides what the gesture is, and by then the press is over. So the one
   * frame of feedback REFERENCE.md demands for every input never happened on
   * the buttons at all. We drive it ourselves off the same pointerdown the
   * game acts on, and take it off at the window level so a press can never
   * stay stuck lit.
   */
  private pressed = new Map<number, HTMLElement>();

  constructor(private root: HTMLElement) {
    this.detectDevice();
    this.bindKeyboard();
    this.bindTouch();
    // The probe needs the manager before start() is ever called, and __game
    // (main.ts) is only assembled at the end of boot. Same contract as __game:
    // read-only inspection for the harness, never read by the game itself.
    (window as unknown as Record<string, unknown>).__input = this;
  }

  private detectDevice() {
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const touch = navigator.maxTouchPoints > 0;
    this.device = coarse || touch ? 'touch' : 'desktop';
    document.documentElement.dataset.device = this.device;
  }

  private bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space' || e.code === 'KeyE') this.grabQueued = true;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.dashQueued = true;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      // First key press on a hybrid device flips us back to desktop chrome.
      if (this.device !== 'desktop' && !navigator.maxTouchPoints) {
        this.device = 'desktop';
        document.documentElement.dataset.device = 'desktop';
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.releaseAll());
  }

  /**
   * WHICH CONTROL OWNS A PIXEL. The pointerdown handler calls this, so a probe
   * that maps the screen with it is mapping the shipped rule and not a copy.
   *
   * The old rule was `clientX > half` -> action side. That gave the buttons a
   * 196px-wide claim on a 393px phone to cover a cluster 126px wide sitting in
   * the corner, and made 46.8% of the frame a place where a thumb could press
   * and nothing whatsoever happened — measured, not estimated. It also meant
   * the game could only be steered left-handed. Now the stick spawns anywhere
   * that is not a disc, a thumb-width around the disc cluster, or an overlay.
   */
  regionAt(x: number, y: number): 'stick' | 'button' | 'dead' {
    if (document.body.classList.contains('overlaid')) return 'dead';
    const el = document.elementFromPoint(x, y);
    if (el && (el as Element).closest?.('.btn')) return 'button';
    const r = this.clusterRect();
    if (
      r &&
      x >= r.left - CLUSTER_MARGIN &&
      x <= r.right + CLUSTER_MARGIN &&
      y >= r.top - CLUSTER_MARGIN &&
      y <= r.bottom + CLUSTER_MARGIN
    ) {
      return 'dead';
    }
    return 'stick';
  }

  private clusterRect(): DOMRect | null {
    const el = document.querySelector('.action-cluster') as HTMLElement | null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? r : null;
  }

  private bindTouch() {
    const opts = { passive: false } as AddEventListenerOptions;
    this.root.addEventListener(
      'pointerdown',
      (e) => {
        // Mice are tracked (a held button must still outlive nothing) but never
        // steer: the floating stick belongs to a thumb.
        this.livePointers.add(e.pointerId);
        if (e.pointerType === 'mouse') return;
        this.markTouch();
        // e.target is what the browser ACTUALLY hit — including its touch
        // adjustment, which snaps a near-miss onto a nearby control. Trusting
        // the coordinate alone would steer the chef on a press the browser had
        // already given to a button.
        const btn = (e.target as Element | null)?.closest?.('.btn') as HTMLElement | null;
        if (btn) {
          btn.classList.add('pressing');
          this.pressed.set(e.pointerId, btn);
        }
        if (btn || this.regionAt(e.clientX, e.clientY) !== 'stick') return;
        this.candidates.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.stickPointer === null) this.claim(e.pointerId, e.clientX, e.clientY);
        e.preventDefault();
      },
      opts,
    );
    this.root.addEventListener(
      'pointermove',
      (e) => {
        // Slide off a disc and it lets go — visually as well as functionally,
        // which is what main.ts's pointerleave already does to the chop hold.
        const held = this.pressed.get(e.pointerId);
        if (held) {
          const r = held.getBoundingClientRect();
          const out =
            e.clientX < r.left - 8 || e.clientX > r.right + 8 || e.clientY < r.top - 8 || e.clientY > r.bottom + 8;
          if (out) {
            held.classList.remove('pressing');
            this.pressed.delete(e.pointerId);
          }
        }
        const cand = this.candidates.get(e.pointerId);
        if (cand) {
          cand.x = e.clientX;
          cand.y = e.clientY;
        }
        if (e.pointerId !== this.stickPointer) return;
        // A CHANGE OF MIND RECENTRES THE STICK. Measured against the direction
        // being commanded right now, not against the previous delta: the thumb
        // is reversing when it moves against what it is asking for. See the
        // three constants above for why each guard is there.
        const tdx = e.clientX - this.lastThumb.x;
        const tdy = e.clientY - this.lastThumb.y;
        this.lastThumb = { x: e.clientX, y: e.clientY };
        const odx = this.stick.knob.x - this.stick.origin.x;
        const ody = this.stick.knob.y - this.stick.origin.y;
        const odist = Math.hypot(odx, ody);
        const tdist = Math.hypot(tdx, tdy);
        if (
          odist > STICK_RADIUS * REVERSE_MIN_DEFLECT &&
          tdist >= REVERSE_MIN_PX &&
          (tdx * odx + tdy * ody) / (tdist * odist) < REVERSE_DOT
        ) {
          this.stick.origin = { x: e.clientX, y: e.clientY };
          this.stick.knob = { x: e.clientX, y: e.clientY };
          e.preventDefault();
          return;
        }
        const dx = e.clientX - this.stick.origin.x;
        const dy = e.clientY - this.stick.origin.y;
        const dist = Math.hypot(dx, dy);
        // Sliding past the ring drags the MATH origin along, so the stick
        // never runs out of travel mid-sprint. Probe: origin lag pins at
        // 62.00px and magnitude at 1.000 for the whole of a 700px drag. The
        // drawn control does not move with it — see `anchor`.
        //
        // AND THE DRAG IS NOT CLAMPED, WHICH WAS MEASURED, NOT ASSUMED. The
        // obvious fix for a walking control is a hard cap on this drift, so it
        // was built and probed at the proposed 90px: `turn` went from 45deg of
        // heading for 56px of lateral thumb to NO 45deg turn at all within the
        // entire width of a 393px screen after a 300px sprint. A frozen origin
        // leaves the thumb hundreds of px out along the old heading, and from
        // there sideways travel barely rotates anything. The control furniture
        // is what had to stop moving; the reference point is what has to keep
        // up. Clamping the wrong one of the two costs the turn.
        if (dist > STICK_RADIUS) {
          const over = dist - STICK_RADIUS;
          this.stick.origin.x += (dx / dist) * over;
          this.stick.origin.y += (dy / dist) * over;
        }
        this.stick.knob = { x: e.clientX, y: e.clientY };
        e.preventDefault();
      },
      opts,
    );
    const end = (e: PointerEvent, cancelled: boolean) => {
      this.livePointers.delete(e.pointerId);
      this.candidates.delete(e.pointerId);
      this.pressed.get(e.pointerId)?.classList.remove('pressing');
      this.pressed.delete(e.pointerId);
      if (e.pointerId === this.stickPointer) {
        this.stickPointer = null;
        this.stick.active = false;
        if (!this.promoteCandidate() && cancelled) {
          this.cancelAt = performance.now();
          this.cancelVec = { ...this.moveVec };
        }
      }
    };
    // WINDOW, CAPTURE PHASE. A pointerup is dispatched to whatever the browser
    // thinks the pointer is over, and if that element is ever outside `root`
    // (or the press is dropped by a gesture recogniser) a listener on `root`
    // never hears the finger leave — and a held chop or a running stick
    // outlives the thumb. Nothing that starts can be missed here.
    window.addEventListener('pointerup', (e) => end(e, false), true);
    window.addEventListener('pointercancel', (e) => end(e, true), true);
    // Backgrounding the app mid-sprint must not leave a chef running when the
    // player comes back. main.ts pauses the run; this drops the inputs.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    });
  }

  private claim(id: number, x: number, y: number) {
    this.stickPointer = id;
    this.stick.active = true;
    this.stick.origin = { x, y };
    this.stick.knob = { x, y };
    this.lastThumb = { x, y };
    // The DRAWN ring is the only thing that moves off the thumb, and only far
    // enough to keep itself whole. The emitted vector is still measured from
    // the press point, so a corner press still emits exactly 0.000 (probe:
    // `edge press ... emits 0`) — the clamp costs no fidelity at all.
    this.stick.anchor = { x: clampAxis(x, window.innerWidth), y: clampAxis(y, window.innerHeight) };
    this.cancelAt = -1;
  }

  /** Newest surviving finger takes the stick, at its own position (no jump). */
  private promoteCandidate(): boolean {
    let last: number | null = null;
    for (const id of this.candidates.keys()) last = id;
    if (last === null) return false;
    const p = this.candidates.get(last)!;
    this.claim(last, p.x, p.y);
    return true;
  }

  private releaseAll() {
    for (const el of this.pressed.values()) el.classList.remove('pressing');
    this.pressed.clear();
    this.keys.clear();
    this.candidates.clear();
    this.livePointers.clear();
    this.stickPointer = null;
    this.stick.active = false;
    this.useButton = false;
    this.cancelAt = -1;
  }

  private markTouch() {
    if (this.device !== 'touch') {
      this.device = 'touch';
      document.documentElement.dataset.device = 'touch';
    }
  }

  /** Wired to the on-screen action buttons by the HUD. */
  pressGrab() {
    this.grabQueued = true;
  }
  setUse(held: boolean) {
    this.useButton = held;
  }
  pressDash() {
    this.dashQueued = true;
  }

  /** Consume a frame of input. Rising edges are cleared on read. */
  sample(): InputSnapshot {
    let x = 0;
    let y = 0;

    if (this.stick.active) {
      const dx = this.stick.knob.x - this.stick.origin.x;
      const dy = this.stick.knob.y - this.stick.origin.y;
      const dist = Math.min(STICK_RADIUS, Math.hypot(dx, dy));
      const mag = dist / STICK_RADIUS;
      if (mag > STICK_DEADZONE) {
        // Rescale past the deadzone so the first millimetre of travel isn't dead.
        const scaled = (mag - STICK_DEADZONE) / (1 - STICK_DEADZONE);
        const ang = Math.atan2(dy, dx);
        x = Math.cos(ang) * scaled;
        y = Math.sin(ang) * scaled;
      }
    } else if (this.cancelAt >= 0) {
      const k = 1 - (performance.now() - this.cancelAt) / CANCEL_COAST_MS;
      if (k <= 0) this.cancelAt = -1;
      else {
        x = this.cancelVec.x * k;
        y = this.cancelVec.y * k;
      }
    }

    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;

    const pads = navigator.getGamepads?.() ?? [];
    let padUse = false;
    for (const pad of pads) {
      if (!pad) continue;
      const ax = pad.axes[0] ?? 0;
      const ay = pad.axes[1] ?? 0;
      if (Math.hypot(ax, ay) > 0.18) {
        x += ax;
        y += ay;
      }
      // RISING EDGES, not "pressed". Held A used to queue a grab every single
      // frame — 60 pick-up-and-put-downs a second — and held X set a `usePointer`
      // sentinel that nothing on the release path ever cleared, so one press of
      // chop stayed held for the rest of the run.
      const a = !!pad.buttons[0]?.pressed;
      const b = !!pad.buttons[1]?.pressed;
      if (a && !this.padPrev.grab) this.grabQueued = true;
      if (b && !this.padPrev.dash) this.dashQueued = true;
      this.padPrev.grab = a;
      this.padPrev.dash = b;
      if (pad.buttons[2]?.pressed) padUse = true;
    }
    this.usePad = padUse;

    const m = Math.hypot(x, y);
    if (m > 1) {
      x /= m;
      y /= m;
    }
    this.moveVec = { x, y };

    const snap: InputSnapshot = {
      move: { ...this.moveVec },
      grabPressed: this.grabQueued,
      // A touch-held button is only held while a finger is actually down.
      useHeld:
        (this.useButton && this.livePointers.size > 0) ||
        this.usePad ||
        this.keys.has('KeyJ') ||
        this.keys.has('KeyK'),
      dashPressed: this.dashQueued,
    };
    this.grabQueued = false;
    this.dashQueued = false;
    if (this.traceOn) {
      this.trace.push({
        t: performance.now(),
        active: this.stick.active,
        ox: +this.stick.origin.x.toFixed(2),
        oy: +this.stick.origin.y.toFixed(2),
        kx: +this.stick.knob.x.toFixed(2),
        ky: +this.stick.knob.y.toFixed(2),
        mx: +snap.move.x.toFixed(4),
        my: +snap.move.y.toFixed(4),
        grab: snap.grabPressed,
        use: snap.useHeld,
        dash: snap.dashPressed,
        pointers: this.livePointers.size,
      });
      if (this.trace.length > 4000) this.trace.shift();
    }
    return snap;
  }
}
