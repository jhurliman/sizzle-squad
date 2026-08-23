// Wrapped BufferGeometryUtils: mergeGeometries keeps a map from the merged
// geometry back to its source list, so the capture can expand each merged
// color-bucket mesh into its individual primitives.
export * from 'REAL_UTILS';
import { mergeGeometries as realMerge } from 'REAL_UTILS';

export function mergeGeometries(list, useGroups) {
  const out = realMerge(list, useGroups);
  if (out) globalThis.__cap.merges.set(out, [...list]);
  return out;
}
