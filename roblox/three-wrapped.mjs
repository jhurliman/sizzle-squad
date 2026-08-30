// Instrumented three.js: re-exports the real module but swaps the primitive
// geometry classes for recording subclasses. Each instance remembers its
// constructor args, the stack that created it (→ which builder), and the
// accumulated transform applied via translate/rotate/scale (all of which
// funnel through applyMatrix4 in three's BufferGeometry).
export * from 'REAL_THREE';
import * as T from 'REAL_THREE';

const cap = {
  geos: new WeakMap(), // geometry -> record
  merges: new WeakMap(), // merged geometry -> source geometry list
};
globalThis.__cap = cap;

function instrument(Base, kind) {
  return class extends Base {
    constructor(...args) {
      super(...args);
      cap.geos.set(this, {
        kind,
        args,
        stack: new Error().stack ?? '',
        mat: new T.Matrix4(),
      });
    }
    applyMatrix4(m) {
      const r = cap.geos.get(this);
      if (r) r.mat = new T.Matrix4().multiplyMatrices(m, r.mat);
      return super.applyMatrix4(m);
    }
  };
}

export const BoxGeometry = instrument(T.BoxGeometry, 'box');
export const CylinderGeometry = instrument(T.CylinderGeometry, 'cyl');
export const ConeGeometry = instrument(T.ConeGeometry, 'cone');
export const SphereGeometry = instrument(T.SphereGeometry, 'ball');
export const PlaneGeometry = instrument(T.PlaneGeometry, 'plane');
export const CircleGeometry = instrument(T.CircleGeometry, 'circle');
export const RingGeometry = instrument(T.RingGeometry, 'ring');
export const LatheGeometry = instrument(T.LatheGeometry, 'lathe');
export const TorusGeometry = instrument(T.TorusGeometry, 'torus');
export const CapsuleGeometry = instrument(T.CapsuleGeometry, 'capsule');
