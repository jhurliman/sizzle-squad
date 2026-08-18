import type { Kitchen, Vec2 } from './types';
import { isWalkable } from './kitchen';

/**
 * Breadth-first distance field over walkable cells. Bots steer down the
 * gradient, which gives them human-looking routes for free (they cut corners
 * because they're still driven by the same acceleration model as the player).
 */
export interface FlowField {
  dist: Int32Array;
  width: number;
  height: number;
}

const NEIGHBORS: Vec2[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

export function buildFlow(k: Kitchen, targets: Vec2[]): FlowField {
  const dist = new Int32Array(k.width * k.height).fill(-1);
  const queue: number[] = [];
  for (const t of targets) {
    const cx = Math.floor(t.x);
    const cy = Math.floor(t.y);
    for (const n of NEIGHBORS) {
      const x = cx + n.x;
      const y = cy + n.y;
      if (!isWalkable(k, x, y)) continue;
      const i = y * k.width + x;
      if (dist[i] !== -1) continue;
      dist[i] = 0;
      queue.push(i);
    }
    if (isWalkable(k, cx, cy)) {
      const i = cy * k.width + cx;
      if (dist[i] === -1) {
        dist[i] = 0;
        queue.push(i);
      }
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    const x = i % k.width;
    const y = (i / k.width) | 0;
    for (const n of NEIGHBORS) {
      const nx = x + n.x;
      const ny = y + n.y;
      if (!isWalkable(k, nx, ny)) continue;
      const ni = ny * k.width + nx;
      if (dist[ni] !== -1) continue;
      dist[ni] = dist[i] + 1;
      queue.push(ni);
    }
  }
  return { dist, width: k.width, height: k.height };
}

/** Unit direction that reduces distance-to-target the most from `pos`. */
export function flowDir(f: FlowField, k: Kitchen, pos: Vec2): Vec2 {
  const cx = Math.floor(pos.x);
  const cy = Math.floor(pos.y);
  const here = sample(f, cx, cy);
  let best: Vec2 | null = null;
  let bestD = here;
  // 8-way lookahead makes diagonals emerge instead of stair-stepping.
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = cx + dx;
      const ny = cy + dy;
      if (!isWalkable(k, nx, ny)) continue;
      if (dx && dy && (!isWalkable(k, cx + dx, cy) || !isWalkable(k, cx, cy + dy))) continue;
      const d = sample(f, nx, ny);
      if (d < 0) continue;
      if (d < bestD) {
        bestD = d;
        best = { x: dx, y: dy };
      }
    }
  }
  if (!best) return { x: 0, y: 0 };
  // Aim at the center of the chosen cell so bots don't hug corners.
  const tx = cx + best.x + 0.5;
  const ty = cy + best.y + 0.5;
  const vx = tx - pos.x;
  const vy = ty - pos.y;
  const m = Math.hypot(vx, vy) || 1;
  return { x: vx / m, y: vy / m };
}

export function sample(f: FlowField, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= f.width || y >= f.height) return Number.MAX_SAFE_INTEGER;
  const d = f.dist[y * f.width + x];
  return d === -1 ? Number.MAX_SAFE_INTEGER : d;
}

export function distanceTo(f: FlowField, pos: Vec2): number {
  return sample(f, Math.floor(pos.x), Math.floor(pos.y));
}
