/**
 * Portable spellings of the few standard-library pieces the Roblox build's
 * TypeScript-to-Luau compiler cannot express directly. The web build uses
 * these too, so both platforms run literally the same arithmetic — hypot in
 * particular: V8's Math.hypot uses a different (overflow-safe) algorithm than
 * sqrt(x²+y²), and at kitchen magnitudes the naive form is exact enough while
 * keeping the two builds bit-compatible.
 */

export function hypot(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

/** `new Array(n).fill(v)`, spelled without Array-with-length construction. */
export function filled<T>(n: number, v: T): T[] {
  const a: T[] = [];
  for (let i = 0; i < n; i++) a.push(v);
  return a;
}
