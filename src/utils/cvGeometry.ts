import type { FolderId, Point2D, QuadCorners, ScanDocument } from '../types/scanner';

/**
 * Clamp a number between min and max.
 */
export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/**
 * Orders an arbitrary set of 4 2D points into:
 * [topLeft, topRight, bottomRight, bottomLeft].
 */
export function orderCorners(pts: [Point2D, Point2D, Point2D, Point2D]): QuadCorners {
  // Sort by sum (x + y): smallest = TL, largest = BR
  // Sort by diff (y - x): smallest = TR, largest = BL
  const copy = pts.map((p) => ({ x: p.x, y: p.y }));
  let tl = copy[0];
  let br = copy[0];
  let tr = copy[0];
  let bl = copy[0];

  let minSum = Infinity;
  let maxSum = -Infinity;
  let minDiff = Infinity;
  let maxDiff = -Infinity;

  for (const p of copy) {
    const sum = p.x + p.y;
    const diff = p.y - p.x;
    if (sum < minSum) {
      minSum = sum;
      tl = p;
    }
    if (sum > maxSum) {
      maxSum = sum;
      br = p;
    }
    if (diff < minDiff) {
      minDiff = diff;
      tr = p;
    }
    if (diff > maxDiff) {
      maxDiff = diff;
      bl = p;
    }
  }

  return [tl, tr, br, bl];
}

/**
 * Computes the 3x3 projective homography matrix H (as a flat 9-element array)
 * that maps 4 source points `src` -> 4 destination points `dst`.
 * Uses Gaussian elimination with partial pivoting on an 8x8 linear system.
 */
export function computeHomography(
  src: [Point2D, Point2D, Point2D, Point2D],
  dst: [Point2D, Point2D, Point2D, Point2D]
): number[] {
  const A: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const sx = src[i].x;
    const sy = src[i].y;
    const dx = dst[i].x;
    const dy = dst[i].y;

    A.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy]);
    b.push(dx);

    A.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy]);
    b.push(dy);
  }

  const n = 8;
  for (let col = 0; col < n; col++) {
    // Partial pivot
    let maxRow = col;
    let maxVal = Math.abs(A[col][col]);
    for (let row = col + 1; row < n; row++) {
      const val = Math.abs(A[row][col]);
      if (val > maxVal) {
        maxVal = val;
        maxRow = row;
      }
    }

    if (maxRow !== col) {
      const tmpRow = A[col];
      A[col] = A[maxRow];
      A[maxRow] = tmpRow;
      const tmpB = b[col];
      b[col] = b[maxRow];
      b[maxRow] = tmpB;
    }

    const pivot = A[col][col];
    if (Math.abs(pivot) < 1e-10) {
      // Degenerate quad fallback: identity
      return [1, 0, 0, 0, 1, 0, 0, 0, 1];
    }

    for (let row = col + 1; row < n; row++) {
      const factor = A[row][col] / pivot;
      for (let k = col; k < n; k++) {
        A[row][k] -= factor * A[col][k];
      }
      b[row] -= factor * b[col];
    }
  }

  // Back substitution
  const h = new Array<number>(9).fill(0);
  h[8] = 1;
  for (let row = n - 1; row >= 0; row--) {
    let sum = b[row];
    for (let col = row + 1; col < n; col++) {
      sum -= A[row][col] * h[col];
    }
    h[row] = sum / A[row][row];
  }

  return h;
}

/**
 * Applies a 3x3 homography matrix H to point (x, y).
 */
export function applyHomography(H: number[], x: number, y: number): Point2D {
  const denom = H[6] * x + H[7] * y + H[8];
  if (Math.abs(denom) < 1e-10) {
    return { x, y };
  }
  return {
    x: (H[0] * x + H[1] * y + H[2]) / denom,
    y: (H[3] * x + H[4] * y + H[5]) / denom,
  };
}

/**
 * Estimates the dewarped rectangular output width and height from a quad in pixel coordinates,
 * preserving natural aspect ratio while bounding the largest side to `maxDim`.
 */
export function estimateOutputDimensions(
  quadPixels: QuadCorners,
  maxDim = 1600
): { width: number; height: number } {
  const [tl, tr, br, bl] = quadPixels;
  const dist = (a: Point2D, b: Point2D) => Math.hypot(b.x - a.x, b.y - a.y);

  const widthTop = dist(tl, tr);
  const widthBottom = dist(bl, br);
  const heightLeft = dist(tl, bl);
  const heightRight = dist(tr, br);

  const rawW = Math.max(widthTop, widthBottom, 32);
  const rawH = Math.max(heightLeft, heightRight, 32);

  const scale = Math.min(1, maxDim / Math.max(rawW, rawH));
  return {
    width: Math.max(64, Math.round(rawW * scale)),
    height: Math.max(64, Math.round(rawH * scale)),
  };
}

/**
 * Computes area of a quadrilateral via the shoelace formula.
 */
export function quadArea(quad: QuadCorners): number {
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    area += quad[i].x * quad[j].y;
    area -= quad[j].x * quad[i].y;
  }
  return Math.abs(area) / 2;
}

/**
 * Checks whether a normalized quad is convex and covers a reasonable portion of the frame.
 */
export function isValidDocumentQuad(quad: QuadCorners): boolean {
  const area = quadArea(quad);
  if (area < 0.032 || area > 0.995) return false;

  // Cross-product sign consistency check for convexity
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const p0 = quad[i];
    const p1 = quad[(i + 1) % 4];
    const p2 = quad[(i + 2) % 4];
    const cross = (p1.x - p0.x) * (p2.y - p1.y) - (p1.y - p0.y) * (p2.x - p1.x);
    if (Math.abs(cross) < 1e-6) return false;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

function angleDegrees(a: Point2D, b: Point2D, c: Point2D): number {
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const mag1 = Math.hypot(v1x, v1y);
  const mag2 = Math.hypot(v2x, v2y);
  if (mag1 < 1e-6 || mag2 < 1e-6) return 0;
  const cos = clamp((v1x * v2x + v1y * v2y) / (mag1 * mag2), -1, 1);
  return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * Checks whether a normalized quad is convex, covers a reasonable portion of the frame,
 * and avoids degenerate acute spikes (< 28 deg) or near-collinear corners (> 156 deg).
 */
export function hasReasonableQuadAngles(quad: QuadCorners): boolean {
  for (let i = 0; i < 4; i++) {
    const prev = quad[(i + 3) % 4];
    const curr = quad[i];
    const next = quad[(i + 1) % 4];
    const deg = angleDegrees(prev, curr, next);
    if (deg < 28 || deg > 156) return false;
  }
  return true;
}

/**
 * Computes 2D convex hull (Andrew's monotone chain) of normalized points.
 */
function convexHull(points: Point2D[]): Point2D[] {
  if (points.length <= 3) return points;
  const sorted = [...points].sort((a, b) => (a.x !== b.x ? a.x - b.x : a.y - b.y));
  const cross = (o: Point2D, a: Point2D, b: Point2D) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: Point2D[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: Point2D[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

/**
 * Reduces a convex polygon down to 4 vertices by iteratively dropping the vertex
 * whose removal loses the minimum triangle area - accurately recovering true corners
 * at ANY rotation angle (including 35-45 deg rotated ID cards and documents).
 */
function simplifyHullToQuad(hull: Point2D[]): QuadCorners | null {
  if (hull.length < 4) return null;
  const poly = [...hull];

  while (poly.length > 4) {
    let minArea = Infinity;
    let removeIdx = 0;
    const n = poly.length;

    for (let i = 0; i < n; i++) {
      const prev = poly[(i - 1 + n) % n];
      const curr = poly[i];
      const next = poly[(i + 1) % n];
      const area = Math.abs(
        (curr.x - prev.x) * (next.y - prev.y) - (curr.y - prev.y) * (next.x - prev.x)
      );
      if (area < minArea) {
        minArea = area;
        removeIdx = i;
      }
    }
    poly.splice(removeIdx, 1);
  }

  return orderCorners([poly[0], poly[1], poly[2], poly[3]]);
}

/**
 * Extracts a circumscribed quad by merging near-collinear convex hull segments into
 * dominant straight sides, picking the 4 longest non-parallel sides, and intersecting
 * them. This accurately reconstructs sharp corner intersections on rounded-corner
 * ID cards / passports and bridges thumb notches on paper edges.
 */
function extractTangentQuadFromHull(hull: Point2D[]): QuadCorners | null {
  if (hull.length < 4) return null;
  const n = hull.length;

  let cx = 0;
  let cy = 0;
  for (const p of hull) {
    cx += p.x;
    cy += p.y;
  }
  cx /= n;
  cy /= n;

  // Build weighted edges around the hull
  interface HullSeg {
    p: Point2D;
    d: Point2D;
    nx: number;
    ny: number;
    len: number;
    mid: Point2D;
  }

  const segs: HullSeg[] = [];
  for (let i = 0; i < n; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-4) continue;
    const tx = dx / len;
    const ty = dy / len;
    const mid = { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
    let nx = -ty;
    let ny = tx;
    if (nx * (mid.x - cx) + ny * (mid.y - cy) < 0) {
      nx = -nx;
      ny = -ny;
    }
    segs.push({ p: a, d: { x: tx, y: ty }, nx, ny, len, mid });
  }
  if (segs.length < 4) return null;

  // Cluster consecutive collinear segments (angle diff <= 14 deg)
  const cosMerge = Math.cos((14 * Math.PI) / 180);
  const merged: HullSeg[] = [];
  let curGroup: HullSeg[] = [segs[0]];

  const flushGroup = (group: HullSeg[]): HullSeg => {
    if (group.length === 1) return group[0];
    let totalLen = 0;
    let mx = 0;
    let my = 0;
    let dx = 0;
    let dy = 0;
    for (const s of group) {
      totalLen += s.len;
      mx += s.mid.x * s.len;
      my += s.mid.y * s.len;
      dx += s.d.x * s.len;
      dy += s.d.y * s.len;
    }
    const dMag = Math.hypot(dx, dy) || 1;
    const mid = { x: mx / totalLen, y: my / totalLen };
    const tx = dx / dMag;
    const ty = dy / dMag;
    let nx = -ty;
    let ny = tx;
    if (nx * (mid.x - cx) + ny * (mid.y - cy) < 0) {
      nx = -nx;
      ny = -ny;
    }
    return { p: mid, d: { x: tx, y: ty }, nx, ny, len: totalLen, mid };
  };

  for (let i = 1; i < segs.length; i++) {
    const prev = curGroup[curGroup.length - 1];
    const curr = segs[i];
    if (prev.d.x * curr.d.x + prev.d.y * curr.d.y >= cosMerge) {
      curGroup.push(curr);
    } else {
      merged.push(flushGroup(curGroup));
      curGroup = [curr];
    }
  }
  merged.push(flushGroup(curGroup));

  // Merge wrap-around first & last if collinear
  if (merged.length > 4) {
    const first = merged[0];
    const last = merged[merged.length - 1];
    if (first.d.x * last.d.x + first.d.y * last.d.y >= cosMerge) {
      merged[0] = flushGroup([last, first]);
      merged.pop();
    }
  }

  if (merged.length < 4) return null;

  // Pick 4 longest runs with distinct outward normal directions (>= 25 deg apart)
  const cosDistinct = Math.cos((25 * Math.PI) / 180);
  const byLen = [...merged].sort((a, b) => b.len - a.len);
  const picked: HullSeg[] = [];
  for (const cand of byLen) {
    const tooClose = picked.some((p) => p.nx * cand.nx + p.ny * cand.ny > cosDistinct);
    if (!tooClose) {
      picked.push(cand);
      if (picked.length === 4) break;
    }
  }
  if (picked.length < 4) return null;

  // Order cyclically around centroid by outward normal angle
  picked.sort((a, b) => Math.atan2(a.ny, a.nx) - Math.atan2(b.ny, b.nx));

  const corners: Point2D[] = [];
  for (let i = 0; i < 4; i++) {
    const s1 = picked[i];
    const s2 = picked[(i + 1) % 4];
    const pt = intersectLines(s1.p, s1.d, s2.p, s2.d);
    if (!pt || pt.x < -0.15 || pt.x > 1.15 || pt.y < -0.15 || pt.y > 1.15) {
      return null;
    }
    corners.push({
      x: clamp(pt.x, 0.005, 0.995),
      y: clamp(pt.y, 0.005, 0.995),
    });
  }

  const ordered = orderCorners([corners[0], corners[1], corners[2], corners[3]]);
  if (!isValidDocumentQuad(ordered) || !hasReasonableQuadAngles(ordered)) {
    return null;
  }
  return ordered;
}

/**
 * Applies a 3x3 binary morphological closing (dilate then erode) inside interior bounds
 * to heal dark text, barcodes, headers, and thin creases without expanding across outer edges.
 */
function morphClose3x3(src: Uint8Array, width: number, height: number): Uint8Array {
  const total = width * height;
  const dilated = new Uint8Array(total);
  for (let y = 1; y < height - 1; y++) {
    const rowOff = y * width;
    for (let x = 1; x < width - 1; x++) {
      const idx = rowOff + x;
      if (
        src[idx] ||
        src[idx - 1] ||
        src[idx + 1] ||
        src[idx - width] ||
        src[idx + width] ||
        src[idx - width - 1] ||
        src[idx - width + 1] ||
        src[idx + width - 1] ||
        src[idx + width + 1]
      ) {
        dilated[idx] = 1;
      }
    }
  }

  const eroded = new Uint8Array(total);
  for (let y = 1; y < height - 1; y++) {
    const rowOff = y * width;
    for (let x = 1; x < width - 1; x++) {
      const idx = rowOff + x;
      if (
        dilated[idx] &&
        dilated[idx - 1] &&
        dilated[idx + 1] &&
        dilated[idx - width] &&
        dilated[idx + width] &&
        dilated[idx - width - 1] &&
        dilated[idx - width + 1] &&
        dilated[idx + width - 1] &&
        dilated[idx + width + 1]
      ) {
        eroded[idx] = 1;
      }
    }
  }
  return eroded;
}

/**
 * Topological hole fill: any background (0) pixel that cannot reach the 1px image border
 * is completely enclosed inside a foreground object (e.g. dark ID portrait photo, header strip,
 * barcode, or dark illustration on a colorful book cover) and is flipped to 1.
 * Leaves outer perimeters untouched to preserve exact corners.
 */
function fillEnclosedHoles(mask: Uint8Array, width: number, height: number): Uint8Array {
  const total = width * height;
  const exterior = new Uint8Array(total);
  const q = new Int32Array(total);
  let head = 0;
  let tail = 0;

  const enqueue = (idx: number) => {
    if (mask[idx] === 0 && exterior[idx] === 0) {
      exterior[idx] = 1;
      q[tail++] = idx;
    }
  };

  for (let x = 0; x < width; x++) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y++) {
    enqueue(y * width);
    enqueue(y * width + (width - 1));
  }

  while (head < tail) {
    const idx = q[head++];
    const px = idx % width;
    const py = (idx - px) / width;
    if (px > 0) enqueue(idx - 1);
    if (px < width - 1) enqueue(idx + 1);
    if (py > 0) enqueue(idx - width);
    if (py < height - 1) enqueue(idx + width);
  }

  const out = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    out[i] = exterior[i] ? 0 : 1;
  }
  return out;
}

/**
 * Shared connected-component + morphological hole-fill + convex-hull 4-corner extractor
 * from a foreground binary mask `fg`.
 */
function extractQuadsFromMask(
  fg: Uint8Array,
  width: number,
  height: number
): QuadCorners[] {
  const total = width * height;
  const closed = morphClose3x3(fg, width, height);
  const filled = fillEnclosedHoles(closed, width, height);

  // Connected component labeling (BFS) biased toward the central document sheet
  const labels = new Int32Array(total);
  let bestCompPts: number[] = [];
  let bestCompScore = -1;
  const queue = new Int32Array(total);
  let currentLabel = 0;
  const cx = width * 0.5;
  const cy = height * 0.5;

  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      const startIdx = y * width + x;
      if (filled[startIdx] !== 1 || labels[startIdx] !== 0) continue;

      currentLabel++;
      let qHead = 0;
      let qTail = 0;
      queue[qTail++] = startIdx;
      labels[startIdx] = currentLabel;

      const compIndices: number[] = [];
      let sumX = 0;
      let sumY = 0;
      let borderTouches = 0;

      while (qHead < qTail) {
        const idx = queue[qHead++];
        compIndices.push(idx);
        const px = idx % width;
        const py = (idx - px) / width;
        sumX += px;
        sumY += py;
        if (px <= 2 || px >= width - 3 || py <= 2 || py >= height - 3) {
          borderTouches++;
        }

        const n1 = idx - 1;
        const n2 = idx + 1;
        const n3 = idx - width;
        const n4 = idx + width;
        if (px > 1 && filled[n1] === 1 && labels[n1] === 0) {
          labels[n1] = currentLabel;
          queue[qTail++] = n1;
        }
        if (px < width - 2 && filled[n2] === 1 && labels[n2] === 0) {
          labels[n2] = currentLabel;
          queue[qTail++] = n2;
        }
        if (py > 1 && filled[n3] === 1 && labels[n3] === 0) {
          labels[n3] = currentLabel;
          queue[qTail++] = n3;
        }
        if (py < height - 2 && filled[n4] === 1 && labels[n4] === 0) {
          labels[n4] = currentLabel;
          queue[qTail++] = n4;
        }
      }

      const areaFrac = compIndices.length / total;
      if (areaFrac < 0.035 || areaFrac > 0.96) continue;

      const meanX = sumX / compIndices.length;
      const meanY = sumY / compIndices.length;
      const distCenter = Math.hypot((meanX - cx) / width, (meanY - cy) / height);
      const borderPenalty = borderTouches > compIndices.length * 0.035 ? 0.52 : 1.0;
      const score = (areaFrac * borderPenalty) / (0.16 + distCenter);

      if (score > bestCompScore) {
        bestCompScore = score;
        bestCompPts = compIndices;
      }
    }
  }

  if (bestCompPts.length < 30) {
    return [];
  }

  const boundaryPts: Point2D[] = [];
  for (const idx of bestCompPts) {
    const px = idx % width;
    const py = (idx - px) / width;
    if (
      px <= 1 ||
      px >= width - 2 ||
      py <= 1 ||
      py >= height - 2 ||
      !filled[idx - 1] ||
      !filled[idx + 1] ||
      !filled[idx - width] ||
      !filled[idx + width]
    ) {
      boundaryPts.push({ x: px / width, y: py / height });
    }
  }

  if (boundaryPts.length < 12) return [];

  const hull = convexHull(boundaryPts);
  const out: QuadCorners[] = [];
  const tangentQuad = extractTangentQuadFromHull(hull);
  if (tangentQuad) out.push(tangentQuad);
  const simpQuad = simplifyHullToQuad(hull);
  if (simpQuad && isValidDocumentQuad(simpQuad) && hasReasonableQuadAngles(simpQuad)) {
    out.push(simpQuad);
  }
  return out;
}

interface EdgeFeatureBuffers {
  width: number;
  height: number;
  sr: Float32Array;
  sg: Float32Array;
  sb: Float32Array;
  gx: Float32Array;
  gy: Float32Array;
  grad: Float32Array;
  meanGrad: number;
  baseGrad: number;
  bgPalette?: Array<[number, number, number]>;
}

/**
 * Computes the 65th-percentile gradient magnitude via a fast 128-bin histogram.
 * Unlike meanGrad, this is immune to dense handwritten notes or printed tables inflating
 * edge thresholds across the whole image.
 */
function computePercentileGrad(grad: Float32Array, percentile = 0.65): number {
  const bins = new Int32Array(128);
  const n = grad.length;
  for (let i = 0; i < n; i++) {
    const b = Math.min(127, grad[i] >> 2);
    bins[b]++;
  }
  const target = n * percentile;
  let acc = 0;
  for (let b = 0; b < 128; b++) {
    acc += bins[b];
    if (acc >= target) return (b + 0.5) * 4;
  }
  return 16;
}

function sampleColorDist(
  buf: EdgeFeatureBuffers,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const { width, height, sr, sg, sb } = buf;
  const ix1 = clamp(Math.round(x1), 0, width - 1);
  const iy1 = clamp(Math.round(y1), 0, height - 1);
  const ix2 = clamp(Math.round(x2), 0, width - 1);
  const iy2 = clamp(Math.round(y2), 0, height - 1);
  const i1 = iy1 * width + ix1;
  const i2 = iy2 * width + ix2;
  return Math.hypot(sr[i1] - sr[i2], sg[i1] - sg[i2], sb[i1] - sb[i2]);
}

function minPaletteDistAt(
  buf: EdgeFeatureBuffers,
  x: number,
  y: number,
  palette: Array<[number, number, number]>
): number {
  const { width, height, sr, sg, sb } = buf;
  const ix = clamp(Math.round(x), 0, width - 1);
  const iy = clamp(Math.round(y), 0, height - 1);
  const idx = iy * width + ix;
  const r = sr[idx];
  const g = sg[idx];
  const b = sb[idx];
  let best = Infinity;
  for (let k = 0; k < palette.length; k++) {
    const p = palette[k];
    const d = Math.hypot(r - p[0], g - p[1], b - p[2]);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Intersects two 2D lines defined by point+direction: (p1 + t*d1) and (p2 + u*d2).
 */
function intersectLines(
  p1: Point2D,
  d1: Point2D,
  p2: Point2D,
  d2: Point2D
): Point2D | null {
  const det = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(det) < 1e-6) return null;
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const t = (dx * d2.y - dy * d2.x) / det;
  return {
    x: p1.x + t * d1.x,
    y: p1.y + t * d1.y,
  };
}

/**
 * Refines each of the 4 quad edges by scanning a perpendicular band for aligned
 * gradient peaks + inside-vs-outside color contrast, fitting 4 straight lines via
 * 2-pass Iteratively Reweighted Least Squares (IRLS), and intersecting them to get
 * razor-sharp projective corners even with rounded corners or finger/shadow occlusions.
 */
function refineQuadWithEdgeLines(quad: QuadCorners, buf: EdgeFeatureBuffers): QuadCorners | null {
  const { width, height, gx, gy, grad, meanGrad } = buf;
  const centerX = ((quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4) * width;
  const centerY = ((quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4) * height;
  const band = clamp(Math.round(Math.min(width, height) * 0.085), 5, 20);
  const minSignal = Math.max(18, meanGrad * 1.15);

  const lines: Array<{ p: Point2D; d: Point2D }> = [];

  for (let edgeIdx = 0; edgeIdx < 4; edgeIdx++) {
    const pA = { x: quad[edgeIdx].x * width, y: quad[edgeIdx].y * height };
    const pB = {
      x: quad[(edgeIdx + 1) % 4].x * width,
      y: quad[(edgeIdx + 1) % 4].y * height,
    };
    const edgeDx = pB.x - pA.x;
    const edgeDy = pB.y - pA.y;
    const edgeLen = Math.hypot(edgeDx, edgeDy);
    if (edgeLen < 12) return null;

    const tx = edgeDx / edgeLen;
    const ty = edgeDy / edgeLen;
    let nx = -ty;
    let ny = tx;
    const midX = (pA.x + pB.x) * 0.5;
    const midY = (pA.y + pB.y) * 0.5;
    if (nx * (midX - centerX) + ny * (midY - centerY) < 0) {
      nx = -nx;
      ny = -ny;
    }

    const samples: Array<{ u: number; s: number; w: number }> = [];
    const steps = 24;
    for (let k = 0; k < steps; k++) {
      const t = 0.08 + (0.84 * k) / (steps - 1);
      const sx0 = pA.x + edgeDx * t;
      const sy0 = pA.y + edgeDy * t;

      let bestS = 0;
      let bestScore = -1;

      for (let s = -band; s <= band; s++) {
        const px = Math.round(sx0 + nx * s);
        const py = Math.round(sy0 + ny * s);
        if (px < 1 || px >= width - 1 || py < 1 || py >= height - 1) continue;
        const idx = py * width + px;
        const aligned = Math.abs(gx[idx] * nx + gy[idx] * ny);
        if (aligned < minSignal && grad[idx] < minSignal) continue;

        const stepContrast = sampleColorDist(
          buf,
          px - nx * 3,
          py - ny * 3,
          px + nx * 3,
          py + ny * 3
        );
        const distPenalty = 1 - 0.12 * (Math.abs(s) / band);
        const score = (aligned * 0.65 + grad[idx] * 0.25 + stepContrast * 0.75) * distPenalty;
        if (score > bestScore) {
          bestScore = score;
          bestS = s;
        }
      }

      if (bestScore > minSignal * 0.9) {
        samples.push({ u: (t - 0.5) * edgeLen, s: bestS, w: bestScore });
      }
    }

    if (samples.length < 7) {
      lines.push({ p: pA, d: { x: tx, y: ty } });
      continue;
    }

    // 3-pass outlier-resistant IRLS line fit: s(u) = intercept + slope * u
    let intercept = 0;
    let slope = 0;
    for (let iter = 0; iter < 3; iter++) {
      let sw = 0;
      let su = 0;
      let ss = 0;
      let suu = 0;
      let sus = 0;
      for (const pt of samples) {
        let weight = pt.w;
        if (iter > 0) {
          const resid = Math.abs(pt.s - (intercept + slope * pt.u));
          const rNorm = resid / 1.45;
          weight = pt.w / (1 + rNorm * rNorm * rNorm * rNorm);
        }
        sw += weight;
        su += weight * pt.u;
        ss += weight * pt.s;
        suu += weight * pt.u * pt.u;
        sus += weight * pt.u * pt.s;
      }
      const denom = sw * suu - su * su;
      if (Math.abs(denom) > 1e-5 && sw > 1e-5) {
        const nextSlope = (sw * sus - su * ss) / denom;
        const nextIntercept = (ss - nextSlope * su) / sw;
        // Guard against wild slope divergence (> ~19 deg tilt per edge)
        if (Math.abs(nextSlope) < 0.35 && Math.abs(nextIntercept) <= band) {
          slope = nextSlope;
          intercept = nextIntercept;
        }
      }
    }

    const refP = {
      x: midX + nx * intercept,
      y: midY + ny * intercept,
    };
    const dirRawX = tx + nx * slope;
    const dirRawY = ty + ny * slope;
    const dirMag = Math.hypot(dirRawX, dirRawY) || 1;
    lines.push({
      p: refP,
      d: { x: dirRawX / dirMag, y: dirRawY / dirMag },
    });
  }

  if (lines.length !== 4) return null;
  const c0 = intersectLines(lines[3].p, lines[3].d, lines[0].p, lines[0].d);
  const c1 = intersectLines(lines[0].p, lines[0].d, lines[1].p, lines[1].d);
  const c2 = intersectLines(lines[1].p, lines[1].d, lines[2].p, lines[2].d);
  const c3 = intersectLines(lines[2].p, lines[2].d, lines[3].p, lines[3].d);
  if (!c0 || !c1 || !c2 || !c3) return null;

  const normQuad = orderCorners([
    { x: clamp(c0.x / width, 0.006, 0.994), y: clamp(c0.y / height, 0.006, 0.994) },
    { x: clamp(c1.x / width, 0.006, 0.994), y: clamp(c1.y / height, 0.006, 0.994) },
    { x: clamp(c2.x / width, 0.006, 0.994), y: clamp(c2.y / height, 0.006, 0.994) },
    { x: clamp(c3.x / width, 0.006, 0.994), y: clamp(c3.y / height, 0.006, 0.994) },
  ]);

  if (!isValidDocumentQuad(normQuad) || !hasReasonableQuadAngles(normQuad)) {
    return null;
  }
  return normQuad;
}

/**
 * Generates an edge-contour candidate via centroid-outward radial boundary rays.
 * Especially effective on low-contrast white-on-offwhite or shadowed scenes where
 * global thresholding struggles.
 */
function detectRadialEdgeQuads(buf: EdgeFeatureBuffers): QuadCorners[] {
  const { width, height, gx, gy, grad, baseGrad } = buf;
  const cx = width * 0.5;
  const cy = height * 0.5;
  const numRays = 48;
  const minR = Math.min(width, height) * 0.14;
  const maxR = Math.hypot(width * 0.5, height * 0.5) * 0.95;
  const hitThreshold = Math.max(20, baseGrad * 1.55);
  const pts: Point2D[] = [];

  for (let k = 0; k < numRays; k++) {
    const theta = (k / numRays) * Math.PI * 2;
    const rx = Math.cos(theta);
    const ry = Math.sin(theta);

    let bestScore = -1;
    let bestPt: Point2D | null = null;

    for (let r = minR; r <= maxR; r += 1.5) {
      const px = cx + rx * r;
      const py = cy + ry * r;
      const ix = Math.round(px);
      const iy = Math.round(py);
      if (ix < 2 || ix >= width - 2 || iy < 2 || iy >= height - 2) break;

      const idx = iy * width + ix;
      const aligned = Math.abs(gx[idx] * rx + gy[idx] * ry);
      const g = Math.max(aligned, grad[idx] * 0.65);
      if (g < hitThreshold) continue;

      // Persistent cross-edge separation at BOTH +-4px and +-8px skips thin pen lines & table borders
      const cNear = sampleColorDist(buf, px - rx * 4, py - ry * 4, px + rx * 4, py + ry * 4);
      const cWide = sampleColorDist(buf, px - rx * 8, py - ry * 8, px + rx * 8, py + ry * 8);
      const contrast = Math.min(cNear, cWide);
      if (contrast < 14 && aligned < hitThreshold * 1.8) continue;

      // Penalize hugging outer 2.5% image frame border unless signal is unmistakable
      const margin = Math.max(3, Math.min(width, height) * 0.025);
      const nearFrameEdge = px < margin || py < margin || px > width - margin || py > height - margin;
      const frameWeight = nearFrameEdge ? 0.52 : 1.0;
      const score = (aligned * 0.55 + contrast * 1.05) * frameWeight;
      if (score > bestScore) {
        bestScore = score;
        bestPt = { x: px / width, y: py / height };
      }
    }

    if (bestPt) pts.push(bestPt);
  }

  if (pts.length < 12) return [];
  const hull = convexHull(pts);
  const out: QuadCorners[] = [];
  const tangent = extractTangentQuadFromHull(hull);
  if (tangent) out.push(tangent);
  const quad = simplifyHullToQuad(hull);
  if (quad && isValidDocumentQuad(quad) && hasReasonableQuadAngles(quad)) {
    out.push(quad);
  }
  return out;
}

/**
 * Generates sheet candidates via central 4-connected region growing gated by BOTH
 * paper color similarity and local boundary gradient barriers. Stops cleanly at shadowed
 * paper edges even when sunlit glare outside the sheet matches paper luminance.
 */
function detectCentralRegionGrowQuads(
  buf: EdgeFeatureBuffers,
  cR: number,
  cG: number,
  cB: number
): QuadCorners[] {
  const { width, height, sr, sg, sb, grad, baseGrad } = buf;
  const total = width * height;
  const gradGate = Math.max(24, baseGrad * 2.1);
  const seedX = Math.floor(width * 0.5);
  const seedY = Math.floor(height * 0.5);
  const seedIdx = seedY * width + seedX;
  const out: QuadCorners[] = [];

  for (const [stepTol, globalTol] of [
    [14, 52],
    [20, 68],
  ]) {
    const visited = new Uint8Array(total);
    const mask = new Uint8Array(total);
    const queue = new Int32Array(total);
    let qHead = 0;
    let qTail = 0;

    visited[seedIdx] = 1;
    mask[seedIdx] = 1;
    queue[qTail++] = seedIdx;

    while (qHead < qTail) {
      const idx = queue[qHead++];
      const px = idx % width;
      const py = (idx - px) / width;

      const neighbors = [
        px > 1 ? idx - 1 : -1,
        px < width - 2 ? idx + 1 : -1,
        py > 1 ? idx - width : -1,
        py < height - 2 ? idx + width : -1,
      ];

      for (const nIdx of neighbors) {
        if (nIdx < 0 || visited[nIdx]) continue;
        visited[nIdx] = 1;

        const dStep = Math.hypot(sr[nIdx] - sr[idx], sg[nIdx] - sg[idx], sb[nIdx] - sb[idx]);
        const dGlobal = Math.hypot(sr[nIdx] - cR, sg[nIdx] - cG, sb[nIdx] - cB);
        if (dGlobal > globalTol) continue;

        // Smooth lighting gradients glide through (dStep tiny); sharp desk/shadow boundaries halt cleanly
        if (grad[nIdx] >= gradGate && dStep > stepTol) continue;

        mask[nIdx] = 1;
        queue[qTail++] = nIdx;
      }
    }

    if (qTail > total * 0.06 && qTail < total * 0.94) {
      out.push(...extractQuadsFromMask(mask, width, height));
    }
  }

  return out;
}

/**
 * Scores a candidate document quad objectively using:
 * 1. Aligned gradient energy along all 4 edges,
 * 2. Edge continuity (% of edge perimeter supported by edge gradient),
 * 3. Inside-vs-outside color separation across each edge (rejects interior table grids),
 * 4. Geometric centrality & area sanity.
 */
function scoreQuadCandidate(
  quad: QuadCorners,
  buf: EdgeFeatureBuffers
): { score: number; edgeSupport: number; sideMinSupport: number; sideMinContrast: number } {
  if (!isValidDocumentQuad(quad) || !hasReasonableQuadAngles(quad)) {
    return { score: -1, edgeSupport: 0, sideMinSupport: 0, sideMinContrast: 0 };
  }

  const { width, height, gx, gy, grad, baseGrad } = buf;
  const centerX = ((quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4) * width;
  const centerY = ((quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4) * height;
  const thresh = Math.max(16, baseGrad * 1.25);

  let totalEdgeEnergy = 0;
  let totalContrast = 0;
  let strongStations = 0;
  let outsideNoiseSum = 0;
  let outsideBgHits = 0;
  let nonBorderStations = 0;
  const palette = buf.bgPalette;
  const samplesPerEdge = 18;
  const totalStations = samplesPerEdge * 4;
  let sideMinContrast = Infinity;
  let sideMinSupport = 1;
  let borderEdgeCount = 0;

  for (let e = 0; e < 4; e++) {
    const a = { x: quad[e].x * width, y: quad[e].y * height };
    const b = { x: quad[(e + 1) % 4].x * width, y: quad[(e + 1) % 4].y * height };
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    let nx = -dy / len;
    let ny = dx / len;
    const mx = (a.x + b.x) * 0.5;
    const my = (a.y + b.y) * 0.5;
    if (nx * (mx - centerX) + ny * (my - centerY) < 0) {
      nx = -nx;
      ny = -ny;
    }

    const bMargin = Math.max(3, Math.min(width, height) * 0.025);
    const edgeOnBorder =
      (a.x < bMargin && b.x < bMargin) ||
      (a.x > width - bMargin && b.x > width - bMargin) ||
      (a.y < bMargin && b.y < bMargin) ||
      (a.y > height - bMargin && b.y > height - bMargin);
    if (edgeOnBorder) borderEdgeCount++;

    let sideContrastSum = 0;
    let sideStrong = 0;
    for (let k = 0; k < samplesPerEdge; k++) {
      const t = 0.08 + (0.84 * k) / (samplesPerEdge - 1);
      const px = a.x + dx * t;
      const py = a.y + dy * t;

      // Best aligned edge within ±2px
      let peakG = 0;
      for (let off = -2; off <= 2; off++) {
        const ix = clamp(Math.round(px + nx * off), 1, width - 2);
        const iy = clamp(Math.round(py + ny * off), 1, height - 2);
        const idx = iy * width + ix;
        const aligned = Math.abs(gx[idx] * nx + gy[idx] * ny);
        const g = aligned * 0.78 + grad[idx] * 0.22;
        if (g > peakG) peakG = g;
      }

      // Persistent inside-vs-outside color separation at BOTH +-4px and +-8px rejects interior ink/text lines
      let contrast = 0;
      if (!edgeOnBorder) {
        const cMid = sampleColorDist(buf, px - nx * 4, py - ny * 4, px + nx * 4, py + ny * 4);
        const cWide = sampleColorDist(buf, px - nx * 8, py - ny * 8, px + nx * 8, py + ny * 8);
        contrast = Math.min(cMid, cWide);

        // True outer perimeter sits beside quiet background; inner text boxes sit beside noisy print
        const outStability = sampleColorDist(
          buf,
          px + nx * 4,
          py + ny * 4,
          px + nx * 11,
          py + ny * 11
        );
        outsideNoiseSum += outStability;

        // Check whether outside strip actually belongs to outer desk/border palette (prevents clipping book art bands)
        if (palette && palette.length > 0) {
          const dOutNear = minPaletteDistAt(buf, px + nx * 6, py + ny * 6, palette);
          const dOutFar = minPaletteDistAt(buf, px + nx * 11, py + ny * 11, palette);
          if (Math.min(dOutNear, dOutFar) <= 52) {
            outsideBgHits++;
          }
        }
        nonBorderStations++;
      }
      totalEdgeEnergy += contrast >= 10 ? peakG : peakG * 0.2;
      totalContrast += contrast;
      sideContrastSum += contrast;
      if (contrast >= 14 && (peakG >= thresh || contrast >= 22)) {
        strongStations++;
        sideStrong++;
      }
    }
    sideMinContrast = Math.min(sideMinContrast, sideContrastSum / samplesPerEdge);
    sideMinSupport = Math.min(sideMinSupport, sideStrong / samplesPerEdge);
  }

  const edgeSupport = strongStations / totalStations;
  const avgEnergy = totalEdgeEnergy / totalStations;
  const avgContrast = totalContrast / totalStations;
  const avgOutNoise = nonBorderStations > 0 ? outsideNoiseSum / nonBorderStations : 0;
  const outsideQuietBonus = clamp(1.12 - avgOutNoise / 90, 0.72, 1.12);
  const bgConsistencyFactor =
    palette && palette.length > 0 && palette.length <= 5 && nonBorderStations >= 8
      ? clamp(0.42 + 0.68 * (outsideBgHits / nonBorderStations), 0.42, 1.1)
      : 1.0;
  const area = quadArea(quad);
  const areaScore =
    area >= 0.14 && area <= 0.88
      ? 1.0 + area * 0.12
      : area >= 0.05 && area < 0.14
        ? 0.82
        : area < 0.05
          ? 0.68
          : 0.84;
  const distCenter = Math.hypot(centerX / width - 0.5, centerY / height - 0.5);
  const centerBonus = 1 / (0.85 + distCenter);
  const fourSideBalance =
    clamp(sideMinContrast / 16, 0.22, 1.15) * clamp(sideMinSupport / 0.35, 0.22, 1.05);
  const borderPenalty = borderEdgeCount > 0 ? Math.pow(0.72, borderEdgeCount) : 1.0;
  // Gentle perspective symmetry consistency (opposite page edges tend to be roughly parallel)
  const topDx = quad[1].x - quad[0].x;
  const topDy = quad[1].y - quad[0].y;
  const botDx = quad[2].x - quad[3].x;
  const botDy = quad[2].y - quad[3].y;
  const leftDx = quad[3].x - quad[0].x;
  const leftDy = quad[3].y - quad[0].y;
  const rightDx = quad[2].x - quad[1].x;
  const rightDy = quad[2].y - quad[1].y;
  const cosTB =
    (topDx * botDx + topDy * botDy) /
    Math.max(1e-5, Math.hypot(topDx, topDy) * Math.hypot(botDx, botDy));
  const cosLR =
    (leftDx * rightDx + leftDy * rightDy) /
    Math.max(1e-5, Math.hypot(leftDx, leftDy) * Math.hypot(rightDx, rightDy));
  const perspectiveFactor = clamp(0.84 + 0.16 * Math.min(cosTB, cosLR), 0.72, 1.02);

  const score =
    (avgEnergy * 0.55 + avgContrast * 0.78) *
    (0.35 + 0.65 * edgeSupport) *
    areaScore *
    centerBonus *
    outsideQuietBonus *
    bgConsistencyFactor *
    fourSideBalance *
    borderPenalty *
    perspectiveFactor;

  return { score, edgeSupport, sideMinSupport, sideMinContrast };
}

export interface DetectedQuadResult {
  quad: QuadCorners;
  confidence: number;
  edgeSupport: number;
}

/**
 * Returns true if a quadrilateral covers the full image frame (within a small tolerance).
 * When true, document dewarp should be bypassed to avoid any cropping, homography interpolation,
 * or pixel clipping.
 */
export function isFullFrameQuad(quad: QuadCorners, tolerance = 0.03): boolean {
  return (
    quad[0].x <= tolerance &&
    quad[0].y <= tolerance &&
    quad[1].x >= 1 - tolerance &&
    quad[1].y <= tolerance &&
    quad[2].x >= 1 - tolerance &&
    quad[2].y >= 1 - tolerance &&
    quad[3].x <= tolerance &&
    quad[3].y >= 1 - tolerance
  );
}

/**
 * Computes temporal EMA corner smoothing for live camera tracking overlay.
 */
export function smoothQuadCorners(
  prev: QuadCorners | null,
  next: QuadCorners,
  alpha = 0.42
): QuadCorners {
  if (!prev) return next;
  const a = clamp(alpha, 0.1, 1);
  return [
    { x: prev[0].x + (next[0].x - prev[0].x) * a, y: prev[0].y + (next[0].y - prev[0].y) * a },
    { x: prev[1].x + (next[1].x - prev[1].x) * a, y: prev[1].y + (next[1].y - prev[1].y) * a },
    { x: prev[2].x + (next[2].x - prev[2].x) * a, y: prev[2].y + (next[2].y - prev[2].y) * a },
    { x: prev[3].x + (next[3].x - prev[3].x) * a, y: prev[3].y + (next[3].y - prev[3].y) * a },
  ];
}

/**
 * Returns true if all 4 corners of two quads are within `maxDelta` normalized distance.
 */
export function quadsAreClose(a: QuadCorners, b: QuadCorners, maxDelta = 0.018): boolean {
  for (let i = 0; i < 4; i++) {
    if (Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y) > maxDelta) return false;
  }
  return true;
}

export type ScanCornerHint = 'auto' | 'docs' | 'id_card' | 'book';

export function expandQuadMargin(quad: QuadCorners, fraction: number): QuadCorners {
  if (fraction <= 0) return quad;
  const cx = (quad[0].x + quad[1].x + quad[2].x + quad[3].x) * 0.25;
  const cy = (quad[0].y + quad[1].y + quad[2].y + quad[3].y) * 0.25;
  const factor = 1 + fraction;
  return [
    { x: clamp(cx + (quad[0].x - cx) * factor, 0.006, 0.994), y: clamp(cy + (quad[0].y - cy) * factor, 0.006, 0.994) },
    { x: clamp(cx + (quad[1].x - cx) * factor, 0.006, 0.994), y: clamp(cy + (quad[1].y - cy) * factor, 0.006, 0.994) },
    { x: clamp(cx + (quad[2].x - cx) * factor, 0.006, 0.994), y: clamp(cy + (quad[2].y - cy) * factor, 0.006, 0.994) },
    { x: clamp(cx + (quad[3].x - cx) * factor, 0.006, 0.994), y: clamp(cy + (quad[3].y - cy) * factor, 0.006, 0.994) },
  ];
}

function selectBestQuadCandidate(
  candidates: QuadCorners[],
  buf: EdgeFeatureBuffers,
  fallbackQuad: QuadCorners,
  scanHint: ScanCornerHint = 'docs'
): DetectedQuadResult {
  const expanded: QuadCorners[] = [];
  for (const c of candidates) {
    expanded.push(c);
    const refined = refineQuadWithEdgeLines(c, buf);
    if (refined) expanded.push(refined);
  }

  let bestQuad = fallbackQuad;
  let bestScore = -1;
  let bestSupport = 0;
  let bestSideMinSupport = 0;

  for (const c of expanded) {
    const { score, edgeSupport, sideMinSupport } = scoreQuadCandidate(c, buf);
    if (score > bestScore) {
      bestScore = score;
      bestQuad = c;
      bestSupport = edgeSupport;
      bestSideMinSupport = sideMinSupport;
    }
  }

  // If even the best candidate has poor score or lacks edge support on any side, fall back
  if (bestScore < 12 || bestSupport < 0.24 || bestSideMinSupport < 0.15) {
    return { quad: fallbackQuad, confidence: 0.08, edgeSupport: bestSupport };
  }

  // Soft outer bevel relief for ID cards so rounded borders and corner numbers are never hard-clipped
  if (scanHint === 'id_card') {
    const softened = expandQuadMargin(bestQuad, 0.018);
    if (isValidDocumentQuad(softened) && hasReasonableQuadAngles(softened)) {
      bestQuad = softened;
    }
  }

  // Multi-factor confidence calculation requiring four-side closure:
  // A true document MUST have strong edge support along all 4 perimeter segments.
  const sideClosure = clamp((bestSideMinSupport - 0.16) / 0.44, 0, 1);
  const supportFactor = clamp((bestSupport - 0.25) / 0.50, 0, 1);
  const scoreFactor = clamp((bestScore - 18) / 60, 0, 1);

  // If the weakest side lacks clear edges (< 0.28), penalize confidence severely
  const sidePenalty = bestSideMinSupport < 0.28 ? Math.max(0, bestSideMinSupport / 0.28) : 1.0;

  const confidence = clamp(
    (supportFactor * 0.40 + sideClosure * 0.40 + scoreFactor * 0.20) * sidePenalty,
    0,
    1
  );
  return { quad: bestQuad, confidence, edgeSupport: bestSupport };
}

/**
 * Pure TypeScript computer vision auto-crop detector (Luma path)!
 * Uses Gaussian smoothing, signed Sobel edge vectors, multi-threshold adaptive masks +
 * radial edge-ray detection, 2-pass IRLS line refinement, and objective quad scoring.
 *
 * Returns normalized [0..1] QuadCorners ordered [TL, TR, BR, BL].
 */
export function detectDocumentQuadFromLuma(
  luma: Uint8Array,
  width: number,
  height: number
): QuadCorners {
  const defaultQuad: QuadCorners = [
    { x: 0.08, y: 0.08 },
    { x: 0.92, y: 0.08 },
    { x: 0.92, y: 0.92 },
    { x: 0.08, y: 0.92 },
  ];

  if (width < 24 || height < 24 || luma.length !== width * height) {
    return defaultQuad;
  }

  const total = width * height;

  // 1. 3x3 Gaussian blur
  const blurred = new Float32Array(total);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (y === 0 || y === height - 1 || x === 0 || x === width - 1) {
        blurred[y * width + x] = luma[y * width + x];
        continue;
      }
      const idx = y * width + x;
      blurred[idx] =
        (luma[idx - width - 1] +
          2 * luma[idx - width] +
          luma[idx - width + 1] +
          2 * luma[idx - 1] +
          4 * luma[idx] +
          2 * luma[idx + 1] +
          luma[idx + width - 1] +
          2 * luma[idx + width] +
          luma[idx + width + 1]) /
        16;
    }
  }

  // 2. Signed Sobel gradient vector (gx, gy) + magnitude
  const gxArr = new Float32Array(total);
  const gyArr = new Float32Array(total);
  const grad = new Float32Array(total);
  let sumGrad = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const gx =
        -blurred[idx - width - 1] +
        blurred[idx - width + 1] -
        2 * blurred[idx - 1] +
        2 * blurred[idx + 1] -
        blurred[idx + width - 1] +
        blurred[idx + width + 1];
      const gy =
        -blurred[idx - width - 1] -
        2 * blurred[idx - width] -
        blurred[idx - width + 1] +
        blurred[idx + width - 1] +
        2 * blurred[idx + width] +
        blurred[idx + width + 1];
      gxArr[idx] = gx;
      gyArr[idx] = gy;
      const mag = Math.hypot(gx, gy);
      grad[idx] = mag;
      sumGrad += mag;
    }
  }

  const buf: EdgeFeatureBuffers = {
    width,
    height,
    sr: blurred,
    sg: blurred,
    sb: blurred,
    gx: gxArr,
    gy: gyArr,
    grad,
    meanGrad: sumGrad / Math.max(1, total),
    baseGrad: computePercentileGrad(grad, 0.65),
  };

  // 3. Otsu + local center/border contrast thresholds
  const hist = new Int32Array(256);
  for (let i = 0; i < total; i++) {
    hist[clamp(Math.round(blurred[i]), 0, 255)]++;
  }
  let sumAll = 0;
  for (let t = 0; t < 256; t++) sumAll += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let maxVar = -1;
  let otsuThresh = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const betweenVar = wB * wF * (mB - mF) * (mB - mF);
    if (betweenVar > maxVar) {
      maxVar = betweenVar;
      otsuThresh = t;
    }
  }

  let centerSum = 0;
  let centerCnt = 0;
  for (let y = Math.floor(height * 0.35); y < Math.floor(height * 0.65); y++) {
    for (let x = Math.floor(width * 0.35); x < Math.floor(width * 0.65); x++) {
      centerSum += blurred[y * width + x];
      centerCnt++;
    }
  }
  const centerMean = centerSum / Math.max(1, centerCnt);

  let borderSum = 0;
  let borderCnt = 0;
  for (let x = 0; x < width; x++) {
    borderSum += blurred[x] + blurred[(height - 1) * width + x];
    borderCnt += 2;
  }
  for (let y = 0; y < height; y++) {
    borderSum += blurred[y * width] + blurred[y * width + (width - 1)];
    borderCnt += 2;
  }
  const borderMean = borderSum / Math.max(1, borderCnt);

  const docIsBrighter = centerMean >= borderMean - 5;
  const edgeBarrier = Math.max(28, buf.baseGrad * 2.4);
  const candidates: QuadCorners[] = [];

  const threshList = docIsBrighter
    ? [Math.min(otsuThresh, centerMean * 0.68), (otsuThresh + borderMean) * 0.5]
    : [Math.max(otsuThresh, centerMean * 1.25), (otsuThresh + borderMean) * 0.5];

  for (const th of threshList) {
    const fg = new Uint8Array(total);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        const val = blurred[idx];
        const matchesTone = docIsBrighter ? val >= th : val <= th;
        if (matchesTone && grad[idx] < edgeBarrier) {
          fg[idx] = 1;
        }
      }
    }
    candidates.push(...extractQuadsFromMask(fg, width, height));
  }

  candidates.push(...detectRadialEdgeQuads(buf));

  return selectBestQuadCandidate(candidates, buf, defaultQuad).quad;
}

/**
 * Builds up to 6 diverse RGB palette centroids along the outer 4% border strip so foreground
 * detection works independently of how many vibrant/dark colors appear on a book cover or ID card.
 */
function buildBorderBackgroundPalette(buf: EdgeFeatureBuffers): Array<[number, number, number]> {
  const { width, height, sr, sg, sb } = buf;
  const samples: Array<[number, number, number]> = [];
  const stepX = Math.max(2, Math.floor(width / 24));
  const stepY = Math.max(2, Math.floor(height / 24));
  const insetX = Math.max(2, Math.floor(width * 0.025));
  const insetY = Math.max(2, Math.floor(height * 0.025));

  for (let x = 0; x < width; x += stepX) {
    const iTop = insetY * width + x;
    const iBot = (height - 1 - insetY) * width + x;
    samples.push([sr[iTop], sg[iTop], sb[iTop]]);
    samples.push([sr[iBot], sg[iBot], sb[iBot]]);
  }
  for (let y = 0; y < height; y += stepY) {
    const iLeft = y * width + insetX;
    const iRight = y * width + (width - 1 - insetX);
    samples.push([sr[iLeft], sg[iLeft], sb[iLeft]]);
    samples.push([sr[iRight], sg[iRight], sb[iRight]]);
  }

  const palette: Array<[number, number, number]> = [];
  for (const s of samples) {
    const close = palette.some(
      (p) => Math.hypot(s[0] - p[0], s[1] - p[1], s[2] - p[2]) < 22
    );
    if (!close) {
      palette.push(s);
      if (palette.length >= 6) break;
    }
  }
  return palette;
}

/**
 * Background-palette foreground masks + exterior multi-source flood fill.
 * Because background pixels around the perimeter stop cleanly at the outer edge gradient
 * of ANY book cover or ID card (regardless of multi-colored illustrations, photos, or text),
 * interior colors never split the detected page/card.
 */
function detectByBorderBackgroundModels(buf: EdgeFeatureBuffers): QuadCorners[] {
  const { width, height, sr, sg, sb, grad, baseGrad } = buf;
  const total = width * height;
  const palette = buf.bgPalette ?? buildBorderBackgroundPalette(buf);
  if (palette.length === 0) return [];

  const out: QuadCorners[] = [];

  // Model 1: Color difference from border desk palette (multi-tolerance for glossy & colorful covers)
  for (const bgThresh of [22, 34, 48]) {
    const fg = new Uint8Array(total);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        const r = sr[idx];
        const g = sg[idx];
        const b = sb[idx];
        let minD = Infinity;
        for (let k = 0; k < palette.length; k++) {
          const p = palette[k];
          const d = Math.hypot(r - p[0], g - p[1], b - p[2]);
          if (d < minD) minD = d;
        }
        if (minD > bgThresh) {
          fg[idx] = 1;
        }
      }
    }
    out.push(...extractQuadsFromMask(fg, width, height));
  }

  // Model 2: Exterior inward flood-fill starting from outer 1px border, gated by gradient walls
  const gradWall = Math.max(24, baseGrad * 2.15);
  const bgVisited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  const isBgLike = (idx: number): boolean => {
    const r = sr[idx];
    const g = sg[idx];
    const b = sb[idx];
    for (let k = 0; k < palette.length; k++) {
      const p = palette[k];
      if (Math.hypot(r - p[0], g - p[1], b - p[2]) <= 46) return true;
    }
    return false;
  };

  const seed = (idx: number) => {
    if (!bgVisited[idx] && isBgLike(idx) && grad[idx] < gradWall) {
      bgVisited[idx] = 1;
      queue[tail++] = idx;
    }
  };

  for (let x = 0; x < width; x++) {
    seed(x);
    seed((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y++) {
    seed(y * width);
    seed(y * width + (width - 1));
  }

  while (head < tail) {
    const idx = queue[head++];
    const px = idx % width;
    const py = (idx - px) / width;
    const neighbors = [
      px > 0 ? idx - 1 : -1,
      px < width - 1 ? idx + 1 : -1,
      py > 0 ? idx - width : -1,
      py < height - 1 ? idx + width : -1,
    ];
    for (const nIdx of neighbors) {
      if (nIdx < 0 || bgVisited[nIdx]) continue;
      if (grad[nIdx] >= gradWall) continue;
      const dStep = Math.hypot(sr[nIdx] - sr[idx], sg[nIdx] - sg[idx], sb[nIdx] - sb[idx]);
      if (dStep > 16 || !isBgLike(nIdx)) continue;
      bgVisited[nIdx] = 1;
      queue[tail++] = nIdx;
    }
  }

  const fgCount = total - tail;
  if (fgCount > total * 0.035 && fgCount < total * 0.94) {
    const fgFlood = new Uint8Array(total);
    for (let i = 0; i < total; i++) {
      fgFlood[i] = bgVisited[i] ? 0 : 1;
    }
    out.push(...extractQuadsFromMask(fgFlood, width, height));
  }

  return out;
}

/**
 * Multi-channel RGB color + luma + border-palette + radial-edge + straight-line IRLS auto-crop detector!
 * Handles white documents, colored ID cards, multi-colored book covers, white-on-offwhite, shadows, and textured desks.
 */
export function detectDocumentQuadDetailed(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  options?: { scanHint?: ScanCornerHint }
): DetectedQuadResult {
  const defaultQuad: QuadCorners = [
    { x: 0.06, y: 0.06 },
    { x: 0.94, y: 0.06 },
    { x: 0.94, y: 0.94 },
    { x: 0.06, y: 0.94 },
  ];
  const total = width * height;
  if (width < 24 || height < 24 || rgba.length < total * 4) {
    return { quad: defaultQuad, confidence: 0, edgeSupport: 0 };
  }

  const rArr = new Float32Array(total);
  const gArr = new Float32Array(total);
  const bArr = new Float32Array(total);
  const luma = new Uint8Array(total);

  for (let i = 0, j = 0; j < total; i += 4, j++) {
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    rArr[j] = r;
    gArr[j] = g;
    bArr[j] = b;
    luma[j] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }

  // Smooth RGB channels (3x3 Gaussian)
  const sr = new Float32Array(total);
  const sg = new Float32Array(total);
  const sb = new Float32Array(total);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (y === 0 || y === height - 1 || x === 0 || x === width - 1) {
        sr[idx] = rArr[idx];
        sg[idx] = gArr[idx];
        sb[idx] = bArr[idx];
        continue;
      }
      sr[idx] =
        (rArr[idx - width - 1] +
          2 * rArr[idx - width] +
          rArr[idx - width + 1] +
          2 * rArr[idx - 1] +
          4 * rArr[idx] +
          2 * rArr[idx + 1] +
          rArr[idx + width - 1] +
          2 * rArr[idx + width] +
          rArr[idx + width + 1]) /
        16;
      sg[idx] =
        (gArr[idx - width - 1] +
          2 * gArr[idx - width] +
          gArr[idx - width + 1] +
          2 * gArr[idx - 1] +
          4 * gArr[idx] +
          2 * gArr[idx + 1] +
          gArr[idx + width - 1] +
          2 * gArr[idx + width] +
          gArr[idx + width + 1]) /
        16;
      sb[idx] =
        (bArr[idx - width - 1] +
          2 * bArr[idx - width] +
          bArr[idx - width + 1] +
          2 * bArr[idx - 1] +
          4 * bArr[idx] +
          2 * bArr[idx + 1] +
          bArr[idx + width - 1] +
          2 * bArr[idx + width] +
          bArr[idx + width + 1]) /
        16;
    }
  }

  // Signed multi-channel color Sobel vectors (dominant channel) + magnitude
  const gxDom = new Float32Array(total);
  const gyDom = new Float32Array(total);
  const colorGrad = new Float32Array(total);
  let sumGrad = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const gRx =
        -sr[idx - width - 1] + sr[idx - width + 1] - 2 * sr[idx - 1] + 2 * sr[idx + 1] - sr[idx + width - 1] + sr[idx + width + 1];
      const gRy =
        -sr[idx - width - 1] - 2 * sr[idx - width] - sr[idx - width + 1] + sr[idx + width - 1] + 2 * sr[idx + width] + sr[idx + width + 1];
      const gGx =
        -sg[idx - width - 1] + sg[idx - width + 1] - 2 * sg[idx - 1] + 2 * sg[idx + 1] - sg[idx + width - 1] + sg[idx + width + 1];
      const gGy =
        -sg[idx - width - 1] - 2 * sg[idx - width] - sg[idx - width + 1] + sg[idx + width - 1] + 2 * sg[idx + width] + sg[idx + width + 1];
      const gBx =
        -sb[idx - width - 1] + sb[idx - width + 1] - 2 * sb[idx - 1] + 2 * sb[idx + 1] - sb[idx + width - 1] + sb[idx + width + 1];
      const gBy =
        -sb[idx - width - 1] - 2 * sb[idx - width] - sb[idx - width + 1] + sb[idx + width - 1] + 2 * sb[idx + width] + sb[idx + width + 1];

      const mR = Math.hypot(gRx, gRy);
      const mG = Math.hypot(gGx, gGy);
      const mB = Math.hypot(gBx, gBy);

      if (mR >= mG && mR >= mB) {
        gxDom[idx] = gRx;
        gyDom[idx] = gRy;
        colorGrad[idx] = mR;
      } else if (mG >= mB) {
        gxDom[idx] = gGx;
        gyDom[idx] = gGy;
        colorGrad[idx] = mG;
      } else {
        gxDom[idx] = gBx;
        gyDom[idx] = gBy;
        colorGrad[idx] = mB;
      }
      sumGrad += colorGrad[idx];
    }
  }

  const buf: EdgeFeatureBuffers = {
    width,
    height,
    sr,
    sg,
    sb,
    gx: gxDom,
    gy: gyDom,
    grad: colorGrad,
    meanGrad: sumGrad / Math.max(1, total),
    baseGrad: computePercentileGrad(colorGrad, 0.65),
  };
  buf.bgPalette = buildBorderBackgroundPalette(buf);

  // Sample central sheet RGB vs outer 5% desk border RGB
  let cR = 0,
    cG = 0,
    cB = 0,
    cCnt = 0;
  for (let y = Math.floor(height * 0.36); y < Math.floor(height * 0.64); y++) {
    for (let x = Math.floor(width * 0.36); x < Math.floor(width * 0.64); x++) {
      const idx = y * width + x;
      cR += sr[idx];
      cG += sg[idx];
      cB += sb[idx];
      cCnt++;
    }
  }
  cR /= Math.max(1, cCnt);
  cG /= Math.max(1, cCnt);
  cB /= Math.max(1, cCnt);

  let bR = 0,
    bG = 0,
    bB = 0,
    bCnt = 0;
  const marginX = Math.max(2, Math.floor(width * 0.05));
  const marginY = Math.max(2, Math.floor(height * 0.05));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x < marginX || x >= width - marginX || y < marginY || y >= height - marginY) {
        const idx = y * width + x;
        bR += sr[idx];
        bG += sg[idx];
        bB += sb[idx];
        bCnt++;
      }
    }
  }
  bR /= Math.max(1, bCnt);
  bG /= Math.max(1, bCnt);
  bB /= Math.max(1, bCnt);

  const centerBorderDist = Math.hypot(cR - bR, cG - bG, cB - bB);
  const edgeBarrier = Math.max(30, buf.baseGrad * 2.45);
  const candidates: QuadCorners[] = [];

  // Hypothesis A: Multi-sensitivity RGB color distance segmentation
  if (centerBorderDist > 20) {
    for (const ratio of [0.95, 1.15]) {
      const fgColor = new Uint8Array(total);
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const idx = y * width + x;
          const dCenter = Math.hypot(sr[idx] - cR, sg[idx] - cG, sb[idx] - cB);
          const dBorder = Math.hypot(sr[idx] - bR, sg[idx] - bG, sb[idx] - bB);
          if (dCenter < dBorder * ratio && colorGrad[idx] < edgeBarrier) {
            fgColor[idx] = 1;
          }
        }
      }
      candidates.push(...extractQuadsFromMask(fgColor, width, height));
    }
  }

  // Hypothesis A2: Seeded central region grow (immune to sunlit outer glare / window corners)
  candidates.push(...detectCentralRegionGrowQuads(buf, cR, cG, cB));

  // Hypothesis D: Multi-color border-palette & exterior flood-fill (multi-colored book covers & ID cards)
  candidates.push(...detectByBorderBackgroundModels(buf));

  // Hypothesis B: Illumination-invariant Luma/Otsu candidate
  const lumaQuad = detectDocumentQuadFromLuma(luma, width, height);
  if (isValidDocumentQuad(lumaQuad) && hasReasonableQuadAngles(lumaQuad)) {
    candidates.push(lumaQuad);
  }

  // Hypothesis B2: Shadow-flattened Luma candidate (handles heavy diagonal lamp/hand shadows)
  const flatLuma = buildIlluminationFlattenedLuma(luma, width, height);
  const flatQuad = detectDocumentQuadFromLuma(flatLuma, width, height);
  if (isValidDocumentQuad(flatQuad) && hasReasonableQuadAngles(flatQuad)) {
    candidates.push(flatQuad);
  }

  // Hypothesis C: Centroid-outward radial edge contour finder (low-contrast & shadowed docs)
  candidates.push(...detectRadialEdgeQuads(buf));

  return selectBestQuadCandidate(candidates, buf, defaultQuad, options?.scanHint ?? 'docs');
}

/**
 * Estimates the smooth low-frequency illumination field over a coarse 8x8 grid
 * and divides out gradual cast shadows while preserving sharp page-edge steps.
 */
function buildIlluminationFlattenedLuma(
  luma: Uint8Array,
  width: number,
  height: number
): Uint8Array {
  const gSize = 8;
  const cellW = width / gSize;
  const cellH = height / gSize;
  const grid = new Float32Array(gSize * gSize);

  for (let gy = 0; gy < gSize; gy++) {
    const y0 = Math.floor(gy * cellH);
    const y1 = Math.min(height, Math.ceil((gy + 1) * cellH));
    for (let gx = 0; gx < gSize; gx++) {
      const x0 = Math.floor(gx * cellW);
      const x1 = Math.min(width, Math.ceil((gx + 1) * cellW));
      let sum = 0;
      let cnt = 0;
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          sum += luma[y * width + x];
          cnt++;
        }
      }
      grid[gy * gSize + gx] = Math.max(40, sum / Math.max(1, cnt));
    }
  }

  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const gy = clamp((y / height) * (gSize - 1), 0, gSize - 1.001);
    const y0 = Math.floor(gy);
    const fy = gy - y0;
    for (let x = 0; x < width; x++) {
      const gx = clamp((x / width) * (gSize - 1), 0, gSize - 1.001);
      const x0 = Math.floor(gx);
      const fx = gx - x0;
      const i00 = y0 * gSize + x0;
      const field =
        grid[i00] * (1 - fx) * (1 - fy) +
        grid[i00 + 1] * fx * (1 - fy) +
        grid[i00 + gSize] * (1 - fx) * fy +
        grid[i00 + gSize + 1] * fx * fy;
      const idx = y * width + x;
      out[idx] = clamp(Math.round((luma[idx] / Math.max(40, field)) * 128), 0, 255);
    }
  }
  return out;
}

/**
 * Multi-channel RGB + border-palette + radial-edge + straight-line refined auto-crop detector.
 */
export function detectDocumentQuadFromRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  options?: { scanHint?: ScanCornerHint }
): QuadCorners {
  return detectDocumentQuadDetailed(rgba, width, height, options).quad;
}

export type AutoDetectedScene = 'document' | 'id_card' | 'book_spread' | 'qr_transfer' | 'qr_code';

export function classifyScannedSceneHint(input: {
  qrDetected?: boolean;
  isBsqTransfer?: boolean;
  qrAreaFraction?: number;
  quad?: QuadCorners | null;
  quadConfidence?: number;
  aspectRatio?: number;
}): AutoDetectedScene {
  if (input.isBsqTransfer) {
    return 'qr_transfer';
  }
  if (input.qrDetected && (input.qrAreaFraction ?? 0) >= 0.035) {
    return 'qr_code';
  }

  if (input.quad && (input.quadConfidence ?? 1) >= 0.22) {
    const [tl, tr, br, bl] = input.quad;
    const avgW = (Math.hypot(tr.x - tl.x, tr.y - tl.y) + Math.hypot(br.x - bl.x, br.y - bl.y)) * 0.5;
    const avgH = (Math.hypot(bl.x - tl.x, bl.y - tl.y) + Math.hypot(br.x - tr.x, br.y - tr.y)) * 0.5;
    const ratio =
      input.aspectRatio && input.aspectRatio > 0
        ? (avgW * input.aspectRatio) / Math.max(1e-4, avgH)
        : avgW / Math.max(1e-4, avgH);
    const area = quadArea(input.quad);

    if (area >= 0.34 && ratio >= 1.24) {
      return 'book_spread';
    }
    if (area >= 0.04 && area <= 0.44 && ratio >= 1.38 && ratio <= 1.78) {
      return 'id_card';
    }
  }

  return 'document';
}

export interface IdCardLayoutResult {
  frontRect: { x: number; y: number; width: number; height: number };
  backRect: { x: number; y: number; width: number; height: number };
  dividerY: number;
}

/**
 * Computes exact 2-up centered ID card placement coordinates on an A4 sheet.
 * Standard ISO/IEC 7810 ID-1 aspect ratio is 85.60mm x 53.98mm (~1.5858:1).
 */
export function computeIdCardLayout(
  pageWidth: number,
  pageHeight: number,
  cardScale = 0.68,
  gapFraction = 0.06
): IdCardLayoutResult {
  const aspect = 85.6 / 53.98;
  const cardW = Math.round(pageWidth * clamp(cardScale, 0.35, 0.85));
  const cardH = Math.round(cardW / aspect);
  const gap = Math.round(pageHeight * clamp(gapFraction, 0.02, 0.14));

  const totalH = cardH * 2 + gap;
  const startY = Math.max(24, Math.round((pageHeight - totalH) / 2));
  const startX = Math.round((pageWidth - cardW) / 2);

  return {
    frontRect: { x: startX, y: startY, width: cardW, height: cardH },
    backRect: { x: startX, y: startY + cardH + gap, width: cardW, height: cardH },
    dividerY: Math.round(startY + cardH + gap / 2),
  };
}

export type SortMode = 'updated_desc' | 'title_asc' | 'pages_desc';

/**
 * Filters and sorts scanned documents by folder, search query (title or OCR text), and sort mode.
 */
export function filterAndSortDocuments(
  docs: ScanDocument[],
  query: string,
  folder: FolderId,
  sortBy: SortMode
): ScanDocument[] {
  const q = query.trim().toLowerCase();

  const filtered = docs.filter((doc) => {
    if (folder === 'starred' && !doc.starred) return false;
    if (folder !== 'all' && folder !== 'starred' && doc.folder !== folder) return false;

    if (!q) return true;
    if (doc.title.toLowerCase().includes(q)) return true;
    if (doc.folder.toLowerCase().includes(q)) return true;
    return doc.pages.some((p) => p.ocrText.toLowerCase().includes(q));
  });

  return [...filtered].sort((a, b) => {
    if (sortBy === 'title_asc') {
      return a.title.localeCompare(b.title);
    }
    if (sortBy === 'pages_desc') {
      return b.pages.length - a.pages.length || b.updatedAt - a.updatedAt;
    }
    return b.updatedAt - a.updatedAt;
  });
}

export interface VisibleFeedCropRect {
  sx: number;
  sy: number;
  sWidth: number;
  sHeight: number;
  viewAspect: number;
}

/**
 * Computes the exact source rectangle visible inside an `object-cover` camera viewport
 * with centered digital zoom `zoom >= 1`. Used by both live viewfinder edge overlay
 * and shutter capture so captured images match what the user sees in the feed.
 */
export function computeVisibleFeedCropRect(
  srcWidth: number,
  srcHeight: number,
  viewWidth?: number,
  viewHeight?: number,
  zoom = 1
): VisibleFeedCropRect {
  const sw = Math.max(1, srcWidth);
  const sh = Math.max(1, srcHeight);
  const srcAspect = sw / sh;
  const viewAspect =
    viewWidth && viewHeight && viewWidth > 0 && viewHeight > 0
      ? viewWidth / viewHeight
      : srcAspect;
  const safeZoom = Math.max(1, zoom);

  let coverW = sw;
  let coverH = sh;
  if (srcAspect > viewAspect) {
    coverW = sh * viewAspect;
  } else {
    coverH = sw / viewAspect;
  }

  const sWidth = coverW / safeZoom;
  const sHeight = coverH / safeZoom;
  const sx = Math.max(0, (sw - sWidth) / 2);
  const sy = Math.max(0, (sh - sHeight) / 2);

  return {
    sx,
    sy,
    sWidth: Math.min(sw, sWidth),
    sHeight: Math.min(sh, sHeight),
    viewAspect,
  };
}

