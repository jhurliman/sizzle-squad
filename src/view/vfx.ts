import * as THREE from 'three';
import { INGREDIENT_DEFS } from '../domain/content';
import type { IngredientKind, SimEvent, Vec2 } from '../domain/types';
import { particleMaterial } from './materials';

/**
 * Pooled particles + floating labels. Every effect is driven by a SimEvent, so
 * the juice can never disagree with what actually happened in the sim.
 */

interface P {
  alive: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  spin: number;
  color: THREE.Color;
  gravity: number;
  kind: 'puff' | 'spark' | 'confetti' | 'smoke' | 'ring';
}

const MAX = 460;

/** The ingredient's own hex, so a burst is always the colour of the food. */
function foodColor(kind: IngredientKind): number {
  return INGREDIENT_DEFS[kind]?.color ?? 0xfff0cf;
}

export class Vfx {
  readonly root = new THREE.Group();
  private pool: P[] = [];
  private mesh: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  private colorAttr: THREE.InstancedBufferAttribute;
  private alphaAttr: THREE.InstancedBufferAttribute;
  private labels: { el: HTMLDivElement; pos: THREE.Vector3; life: number; maxLife: number; rise: number }[] = [];

  constructor(private labelLayer: HTMLElement) {
    const geo = new THREE.PlaneGeometry(1, 1);
    // `vertexColors` is what lets instanceColor reach the fragment shader
    // (three only samples vColor under USE_COLOR), but it also multiplies in
    // the geometry's `color` attribute — and an absent attribute reads as
    // (0,0,0), so every particle rendered pure black. Supply white.
    geo.setAttribute(
      'color',
      new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3).fill(1), 3),
    );
    // Round sprite + a real per-instance alpha (see materials.ts). Fading by
    // multiplying the colour towards zero at alpha 1 is what put dying black
    // squares on the floor next to the chopping board.
    const mat = particleMaterial();
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.frustumCulled = false;
    this.mesh.count = MAX;
    const colors = new Float32Array(MAX * 3);
    this.colorAttr = new THREE.InstancedBufferAttribute(colors, 3);
    this.mesh.instanceColor = this.colorAttr;
    this.alphaAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1);
    geo.setAttribute('aAlpha', this.alphaAttr);
    this.root.add(this.mesh);
    for (let i = 0; i < MAX; i++) {
      this.pool.push({
        alive: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        size: 0.1,
        spin: 0,
        color: new THREE.Color(),
        gravity: 0,
        kind: 'puff',
      });
    }
  }

  private spawn(): P | null {
    for (const p of this.pool) if (!p.alive) return p;
    return null;
  }

  burst(
    at: Vec2,
    height: number,
    count: number,
    kind: P['kind'],
    color: number,
    opts: { speed?: number; life?: number; size?: number; gravity?: number; up?: number } = {},
  ) {
    for (let i = 0; i < count; i++) {
      const p = this.spawn();
      if (!p) return;
      p.alive = true;
      p.kind = kind;
      p.pos.set(at.x + (Math.random() - 0.5) * 0.18, height, at.y + (Math.random() - 0.5) * 0.18);
      const a = Math.random() * Math.PI * 2;
      const sp = (opts.speed ?? 1.5) * (0.5 + Math.random() * 0.7);
      p.vel.set(Math.cos(a) * sp, (opts.up ?? 1.2) * (0.5 + Math.random()), Math.sin(a) * sp);
      p.maxLife = (opts.life ?? 0.55) * (0.75 + Math.random() * 0.5);
      p.life = p.maxLife;
      p.size = (opts.size ?? 0.15) * (0.7 + Math.random() * 0.6);
      p.spin = (Math.random() - 0.5) * 10;
      p.gravity = opts.gravity ?? -4;
      p.color.setHex(color);
    }
  }

  label(at: Vec2, height: number, text: string, className: string) {
    const el = document.createElement('div');
    el.className = `float-label ${className}`;
    el.textContent = text;
    this.labelLayer.appendChild(el);
    this.labels.push({ el, pos: new THREE.Vector3(at.x, height, at.y), life: 1.1, maxLife: 1.1, rise: 0 });
  }

  handle(e: SimEvent, onShake: (n: number) => void) {
    switch (e.t) {
      case 'pickup':
        this.burst(e.at, 1.05, 4, 'ring', 0xffffff, { speed: 0.8, life: 0.28, size: 0.09, gravity: 0, up: 0.6 });
        break;
      case 'place':
        this.burst(e.at, 1.0, 5, 'puff', 0xfff0cf, { speed: 1.1, life: 0.3, size: 0.1, gravity: -2, up: 0.5 });
        break;
      case 'chopTick':
        this.burst(e.at, 1.05, 2, 'spark', 0xfff6d8, { speed: 1.7, life: 0.26, size: 0.055, up: 1.7 });
        break;
      case 'chopDone':
        this.burst(e.at, 1.05, 10, 'confetti', foodColor(e.kind), { speed: 2.2, life: 0.55, size: 0.075, gravity: -5, up: 2.6 });
        this.burst(e.at, 1.05, 5, 'spark', 0xfff3b0, { speed: 2.4, life: 0.34, size: 0.06, up: 2.0 });
        break;
      case 'cookDone':
        this.burst(e.at, 1.1, 10, 'confetti', foodColor(e.kind), { speed: 1.8, life: 0.65, size: 0.08, gravity: -5, up: 2.8 });
        this.burst(e.at, 1.1, 8, 'spark', 0xffd166, { speed: 1.6, life: 0.5, size: 0.08, up: 2.1 });
        // HUD/ORDERS PIECE: the "Ready!" label is gone. It shipped as an 11px
        // cream-on-brown pill that landed on the Toad's cap on iPad, with the
        // order balloon's white tail cutting straight through its exclamation
        // mark. The reference is wordless throughout; the confetti above plus
        // the balloon's own ready pulse (styles.css .bub.in.ready) already say
        // it, diegetically and without a z-order fight.
        break;
      case 'burn':
        this.burst(e.at, 1.15, 14, 'smoke', 0x6b5344, { speed: 0.7, life: 1.4, size: 0.24, gravity: 0.4, up: 1.2 });
        this.label(e.at, 1.5, 'Burnt!', 'bad');
        break;
      case 'fireStart':
        this.burst(e.at, 1.15, 26, 'puff', 0xff6b3d, { speed: 1.3, life: 0.9, size: 0.24, gravity: 1.4, up: 2.4 });
        onShake(0.4);
        break;
      case 'serve': {
        // Three saturated hues, all thrown UP hard so the celebration happens
        // at head height where the eye is, and lands rather than dribbles.
        this.burst(e.at, 1.2, 18, 'confetti', 0xffd166, { speed: 3.0, life: 0.95, size: 0.13, gravity: -6.5, up: 4.0 });
        this.burst(e.at, 1.2, 10, 'confetti', 0xff5a4a, { speed: 2.6, life: 0.9, size: 0.12, gravity: -6.5, up: 3.6 });
        this.burst(e.at, 1.2, 10, 'confetti', 0x7bd93a, { speed: 2.4, life: 0.85, size: 0.12, gravity: -6.5, up: 3.2 });
        this.label(e.at, 1.6, `+${e.value}`, e.combo > 2 ? 'great' : 'good');
        if (e.combo > 1) this.label({ x: e.at.x, y: e.at.y + 0.35 }, 2.1, `${e.combo}x`, 'combo');
        onShake(0.16 + Math.min(0.2, e.combo * 0.02));
        break;
      }
      case 'serveWrong':
        this.burst(e.at, 1.2, 10, 'puff', 0xc9737a, { speed: 1.4, life: 0.5, size: 0.14, up: 1.4 });
        this.label(e.at, 1.6, 'Not on the ticket', 'bad');
        onShake(0.12);
        break;
      /**
       * A PRESS THAT DID NOTHING NOW LOOKS LIKE SOMETHING.
       *
       * Before this case existed, a refused press emitted no event at all, so a
       * mistimed input and a DROPPED input were the same picture: nothing. That
       * is the one thing REFERENCE.md's forgiveness clause forbids, because a
       * player who cannot tell the two apart learns to distrust the button.
       *
       * "Failure is short and never ugly to look at." Four small pale puffs at
       * the hands, 0.12s, no shake, no label, no colour that reads as damage —
       * a quarter of the mass of the `place` cue it is the negative of, and
       * over before you could describe it. The sound (audio.ts) carries the
       * information; this only has to make the frame agree.
       */
      case 'grabMiss':
        this.burst(e.at, 1.0, 4, 'puff', 0xcfc3b2, { speed: 0.7, life: 0.12, size: 0.075, gravity: -1.5, up: 0.4 });
        break;
      case 'trash':
        // Warm dust, not gravel grey — grey at floor value reads as litter.
        this.burst(e.at, 1.05, 8, 'smoke', 0xd8c4a4, { speed: 0.9, life: 0.6, size: 0.14, gravity: -1, up: 1.0 });
        break;
      case 'washDone':
        this.burst(e.at, 1.05, 10, 'spark', 0xbfe9ff, { speed: 1.6, life: 0.45, size: 0.07, up: 1.8 });
        break;
      case 'bump':
        this.burst(e.at, 0.7, 7, 'spark', 0xffffff, { speed: 2.4, life: 0.3, size: 0.07, up: 0.8 });
        onShake(0.1);
        break;
      case 'wallHit':
        this.burst(e.at, 0.22, 5, 'puff', 0xe0cfae, { speed: 0.9, life: 0.3, size: 0.09, gravity: -0.3, up: 0.4 });
        break;
      case 'orderExpired':
        onShake(0.22);
        break;
      default:
        break;
    }
  }

  update(dt: number, camera: THREE.Camera, width: number, height: number) {
    let n = 0;
    for (const p of this.pool) {
      if (!p.alive) {
        this.dummy.position.set(0, -999, 0);
        this.dummy.scale.setScalar(0);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(n, this.dummy.matrix);
        this.colorAttr.setXYZ(n, 0, 0, 0);
        this.alphaAttr.setX(n, 0);
        n++;
        continue;
      }
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
      }
      p.vel.y += p.gravity * dt;
      if (p.kind === 'smoke') {
        p.vel.x *= 1 - dt * 1.2;
        p.vel.z *= 1 - dt * 1.2;
      }
      p.pos.addScaledVector(p.vel, dt);
      if (p.pos.y < 0.04 && p.kind === 'confetti') {
        p.pos.y = 0.04;
        p.vel.y *= -0.35;
        p.vel.x *= 0.7;
        p.vel.z *= 0.7;
      }
      const t = Math.max(0, p.life / p.maxLife);
      let scale = p.size;
      if (p.kind === 'puff' || p.kind === 'smoke') scale = p.size * (1.4 - t * 0.7);
      if (p.kind === 'ring') scale = p.size * (2.2 - t * 1.6);
      if (p.kind === 'spark') scale = p.size * t;
      this.dummy.position.copy(p.pos);
      this.dummy.quaternion.copy(camera.quaternion);
      this.dummy.rotateZ(p.spin * (p.maxLife - p.life));
      this.dummy.scale.setScalar(scale);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(n, this.dummy.matrix);
      // Colour stays at full strength for the whole life; only ALPHA falls.
      // A confetti flake that dims as it drops is a grey flake on a grey floor
      // — which is exactly what read as litter. It has to keep its hue right
      // up to the frame it vanishes on.
      const fade = p.kind === 'smoke' ? Math.min(1, t * 1.6) * 0.5 : Math.min(1, t * 2.2);
      this.colorAttr.setXYZ(n, p.color.r, p.color.g, p.color.b);
      this.alphaAttr.setX(n, fade);
      n++;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;

    // Floating labels are DOM so text stays crisp at every DPR.
    const v = new THREE.Vector3();
    for (let i = this.labels.length - 1; i >= 0; i--) {
      const l = this.labels[i];
      l.life -= dt;
      l.rise += dt * 0.9;
      if (l.life <= 0) {
        l.el.remove();
        this.labels.splice(i, 1);
        continue;
      }
      v.copy(l.pos);
      v.y += l.rise;
      v.project(camera);
      const t = l.life / l.maxLife;
      const pop = t > 0.85 ? 1.35 - (1 - t) * 2.3 : 1;
      l.el.style.transform = `translate(-50%,-50%) translate(${((v.x + 1) / 2) * width}px, ${((-v.y + 1) / 2) * height}px) scale(${pop.toFixed(3)})`;
      l.el.style.opacity = String(Math.min(1, t * 2.6));
    }
  }
}
