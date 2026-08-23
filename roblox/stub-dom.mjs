// Minimal DOM stub so the procedural canvas textures in textures.ts can run
// headless in Node. The 2D context is a permissive proxy: every method is a
// no-op, gradients/patterns are inert objects, getImageData returns zeroed
// pixels. Each fake canvas remembers the stack that created it so the capture
// can tag which texture function (stucco/timber/flagstone/...) it belongs to.
function mkCtx(canvas) {
  const gradient = { addColorStop() {} };
  return new Proxy(
    {},
    {
      get(_t, k) {
        if (k === 'canvas') return canvas;
        if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createConicGradient')
          return () => gradient;
        if (k === 'getImageData')
          return (_x, _y, w, h) => ({
            data: new Uint8ClampedArray(Math.max(0, (w | 0) * (h | 0) * 4)),
            width: w,
            height: h,
          });
        if (k === 'measureText') return () => ({ width: 1 });
        if (k === 'createPattern') return () => ({});
        if (typeof k === 'symbol') return undefined;
        return () => {};
      },
      set() {
        return true;
      },
    },
  );
}

function mkCanvas() {
  const c = {
    width: 300,
    height: 150,
    style: {},
    __stack: new Error().stack ?? '',
    addEventListener() {},
    removeEventListener() {},
  };
  c.getContext = () => mkCtx(c);
  c.toDataURL = () => 'data:,';
  return c;
}

const doc = {
  createElement: (tag) => (tag === 'canvas' ? mkCanvas() : { style: {} }),
  createElementNS: (_ns, tag) => (tag === 'canvas' ? mkCanvas() : { style: {} }),
};

globalThis.document = doc;
if (typeof globalThis.window === 'undefined') globalThis.window = globalThis;
if (typeof globalThis.self === 'undefined') globalThis.self = globalThis;
globalThis.devicePixelRatio = 1;
if (typeof globalThis.ImageData === 'undefined') {
  globalThis.ImageData = class ImageData {
    constructor(a, b, c) {
      if (a instanceof Uint8ClampedArray) {
        this.data = a;
        this.width = b;
        this.height = c ?? (a.length / 4 / b) | 0;
      } else {
        this.width = a;
        this.height = b;
        this.data = new Uint8ClampedArray(a * b * 4);
      }
    }
  };
}
