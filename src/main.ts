import * as THREE from 'three';
import { AudioEngine } from './audio/audio';
import { BotDirector } from './bots/brain';
import { SIM_DT, createSim, seedPans, step, type SimState } from './domain/sim';
import type { InputSnapshot } from './domain/types';
import { NO_INPUT } from './domain/types';
import { InputManager, haptic } from './input/input';
import { Hud } from './ui/hud';
import { CameraRig } from './view/cameraRig';
import { ChefView } from './view/characters';
import { PALETTE, backdropTexture } from './view/materials';
import { Vfx } from './view/vfx';
import { WorldView } from './view/world';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const labelLayer = document.getElementById('labels')!;
const hudRoot = document.getElementById('hud')!;
const overlay = document.getElementById('overlay')!;
const touchRoot = document.getElementById('touch')!;
const stickRing = document.getElementById('stickRing')!;
/** Is the drawn stick standing back while the player sprints? See the loop. */
let stickFaded = false;
const actionCluster = document.querySelector('.action-cluster') as HTMLElement | null;
const app = document.getElementById('app')!;

/**
 * CAPTURE MODE. The screenshot harness used to sleep in real time while the
 * page rendered every intermediate frame it never looked at — 159 harness runs
 * cost 606 minutes of agent wall time, over half of everything the wave spent.
 * With ?capture=1 the harness drives time explicitly instead: the sim and the
 * whole view layer advance at a fixed 1/60s with rendering suppressed, and one
 * frame is drawn only when a screenshot is actually wanted. A 16-second run
 * goes from ~200 renders to ~8.
 *
 * preserveDrawingBuffer is the price: without it the buffer is cleared after
 * compositing and a screenshot taken while the loop is parked comes back blank.
 * It is off in normal play, where it would cost real framerate.
 */
const CAPTURE_PARAM = new URLSearchParams(location.search).has('capture');

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
  preserveDrawingBuffer: CAPTURE_PARAM,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
// VSM blurs the shadow map itself, so contact shadows land soft and wide like
// the reference's. PCF gives a crunchy stair-stepped edge the reference has
// nowhere in frame. (PCFSoftShadowMap is deprecated in three ≥0.180.)
renderer.shadowMap.type = THREE.VSMShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

/**
 * HIGHLIGHT SHOULDER — a tone curve that is a straight line where the room
 * lives and a soft asymptote only above it.
 *
 * We ran NoToneMapping on the argument that the look depends on lit surfaces
 * landing on their exact albedo, and that ACES lifts midtones and desaturates
 * the top end. Both halves of that are true and neither justified clipping.
 * Measured on the real build: our V p99 was 1.00 against the reference's 0.95,
 * with the oven mantel, the arch stones and the whole fire cavity pinned at
 * pure white — and additive flame geometry stacked three layers deep so it
 * summed way past 1.0 and came out WHITE rather than orange. The reference's
 * fire samples H 17° V 0.67. Ours had no hue left in it at all.
 *
 * ACES is still the wrong tool. This is the right one:
 *
 *   - Below KNEE the curve is the identity. Every architectural surface in the
 *     room sits under 0.70, so the palette in materials.ts still renders as
 *     written, to the bit. Nothing about the mid-range moves.
 *   - Above KNEE it rolls off exponentially to a ceiling just under 1.0, so
 *     nothing can ever clip no matter how much additive fire is stacked.
 *   - It is applied to the MAX CHANNEL and the result rescales all three by the
 *     same factor. That preserves the ratio between channels exactly, which
 *     means it preserves hue AND saturation exactly. This is the whole reason
 *     not to use a per-channel curve: per-channel compression pulls the bright
 *     channel down towards the others and bleaches a hot tomato towards pink.
 *     Here a tomato at (1.30, 0.09, 0.05) comes out at (0.93, 0.06, 0.04) —
 *     dimmer, identically red.
 *
 * Net effect on the frame: the fire goes back to being orange, the mantel and
 * the pale limestone stop being the brightest objects in the room, and the top
 * of the value range is freed up for the food, which is the only thing that
 * should ever be near it.
 */
// The ceiling is a measurement, not a safety margin. Reference V p95 = 0.906
// and its p99 barely clears that; ours ran p95 0.976 with real clipping in the
// fire, the plate stacks and the specular on the new metal tier. Capping at
// 0.93 costs nothing the reference has and buys back the top of the range for
// the food, which is the only thing allowed to live up there.
const TONE_KNEE = 0.62;
const TONE_CEIL = 0.9;
THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment.replace(
  'vec3 CustomToneMapping( vec3 color ) { return color; }',
  `
  vec3 CustomToneMapping( vec3 color ) {
    color *= toneMappingExposure;
    float m = max( max( color.r, color.g ), color.b );
    if ( m < ${TONE_KNEE.toFixed(4)} ) return color;
    const float span = ${(TONE_CEIL - TONE_KNEE).toFixed(4)};
    float rolled = ${TONE_KNEE.toFixed(4)} + span * ( 1.0 - exp( -( m - ${TONE_KNEE.toFixed(4)} ) / span ) );
    return color * ( rolled / max( m, 1e-5 ) );
  }
  `,
);
renderer.toneMapping = THREE.CustomToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.background = backdropTexture();
// Aerial perspective, not haze. Warm and LIGHTER than the walls, so the back
// of the room lifts a few percent relative to the near floor. That is the only
// depth cue a matte, shadow-light, single-hue room has.
// Near plane was 12, which is roughly where the FOREGROUND benches sit: every
// tray in the front half of the room was already carrying 10–18% ochre, and
// mixing a mid-chroma ochre into a tomato is the fastest way to cap the frame's
// saturation. Measured: it was holding our S p99 at 0.83–0.88 against the
// reference's 0.97+. Pushed back so only the far wall and the far benches haze.
scene.fog = new THREE.Fog(PALETTE.fog, 22, 68);

/**
 * LIGHTING — baked, soft, warm, matte. Three rules, read off the reference:
 * no harsh key, no cold accent anywhere, and an ambient term that falls off
 * with normal.y so undersides and corners occlude themselves.
 *
 * Intensities are budgeted, not eyeballed. Two facts drive every number here:
 *
 *  1. Lambert diffuse in three carries a 1/π, so an "intensity 1" light lands
 *     a surface at ~0.32 of its albedo. LUX is that π, applied once, so the
 *     numbers below read as the fraction of albedo each light contributes.
 *  2. Light colours are decoded sRGB→linear before they multiply albedo, and
 *     that decode crushes green and blue hard. A light that looks "gently
 *     warm" as a hex (0xffe3b4) is a savage orange filter in linear. So the
 *     lights are kept almost white and ALL the warmth lives in the albedos —
 *     which is also how a baked scene actually works.
 *
 * ROUND 6 — THE FRAME HAD NO BLACK POINT AND THIS BUDGET IS WHY.
 *
 * The old budget below claimed a floor of 0.49 of albedo and it was optimistic:
 * the toon ramp's foot sat at 0.52, so a face turned fully away from the key
 * still collected half of it and nothing in the room could fall under ~0.49 at
 * all. Wall, floor, furniture and props all landed inside one bright mid band,
 * the p05 darks scattered as floor blotches instead of pooling under furniture,
 * and no value ladder was nameable anywhere in the image.
 *
 * Two changes, together: the ramp foot dropped to 0.30 (materials.ts), and the
 * two normal-independent terms — ambient and hemisphere, the ones that lift
 * EVERY pixel including the ones already in shadow — were cut from 0.485
 * combined to 0.32. The key came up to take back the top of the range, so lit
 * surfaces land within a few percent of where they were and only the darks move.
 *
 * Budget, as a fraction of albedo:
 *
 *   lit top face      0.15 ambient + 0.19 hemi + 0.52 key  ≈ 0.86
 *   lit vertical      0.15 + 0.11 + 0.44 + 0.05 bounce     ≈ 0.75
 *   shaded vertical   0.15 + 0.11 + 0.52 × 0.30 ramp foot  ≈ 0.42
 *   in cast shadow    0.15 + 0.19                          ≈ 0.34
 *   underside         0.15 + 0.04 + 0.05                   ≈ 0.24
 *
 * plus the contact pools, which multiply the flagstones under every bench down
 * a further 40% at the core (world.ts contact()). That is where the reference
 * keeps a third of the darks in the lower half of its frame, and it is the only
 * thing that makes furniture read as standing ON a floor rather than in front
 * of one.
 *
 * The spread is deliberate and it is the whole reason the room reads as lit
 * rather than as flat-shaded geometry: a matte single-hue room needs its darks
 * or it turns into one sheet of brown.
 *
 * The food does NOT come down with the room: it carries its own emissive floor
 * (materials.ts FOOD_LIFT), so every trim here widens the gap between the room
 * and the thing the player is hunting for, which is the entire point.
 *
 * Nothing in this budget clips. Anything that CAN exceed 1.0 — the additive
 * fire — is caught by the highlight shoulder above rather than by clamping.
 */
const LUX = Math.PI;

// Base level: flat, near-white, hue-neutral.
// 0.20 → 0.15. Ambient is the only term that lifts EVERY pixel including the
// ones already in shadow, so it alone sets the frame's black point — and a room
// whose black point is 0.49 of albedo cannot have a value ladder in it. This is
// the number that decides whether the darks land UNDER the furniture.
const ambient = new THREE.AmbientLight(0xfff3e2, 0.15 * LUX);
scene.add(ambient);

// The ambient GRADIENT — this is the fake AO. Sky is bounce off the ochre
// stucco, ground is bounce off the stone floor. Because hemisphere irradiance
// follows normal.y, every underside, inward corner and downward bevel darkens
// and warms on its own: no post pass, no extra render target, no depth buffer
// read. An underside lands at ~0.32 of albedo against a lit top at ~0.98.
// 0.285 → 0.19, and the ground half pushed down and redder. This is the AO
// term: the wider the gap between its sky and its ground colour, the harder
// every underside, inward corner and downward bevel occludes itself.
// ROUND 9 — THE SKY HALF WAS PAINTING THE FLOOR ORANGE.
//
// Hemisphere irradiance follows normal.y, so the SKY colour lands almost
// entirely on up-facing surfaces: the flagstones, the bench tops, the trays.
// At 0xffeacd (S 0.20) it was the single largest warm multiplier on the biggest
// surface in the frame, and it is most of why our bare flag rendered H 38 when
// its albedo is authored at H 47 — nine degrees of hue, on the one mass in the
// image whose whole job is to NOT be the same colour as the timber.
//
// Sky pulled to a near-neutral warm white; the GROUND half stays a deep
// saturated ochre because that term only ever reaches undersides and inward
// corners, where warm occlusion is exactly right and where the reference's is.
//
// ROUND 9b — AND THE GROUND HALF WAS DIGGING THE HOLE TOO DEEP.
//
// Whole-frame V p05: ours 0.322 against the reference's 0.396. Sampled where it
// actually lives, the flagstone under one of our benches renders rgb(38,27,11)
// — V 0.15 — against the reference's rgb(95,64,34), V 0.37. Two full stops. A
// value ladder needs a bottom rung, not a trapdoor: the reference's darkest
// large area is the wall up under its beams at V 0.44, and it has nothing
// anywhere near black. 0x503418 at V 0.31 was the ground bounce of a cellar.
const hemi = new THREE.HemisphereLight(0xfff6ec, 0x6f4d28, 0.19 * LUX);
scene.add(hemi);

// Steep and almost overhead, on purpose. A low key throws long diagonal bands
// of wall shadow, which the reference does not have anywhere; a steep one
// throws a short soft pool directly under each object, which is all the
// reference has. Weak enough that the shadow only reaches ~0.56 of albedo.
// 0.40 → 0.52: the key takes back the top of the range that ambient and hemi
// gave up, so lit surfaces sit where they always did and only the darks moved.
const key = new THREE.DirectionalLight(0xfffbf2, 0.52 * LUX);
key.position.set(2.5, 16, 5);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.left = -13;
key.shadow.camera.right = 13;
key.shadow.camera.top = 13;
key.shadow.camera.bottom = -13;
key.shadow.camera.far = 44;
key.shadow.bias = -0.0009;
key.shadow.normalBias = 0.04;
/**
 * ROUND 13 — THE PENUMBRA IS THE CONTACT SHADOW.
 *
 * The key sits at y=16 over a room 8 high, deliberately, so it throws no long
 * diagonal bars. The cost of that decision is that a knee-height bench's cast
 * shadow lands almost exactly under its own footprint, where a low frontal
 * camera cannot see it — which is why three benches in the middle of every
 * capture read as floating.
 *
 * A VSM blur is the cheap way out: widening the radius spreads the shadow OUT
 * past the object's footprint into a soft halo, which is precisely the shape
 * the reference has under every one of its tables. At 1024 over a 26m frustum
 * the map is 39 texels/m, so radius 11 is a ~28cm penumbra — about a third of a
 * bench's width proud of each edge. It costs one wider separable blur on a
 * 1024² single-channel target and nothing at all in the main pass.
 */
key.shadow.radius = 11;
key.shadow.blurSamples = 16;
scene.add(key);

// Warm bounce off the near floor, aimed up into the undersides of the tables
// and the chins of the chefs. Never casts, never rims — it just stops the
// shaded side of anything from going dead.
const bounce = new THREE.DirectionalLight(0xffd9b0, 0.05 * LUX);
bounce.position.set(-6, 2.5, 12);
scene.add(bounce);

/**
 * THE FRONTAL WALL WASH — round 10, and it is the term the rig was missing.
 *
 * Every light above this one is either omnidirectional (ambient, hemisphere) or
 * comes from almost straight down (the key sits at y=16 over a room 8 high, on
 * purpose, so the set never throws the long diagonal bars the reference has
 * nowhere). The consequence is that the room's VERTICAL surfaces — which is the
 * entire back wall, the chimney breast, both team counters and the front of
 * every bench apron, i.e. most of what the camera actually points at — collect
 * only the normal-independent terms plus a grazing sliver of key.
 *
 * Measured, that cost the middle third of the frame a real amount:
 *
 *                        reference     ours
 *   mid band V p50         0.678       0.643
 *   mid band V p95         0.902       0.859
 *   chimney breast         0.66-0.91   0.63-0.79
 *
 * The reference's chimney is the lightest large mass in its picture and ours
 * was sitting a full 0.12 under it while already carrying a near-white albedo —
 * so the missing light was light, not paint, and pushing the limestone any
 * paler would only have made a white card in a dim room.
 *
 * Near-horizontal on purpose: at y=1.2 over z=26 the vector is 0.05 above the
 * floor plane, so a wall facing the camera collects essentially all of it and a
 * flagstone collects almost none. That asymmetry is the whole point — the low
 * band already measures V p50 0.655 against the reference's 0.643 and must not
 * come up with the wall. It casts nothing, so it cannot reintroduce the
 * horizontal shadow bars the steep key exists to avoid.
 */
const wallFill = new THREE.DirectionalLight(0xfff1dc, 0.075 * LUX);
wallFill.position.set(0.5, 1.2, 26);
scene.add(wallFill);

/**
 * THE SIDE WALLS — round 13, and the last big mass in the frame that was
 * measurably the wrong colour.
 *
 * A ten-bin saturation census against the reference, HUD strip excluded, shows
 * one persistent lump: we carry 16.9% of the frame at S 0.70–0.80 where the
 * reference carries 10.2%, and we are correspondingly short across S 0.40–0.60
 * (21.9% against its 28.0%). Sampling the two frames at matched points says
 * exactly which surface it is:
 *
 *                            reference          ours
 *   back wall, plaster    H 39  S 0.78  V 0.71   H 38  S 0.80  V 0.68
 *   SIDE wall, mid height H 39  S 0.58–0.72  V 0.79–0.87   H 38  S 0.80–0.82  V 0.73–0.77
 *
 * Our back wall is on the reference's number. Our side walls are a fifth of a
 * unit too saturated and a tenth of a stop too dark — and they are the two
 * biggest continuous fields in a landscape frame after the floor. In the
 * reference the side walls are visibly PALER than the back wall, which is not a
 * paint difference (it is the same stucco) but a light one: they face inwards
 * across the room and collect bounce off everything in it.
 *
 * Two horizontal near-white fills, one per wall, do that and nothing else. The
 * mechanism matters: adding a WHITE light to a toon material raises the minimum
 * channel by the same absolute amount as the maximum, so V goes up and S comes
 * down together — which is the exact pair of moves the measurement asks for,
 * and no amount of albedo editing can produce it without also changing the back
 * wall, which is already correct.
 *
 * They are aimed almost dead horizontal (y 4 over a 26m run) so a floor or a
 * bench top collects almost none, and they cast nothing.
 */
// 0.14 washed the room: V p50 went to 0.702 against the reference's 0.663 and
// the whole set lost the depth of its ochre. The measurement that mattered —
// side wall S 0.771 / V 0.808 against the reference's 0.730 / 0.765 — was
// already reached at well under half of it, because the chroma half of the job
// belongs to WALL_SAT_TARGET in materials.ts and was fighting this until it
// was retuned in the same round.
const SIDE_FILL = 0.075;
const sideFillL = new THREE.DirectionalLight(0xfff5e8, SIDE_FILL * LUX);
sideFillL.position.set(40, 4, 8);
scene.add(sideFillL);
const sideFillR = new THREE.DirectionalLight(0xfff5e8, SIDE_FILL * LUX);
sideFillR.position.set(-25, 4, 8);
scene.add(sideFillR);

/**
 * THE FIRE HAS TO LIGHT THE ROOM.
 *
 * The reference does exactly one thing with light that isn't baked: the oven
 * throws a warm pool out of its arch onto the flagstones and up the chimney
 * breast. Ours had a single PointLight at distance 4.2 / decay 2 sitting 2m in
 * FRONT of the mouth, which died inside the alcove — the fire was a decal and
 * nothing in any captured frame proved it was lit.
 *
 * Now it is three sources, because one point light cannot be both a hot core
 * and a wide pool without clipping (there is no tone mapping to catch it):
 *
 *   HEARTH  in the cavity, at the flames. Lights the vault, the voussoirs and
 *           the arch jambs, and rims anything that runs across the mouth.
 *   SPILL   out on the floor in front of the mantel, decay 2 so it falls off
 *           inside ~2m: this is the visible orange ellipse on the stone.
 *   BREAST  weak and wide, aimed up the chimney so the pale limestone above
 *           the arch warms instead of staying a flat grey slab.
 *
 * Kitchen coordinates: the alcove spans x 5–10 (centre 7.5), the back wall
 * face is z≈1.36 and the fire itself burns at z≈0.72, recessed into the wall.
 */
const OVEN_X = 7.5;
// ROUND 6: 0.95 → 0.60. The reference's oven cavity is the DARKEST HOLE IN THE
// PICTURE with the hottest core sitting inside it — it samples rgb(138,61,31),
// S 0.77 V 0.54, a deep red-brown vault with the flame as the only bright thing
// in it. Ours had a hearth light strong enough to render the sooty vault, the
// jambs and the mantel as cream, so the oven read as a bright hole rather than
// a dark one, and the fire had nothing to be brighter THAN. The lamp still rims
// anything crossing the mouth; it no longer lights the masonry it sits in.
const ovenLight = new THREE.PointLight(PALETTE.ovenGlow, 0.6, 5.2, 2.0);
ovenLight.position.set(OVEN_X, 0.85, 0.95);
scene.add(ovenLight);

/**
 * The pool on the flags — and it has to be a POOL, on the floor.
 *
 * This was a 3.6-intensity lamp at y=1.5, z=3.3: 1.8m out from the mantel and
 * 0.8m ABOVE it, i.e. a floodlight aimed back at the fireplace. It lit the
 * mantel shelf (world y≈0.69) to pure white and washed the chimney breast to
 * cream, and it put an orange cast on the near flagstones that dragged them
 * from H 38° S 0.26 to H 31° S 0.52 — the floor stopped being warm grey stone
 * and became orange, which cost the food its neutral ground to sit against.
 *
 * Now it sits at ankle height, below the mantel, so the arch and the shelf are
 * out of its cone entirely and everything it touches is flagstone. Deep amber
 * rather than the flame's orange: bounce off warm stone is always redder than
 * the flame that made it.
 */
// ROUND 9: 1.05 / 7.4m → 0.62 / 5.4m. At the old budget this lamp reached the
// middle third of the play floor and put H 21 S 0.89 orange on it, which is the
// second reason our flagstone rendered nine degrees warmer and a full 0.05 more
// saturated than the reference's. The reference does have a warm pool — it is
// about a metre and a half across, sits directly under the arch, and is gone
// before the first row of benches. This is that pool and no more.
const ovenSpill = new THREE.PointLight(0xff6f1c, 0.62, 5.4, 1.7);
ovenSpill.position.set(OVEN_X, 0.44, 2.5);
scene.add(ovenSpill);

// Up the chimney breast. Almost nothing — the reference's breast is a MID grey
// -green at V 0.66, only 0.09 above the wall next to it, and it is the food's
// job to be the bright thing. This only stops the slab going dead.
const ovenBreast = new THREE.PointLight(0xff9040, 0.26, 5.5, 1.6);
ovenBreast.position.set(OVEN_X, 2.15, 2.05);
scene.add(ovenBreast);

/**
 * THE ARCH — round 13, and it is the reason the fire reads as a decal.
 *
 * The oven is the only light source in the room and, cropped at 2×, it lit
 * nothing but its own cavity: the voussoirs and the jambs rendered as flat
 * cream limestone with the same grey mortar they carry four metres up the
 * chimney, so the fire behind them looked like a lightbox behind frosted glass
 * rather than a fire in a hole. The reference's arch stones are visibly amber
 * for the first course or two out from the mouth and cool back to sage limestone
 * by the crown — that gradient is the whole tell that the fire is IN the room.
 *
 * The three lamps above cannot do it. HEARTH is deliberately weak and 40cm
 * behind the wall face so the vault stays the dark hole the reference has;
 * SPILL sits at ankle height aimed at the flags; BREAST is two metres up and
 * aimed at the chimney. Nothing was pointed at the ring of stone around the
 * mouth itself.
 *
 * This one is: it sits just outside the arch plane, at the height of the arch's
 * springing, with a decay of 2 and a range short enough (2.6m) that it is
 * finished before it reaches the mantel shelf, the team counters or the first
 * row of benches. Reddest of the four — bounce off hot masonry always is.
 */
/**
 * IT SITS AT THE CENTRE OF THE ARCH'S OWN CIRCLE. The first cut of this lamp
 * was a 0.75/2.6m source floating in front of the mouth and it did nothing
 * measurable, because three's distance window is `(1 - (d/cutoff)^4)^2` on top
 * of the inverse square: the arch ring has a radius of ~1.9m, so at a 2.6m
 * cutoff every voussoir was collecting 0.09 of a 0.75 lamp — about 3% of albedo,
 * inside the noise. Put the source at the ring's centre of curvature and every
 * stone in the ring is the same distance from it, so one lamp lights the whole
 * arch evenly and falls off correctly out onto the floor and the mantel.
 */
// 2.3 → 1.35. At 2.3 the whole ring came back H 36-40 S 0.37-0.50 and the
// mantel shelf H 28 S 0.68 — an amber horseshoe. The reference's voussoirs are
// still SAGE limestone (H 46-59, S 0.19-0.29); only the innermost course and
// the jambs either side of the mouth pick the fire up, and the ring cools back
// to stone by the crown. The lamp's job is that gradient, not a wash.
const ovenArch = new THREE.PointLight(0xff5f14, 1.35, 4.8, 2.0);
ovenArch.position.set(OVEN_X, 0.95, 1.55);
scene.add(ovenArch);

/**
 * Flicker. Two irrational frequencies per light so it never repeats on a beat
 * the eye can lock onto, and the three sources are deliberately out of phase:
 * a fire that pulses in unison reads as a dimmer switch.
 */
const ovenFlames: { light: THREE.PointLight; base: number; f1: number; f2: number; amp: number }[] = [
  { light: ovenLight, base: 0.6, f1: 7.3, f2: 2.9, amp: 0.18 },
  { light: ovenSpill, base: 0.62, f1: 5.1, f2: 1.7, amp: 0.16 },
  { light: ovenBreast, base: 0.26, f1: 3.7, f2: 1.1, amp: 0.12 },
  { light: ovenArch, base: 1.35, f1: 6.1, f2: 2.3, amp: 0.2 },
];

function updateFire(time: number) {
  for (let i = 0; i < ovenFlames.length; i++) {
    const f = ovenFlames[i];
    const n = Math.sin(time * f.f1 + i * 2.1) * 0.6 + Math.sin(time * f.f2 + i * 5.3) * 0.4;
    f.light.intensity = f.base * (1 + n * f.amp);
  }
  // The core drifts a few centimetres with the flame so the rim it throws on a
  // passing chef breathes instead of sitting still.
  ovenLight.position.x = OVEN_X + Math.sin(time * 2.3) * 0.16;
  ovenLight.position.y = 0.85 + Math.sin(time * 4.1) * 0.05;
}


// ------------------------------------------------------------------- state

/**
 * THE RUN SEED, AND WHY IT IS NOW PINNABLE.
 *
 * `createSim` takes a seed and the sim is deterministic in it — that is the
 * whole point of the domain rules in AGENTS.md — and this line then threw the
 * determinism away by drawing a fresh seed on every page load. So no two
 * captures this project has ever taken were of the same run, and every A/B
 * measurement built on `tools/shoot.mjs` or `tools/focusshot.mjs` was
 * differencing two different services against each other.
 *
 * It took a marker A/B to notice: two builds returned player positions
 * identical to the centimetre at all seven marks (the route is closed-loop and
 * steers by station kind, and station positions do not depend on the seed) —
 * while a bot in the corner was carrying a tower of plates in one frame and
 * nothing in the other, and 24% of the play field differed.
 *
 * `?seed=N` pins it. Play is unchanged: with no parameter this is exactly the
 * random draw it always was.
 */
const SEED_PARAM = new URLSearchParams(location.search).get('seed');
const runSeed = () => (SEED_PARAM === null ? (Math.random() * 1e9) | 0 : Number(SEED_PARAM) | 0);

let sim: SimState = createSim({ seed: runSeed(), botCount: 3 });
seedPans(sim);
let world = new WorldView(sim.kitchen);
let chefViews = sim.chefs.map((c) => new ChefView(c));
const cameraRig = new CameraRig(sim.kitchen, window.innerWidth, window.innerHeight);
const vfx = new Vfx(labelLayer);
const hud = new Hud(hudRoot);
const input = new InputManager(app);
const bots = new BotDirector();
const audio = new AudioEngine();

const worldRoot = new THREE.Group();
scene.add(worldRoot);
worldRoot.add(world.root);
for (const v of chefViews) worldRoot.add(v.root);
scene.add(vfx.root);

type Phase = 'title' | 'playing' | 'paused' | 'over';
let phase: Phase = 'title';

function rebuild() {
  worldRoot.clear();
  sim = createSim({ seed: runSeed(), botCount: 3 });
  seedPans(sim);
  world = new WorldView(sim.kitchen);
  chefViews = sim.chefs.map((c) => new ChefView(c));
  worldRoot.add(world.root);
  for (const v of chefViews) worldRoot.add(v.root);
  // The room is rebuilt from scratch; the rig must re-solve against it, not go
  // on framing the dimensions it captured at construction.
  cameraRig.setKitchen(sim.kitchen);
  bots.reset();
  hud.reset();
}

// ------------------------------------------------------------------ resize

/**
 * How much of the viewport the thumb cluster covers, bottom-right, as
 * fractions. Measured off the real element because the cluster is sized in
 * vmin with clamps and safe-area insets, so no constant in the rig could stay
 * true across four profiles. Read on layout, never per frame.
 */
let uiCover = { w: 0, h: 0 };
function measureUi() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const wasHidden = touchRoot.style.display === 'none';
  if (wasHidden) touchRoot.style.display = 'block';
  const r = actionCluster?.getBoundingClientRect();
  if (wasHidden) touchRoot.style.display = 'none';
  uiCover = r && r.width > 0 ? { w: (w - r.left) / w, h: (h - r.top) / h } : { w: 0, h: 0 };
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h, false);
  cameraRig.resize(w, h);
  // BOTS PIECE, one line: the brain stages itself against the shot it is in.
  // `halfWidthAtChef` is 2.10 on iPhone portrait and 4.49-6.70 on every
  // landscape shape, and it is the only thing src/bots knows about the view.
  // See OFFSTAGE_COST in src/bots/brain.ts.
  bots.setShotWidth(cameraRig.describe().halfWidthAtChef);
  measureUi();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 120));
resize();

// ------------------------------------------------------------------ ui glue

/**
 * INTEGRATION: an overlay owns the whole screen, INCLUDING the HUD.
 *
 * The results panel and the HUD were built by different hands and never met.
 * `.overlay` dims the WebGL canvas behind it and nothing else, so "Service
 * Over" shipped with the score pill, the clock, the mood chip and — worst — both
 * full-brightness order balloons still drawn on top of it. The balloons carry an
 * inline z-index of 90 and `.hud` at opacity 1 is not a stacking context, so
 * they competed with the overlay at the root and won: on iPhone portrait the two
 * balloons sat directly across the "Service Over" headline and hid over half of
 * it, on the one screen every single run ends on.
 *
 * `body.overlaid` fades the whole HUD out with the same 0.35s curve it fades in
 * with, and `.overlay` is given a z-index above the balloons so a mid-fade frame
 * cannot show them either. Applies to pause as well as game over, which is what
 * you want: an overlay is a modal, and a modal that leaves live UI on top of it
 * is not a modal.
 */
function showOverlay(html: string) {
  overlay.innerHTML = html;
  overlay.classList.add('show');
  document.body.classList.add('overlaid');
}
function hideOverlay() {
  overlay.classList.remove('show');
  document.body.classList.remove('overlaid');
}

function startRun() {
  rebuild();
  cameraRig.beginRun();
  phase = 'playing';
  hideOverlay();
  audio.start();
  audio.resume();
}

document.getElementById('btnStart')?.addEventListener('click', startRun);

overlay.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  if (t.id === 'btnStart' || t.id === 'btnAgain') startRun();
  if (t.id === 'btnResume') {
    phase = 'playing';
    hideOverlay();
  }
});

document.getElementById('btnPause')?.addEventListener('click', () => {
  if (phase === 'playing') {
    phase = 'paused';
    showOverlay(`<div class="panel results">
      <h2>Paused</h2>
      <button id="btnResume" class="cta">Resume</button>
    </div>`);
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && phase === 'playing') {
    phase = 'paused';
    showOverlay(`<div class="panel results"><h2>Paused</h2><button id="btnResume" class="cta">Resume</button></div>`);
  }
});

const btnGrab = document.getElementById('btnGrab')!;
const btnUse = document.getElementById('btnUse')!;
const btnDash = document.getElementById('btnDash')!;
btnGrab.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  input.pressGrab();
  haptic(8);
});
btnUse.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  input.setUse(true);
  // Two of the three discs used to buzz and the third didn't; a control that
  // answers silently while its neighbours answer feels broken, not quiet.
  haptic(5);
});
for (const ev of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
  btnUse.addEventListener(ev, () => input.setUse(false));
}
btnDash.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  input.pressDash();
  haptic(6);
});

// haptic() now lives in src/input/input.ts: navigator.vibrate does not exist
// on iOS Safari at all, so every call site here — grab, dash, serve, burn —
// was silent on the device most of these players are holding.

// ------------------------------------------------------------------- loop

let last = performance.now();
let acc = 0;
let hitstop = 0;
let frameCount = 0;
let fpsAvg = 60;
let worstFrame = 0;

/** Harness-owned clock. See CAPTURE_PARAM above. */
const capture = { on: false, now: 0, skipRender: false };

function frame(now: number) {
  // Re-arm only when we own the clock. In capture mode advance() calls frame()
  // directly, and re-arming there would queue one callback per step.
  if (!capture.on) requestAnimationFrame(frame);
  const realDt = (now - last) / 1000;
  // Game time must track WALL time, or a slow frame silently steals seconds off
  // the run clock. The old ceiling was 0.05s: fine at 60fps, catastrophic under
  // a software rasteriser, where a 1s frame advanced the sim by 50ms and a
  // twelve-second capture produced 0.2s of game — no timer, no orders, no
  // motion. 0.5s still kills the spiral (see the substep cap below) while
  // letting a stalled frame pay back what it owes.
  // ...and a FLOOR of zero, because in capture mode we own the clock:
  // `capture.now` starts at performance.now() and then advances in simulated
  // 16.7ms steps while real wall time runs far ahead of it. A single stale
  // requestAnimationFrame landing after setCapture(true) sets `last` to real
  // time, and the next frame's delta is tens of seconds NEGATIVE. Anything
  // downstream that integrates then runs backwards — the character rig's
  // stagger term grew to 30 and pitched whole chefs 4.5 rad onto their faces.
  const rawDt = Math.min(0.5, Math.max(0, realDt));
  last = now;
  const time = now / 1000;
  if (realDt > 0 && realDt < 1) {
    fpsAvg += (1 / realDt - fpsAvg) * 0.06;
    if (frameCount > 30) worstFrame = Math.max(worstFrame, realDt * 1000);
  }

  const sampled = phase === 'playing' ? input.sample() : { ...NO_INPUT, move: { x: 0, y: 0 } };
  // A RISING EDGE HAS TO SURVIVE UNTIL A SIM STEP ACTUALLY EATS IT.
  //
  // `input.sample()` clears its queued grab/dash on every call and this frame
  // then dropped the edge on the floor, so a tap was silently deleted whenever
  // the frame it landed on did not run a tick. Three ways that happens, and two
  // of them are routine:
  //
  //  - hitstop. Every serve and every bump freezes the sim for 45-70ms, the
  //    branch below consumes rawDt without stepping, and any press in that
  //    window is gone. Caught live: tools/focusshot.mjs pressed grab at a
  //    tomato crate with `focusAction: 'dispense'` on screen and came back
  //    still empty-handed.
  //  - a frame shorter than one tick. On a 120Hz ProMotion iPhone or iPad —
  //    which is the hardware this game is FOR — rawDt is 8.3ms against a
  //    16.7ms tick, so the accumulator only crosses on every second frame and
  //    every other frame's tap was thrown away by construction. Nothing in the
  //    harness could see it: it renders at 60.
  //  - any long stall, where the accumulator has not yet come round.
  //
  // The player then presses a button, watches the glow sitting under the bench
  // they are standing at, and nothing happens — which is exactly the thing
  // REFERENCE.md forbids: "the player is never punished by the camera, the
  // controls, or an ambiguous hitbox". Latched here and cleared only by a step
  // that consumed it. Held state (`useHeld`) needs none of this; it is a level,
  // not an edge.
  pendingGrab = pendingGrab || scriptedInput.grabPressed || sampled.grabPressed;
  pendingDash = pendingDash || scriptedInput.dashPressed || sampled.dashPressed;
  if (phase !== 'playing') {
    pendingGrab = false;
    pendingDash = false;
  }
  const playerInput: InputSnapshot = scriptedInput.enabled
    ? {
        move: { ...scriptedInput.move },
        grabPressed: pendingGrab,
        useHeld: scriptedInput.useHeld || sampled.useHeld,
        dashPressed: pendingDash,
      }
    : { ...sampled, grabPressed: pendingGrab, dashPressed: pendingDash };
  scriptedInput.grabPressed = false;
  scriptedInput.dashPressed = false;
  frameCount++;

  if (phase === 'playing') {
    if (hitstop > 0) {
      hitstop -= rawDt;
    } else {
      acc += rawDt;
      let steps = 0;
      while (acc >= SIM_DT && steps < 32) {
        const botInputs = bots.update(sim, SIM_DT);
        const inputs: InputSnapshot[] = sim.chefs.map((c) =>
          c.isPlayer ? playerInput : (botInputs.get(c.id) ?? NO_INPUT),
        );
        step(sim, inputs);
        acc -= SIM_DT;
        steps++;
        // Only the first sub-step gets the player's rising edges — and this is
        // the one place the latch above is allowed to clear, because it is the
        // only place the edge was actually delivered.
        pendingGrab = false;
        pendingDash = false;
        playerInput.grabPressed = false;
        playerInput.dashPressed = false;
      }
    }

    // BOTS PIECE: the two moments a teammate needs to say out loud — giving way
    // to the player, and realising it has picked up the wrong tray's
    // ingredient. A bot emits the same InputSnapshot the player does, so
    // without this the only thing it can communicate is which way it is
    // walking. Existing vfx API, no new effect types.
    for (const sig of bots.signals) {
      const c = sim.chefs.find((x) => x.id === sig.chef);
      const at = c ? { x: c.pos.x, y: c.pos.y } : sig.at;
      vfx.burst(at, 1.45, 5, 'ring', sig.kind === 'yield' ? 0xffe9a8 : 0xffc4a0, {
        speed: 0.7,
        life: 0.42,
        size: 0.1,
        gravity: 0,
        up: 1.1,
      });
      // Existing label vocabulary, no new CSS: warm yellow for "after you",
      // salmon for "that's the wrong tray". Wordless, like the reference.
      vfx.label(at, 1.62, '!', sig.kind === 'yield' ? 'good' : 'bad');
    }
    bots.signals.length = 0;

    for (const e of sim.events) {
      vfx.handle(e, (n) => cameraRig.addShake(n));
      audio.handle(e);
      if (e.t === 'serve') {
        hitstop = 0.045;
        haptic(e.combo > 3 ? 22 : 12);
      }
      if (e.t === 'serveWrong' || e.t === 'burn') haptic(30);
      // A refused press gets the smallest tap the API can express — a third of
      // a bump, an eighth of a wrong serve. The player's thumb learns "that did
      // not take" without being told off for it. Player only: three bots
      // pressing at dead benches must not buzz the phone.
      if (e.t === 'grabMiss' && e.chef === 0) haptic(8);
      if (e.t === 'gameOver') endRun();
    }
    sim.events.length = 0;

    audio.tickMusic(sim.heat, 1 - sim.score.patience);
    // The live tickets drive the pre-expiry warning — the one sound the player
    // is meant to learn to fear. Read-only; see observeOrders in audio/audio.ts.
    audio.observeOrders(sim.orders);
    // The camera goes in so the HUD can project the pass into screen space and
    // hang the order bubbles there; see src/ui/hud.ts.
    hud.update(sim, cameraRig.camera, window.innerWidth, window.innerHeight);
  } else {
    sim.events.length = 0;
  }

  const player = sim.chefs[0];
  updateFire(time);
  for (const v of chefViews) v.update(rawDt, time);
  world.update(player.focus, player.focusAction, rawDt, time);
  // Every chef, not just the player: the rig crops the frame to the rows the
  // play actually uses, and needs to know if a bot has walked under the crop.
  cameraRig.update(
    player.pos,
    rawDt,
    time,
    sim.chefs.map((c) => c.pos),
  );
  vfx.update(rawDt, cameraRig.camera, window.innerWidth, window.innerHeight);

  // Floating touch stick. `anchor` IS the math origin, nudged only far enough
  // inboard to keep the whole ring on the glass, so the knob below is painted
  // at the finger and the drawn heading is the emitted heading. It was briefly
  // frozen at the press point instead, and the chef then steered up to 47deg
  // away from the control the player was reading — see TouchStickView.anchor
  // in src/input/input.ts and tools/honestprobe.mjs.
  if (input.device === 'touch' && input.stick.active) {
    stickRing.classList.add('on');
    stickRing.style.left = `${input.stick.anchor.x}px`;
    stickRing.style.top = `${input.stick.anchor.y}px`;
    const r = input.stick.radius;
    const dx = input.stick.knob.x - input.stick.origin.x;
    const dy = input.stick.knob.y - input.stick.origin.y;
    const d = Math.min(r, Math.hypot(dx, dy));
    const a = Math.atan2(dy, dx);
    const knob = stickRing.firstElementChild as HTMLElement;
    knob.style.transform = `translate(${Math.cos(a) * d}px, ${Math.sin(a) * d}px)`;
    // A COMMITTED RUN DOES NOT NEED TO LOOK AT ITS OWN STICK.
    // The control is at full presence while the thumb is placing itself and
    // while it is being used for fine positioning, and steps back once the
    // player is sprinting — which is the only time the chef, the benches and
    // the food underneath it matter more than it does. Hysteresis (0.62 up,
    // 0.34 down) so a thumb held near the threshold cannot flicker it.
    if (d / r > 0.62) stickFaded = true;
    else if (d / r < 0.34) stickFaded = false;
    // Bounds on the 0.55: at 1.0 the control is what the wave-2 critic saw over
    // the play field for the whole of a run; at the 0.35 first tried, the 2x
    // crop showed the knob dissolve into fog and the ring stop reading as an
    // object at all. Measured on one frozen frame (tools/stickprobe.mjs
    // `paint`), the control repaints 2.63% of a portrait frame at full presence
    // and 1.45% at 0.55, with the pixels it covers by more than 60 luma —
    // erasure, in other words — dropping from 1.00% to 0.26%.
    const want = stickFaded ? '0.55' : '';
    if (stickRing.style.opacity !== want) stickRing.style.opacity = want;
  } else {
    stickRing.classList.remove('on');
    // Inline opacity would otherwise outrank `.stick-ring.on`'s fade-out and
    // leave the ring parked at 0.42 for the rest of the run.
    stickRing.style.opacity = '';
    stickFaded = false;
  }
  touchRoot.style.display = input.device === 'touch' ? 'block' : 'none';
  // The thumb cluster covers the right of a phone-landscape frame; tell the rig
  // so it can slide the shot and put side wall under the buttons, not benches.
  // The rig also needs to know HOW MUCH it covers, measured off the real
  // element rather than guessed at, so it can keep the player out of it —
  // measured on layout only, never per frame.
  cameraRig.setTouchUi(input.device === 'touch', uiCover);

  if (capture.skipRender) return;
  // NO VIGNETTE. Neither reference frame has one, and ours was measurably the
  // defect the brief names: the outer 14% of a desktop frame came out at mean
  // luma 103 / stdev 26 against the reference's 137 / 48. A screen-space
  // darkening manufactures exactly the dead margin we are trying not to have.
  // Frame edges stay live; if a corner reads empty, dress it in world.ts.
  renderer.render(scene, cameraRig.camera);
}

function endRun() {
  phase = 'over';
  const s = sim.score;
  showOverlay(`<div class="panel results">
    <h2>Service Over</h2>
    <div class="big">${s.coins}</div>
    <div style="opacity:.7;font-weight:800;font-size:13px">coins earned</div>
    <div class="stats">
      <div class="row"><span>Dishes served</span><b>${s.served}</b></div>
      <div class="row"><span>Orders missed</span><b>${s.missed}</b></div>
      <div class="row"><span>Best combo</span><b>${s.bestCombo}×</b></div>
      <div class="row"><span>Time survived</span><b>${Math.floor(sim.time / 60)}:${String(Math.floor(sim.time % 60)).padStart(2, '0')}</b></div>
    </div>
    <button id="btnAgain" class="cta">Cook Again</button>
  </div>`);
}

requestAnimationFrame(frame);

// Expose a hook so automated critics can drive and inspect the real game.
(window as unknown as Record<string, unknown>).__game = {
  get phase() {
    return phase;
  },
  /** Plain-JSON snapshot — safe to pass across the Playwright bridge. */
  snapshot() {
    return {
      phase,
      time: sim.time,
      heat: sim.heat,
      score: { ...sim.score },
      orders: sim.orders.map((o) => ({
        id: o.id,
        name: o.recipe.name,
        remaining: +o.remaining.toFixed(2),
        total: o.total,
        components: o.recipe.components.map((c) => `${c.kind}:${c.state}`),
      })),
      chefs: sim.chefs.map((c) => ({
        id: c.id,
        isPlayer: c.isPlayer,
        skin: c.skin,
        x: +c.pos.x.toFixed(2),
        y: +c.pos.y.toFixed(2),
        speed: +Math.hypot(c.vel.x, c.vel.y).toFixed(2),
        intent: c.intent,
        focus: c.focus,
        // WHICH bench was already in the snapshot; WHAT the button would do
        // there was not, so no report.json in this project's history can show
        // whether a press would have been answered. One field, same tick, same
        // plan `doGrab` runs — see `planGrab` in domain/sim.ts.
        focusAction: c.focusAction,
        carrying: c.carrying
          ? c.carrying.type === 'ingredient'
            ? `${c.carrying.ingredient.kind}:${c.carrying.ingredient.state}`
            : c.carrying.type === 'plate'
              ? `plate[${c.carrying.plate.contents.map((i) => i.kind + ':' + i.state).join(',')}]`
              : `pan[${c.carrying.pan.contents.map((i) => i.kind + ':' + i.state).join(',')}]`
          : null,
      })),
      stations: sim.kitchen.stations.map((st) => ({
        id: st.id,
        kind: st.kind,
        dispenses: st.dispenses ?? null,
        cell: st.cell,
        work: +st.work.toFixed(2),
        holding: st.holding ? st.holding.type : null,
      })),
      camera: cameraRig.describe(),
      perf: { frames: frameCount, fps: +fpsAvg.toFixed(1), worstFrameMs: +worstFrame.toFixed(1) },
    };
  },
  start: startRun,
  /**
   * Fast-forward the sim by N seconds without rendering. The headless critic
   * runs on a software rasteriser at ~1fps, so anything time-dependent —
   * orders, heat, patience — is otherwise unreachable in a screenshot. Bots
   * play through the warp; the player stands still.
   */
  warp(seconds: number) {
    if (phase !== 'playing') return;
    let t = 0;
    while (t < seconds && !sim.over) {
      const botInputs = bots.update(sim, SIM_DT);
      step(
        sim,
        sim.chefs.map((c) => (c.isPlayer ? NO_INPUT : (botInputs.get(c.id) ?? NO_INPUT))),
      );
      sim.events.length = 0;
      t += SIM_DT;
    }
    hud.update(sim, cameraRig.camera, window.innerWidth, window.innerHeight);
  },
  /** Take control of the player chef. Pass {enabled:false} to hand it back. */
  setInput(i: Partial<InputSnapshot> & { enabled?: boolean }) {
    if (i.move) scriptedInput.move = { ...i.move };
    if (i.grabPressed !== undefined) scriptedInput.grabPressed = i.grabPressed;
    if (i.useHeld !== undefined) scriptedInput.useHeld = i.useHeld;
    if (i.dashPressed !== undefined) scriptedInput.dashPressed = i.dashPressed;
    if (i.enabled !== undefined) scriptedInput.enabled = i.enabled;
  },
  /** Take the clock away from requestAnimationFrame (harness only). */
  setCapture(on: boolean) {
    capture.on = on;
    if (on) {
      /**
       * A FIXED ORIGIN, NOT performance.now(). EVERY A/B THIS PROJECT HAS RUN
       * WAS COMPARING TWO DIFFERENT PHASES OF THE ROOM.
       *
       * `time` is `now / 1000`, and every breathing thing in the view — the
       * oven flicker and pulse, the steam, the hanging pans, the idle rigs, the
       * focus marker's own 0.41 Hz — is a sine of it. Seeding the capture clock
       * from wall time gave each run a random phase for all of them, so two
       * captures of the SAME BUILD differ over 35% of the frame with a peak
       * luma delta of 219 (measured: shots/ab-marker-on vs shots/ab-ctrl before
       * this line changed). Any measurement made by differencing two builds was
       * reading that noise. The sim was never the problem — chef positions
       * matched to the centimetre across both runs.
       *
       * 90000 rather than 0 so nothing that has been running since load starts
       * its life at exactly t=0.
       */
      capture.now = 90000;
      // ...and the frame clock with it, or the first captured frame sees a
      // delta of (90000 - wall time) and the sim jumps the 0.5s ceiling before
      // the harness has issued a single instruction.
      last = capture.now;
    } else {
      last = performance.now();
      requestAnimationFrame(frame);
    }
  },

  /**
   * Advance `seconds` of game time at a fixed 1/60s, rendering ONLY the final
   * frame. Everything the real loop does still runs every step — sim, bots,
   * events, VFX, character rigs, camera — so the frame that lands is the frame
   * the player would have seen, just without the ~200 discarded renders.
   */
  advance(seconds: number) {
    if (!capture.on) return 0;
    const stepMs = 1000 / 60;
    const n = Math.max(1, Math.round((seconds * 1000) / stepMs));
    for (let i = 0; i < n; i++) {
      capture.skipRender = i < n - 1;
      capture.now += stepMs;
      frame(capture.now);
    }
    capture.skipRender = false;
    return n;
  },

  /** One render, timed. A far more honest cost signal than the rAF fps average. */
  renderCostMs() {
    const t0 = performance.now();
    capture.skipRender = false;
    frame(capture.now + 1000 / 60);
    capture.now += 1000 / 60;
    return +(performance.now() - t0).toFixed(1);
  },

  resetPerf() {
    frameCount = 0;
    fpsAvg = 60;
    worstFrame = 0;
  },
};

const scriptedInput = { ...NO_INPUT, move: { x: 0, y: 0 }, enabled: false };
/** Rising edges waiting for a sim tick to consume them. See `frame()`. */
let pendingGrab = false;
let pendingDash = false;
