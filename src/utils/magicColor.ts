/**
 * Helpers behind the "Magic Color HD" preset.
 *
 * A phone photo of a page fails in three ways: uneven light (a gradient or a
 * hand shadow), a colour cast from the room lighting, and grey paper that makes
 * ink look washed out. `imageProcessor` already flattens illumination; these
 * helpers add the last two steps, cheaply and without touching geometry:
 *
 *  1. estimate the paper colour from the brightest pixels and derive per-channel
 *     gains so paper becomes neutral white instead of yellow/blue,
 *  2. apply a gentle smoothstep tone curve that lifts paper toward white while
 *     deepening ink, blended so the result never looks over-processed.
 *
 * Everything here is pure: pixels in, pixels out. That keeps it testable without
 * a canvas.
 */

export interface ChannelGains {
  r: number;
  g: number;
  b: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Estimates the paper cast from the brightest ~12% of pixels.
 * A neutral paper returns gains near 1 for every channel; a warm cast returns
 * `b > r`, a cool cast the opposite.
 */
export function estimatePaperGains(data: Uint8ClampedArray): ChannelGains {
  const bins = 32;
  const histogram = new Uint32Array(bins);
  const step = data.length > 400_000 ? 16 : 4; // stride in pixels, keep it fast on big scans
  let sampled = 0;

  for (let i = 0; i < data.length; i += step) {
    const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    histogram[Math.min(bins - 1, Math.max(0, Math.floor(luma / 8)))] += 1;
    sampled += 1;
  }

  if (sampled === 0) return { r: 1, g: 1, b: 1 };

  // Walk down from the top bin until the brightest 12% of samples are covered.
  const target = sampled * 0.12;
  let covered = 0;
  let thresholdBin = bins - 1;
  for (; thresholdBin >= 0; thresholdBin--) {
    covered += histogram[thresholdBin];
    if (covered >= target) break;
  }
  const threshold = Math.max(120, thresholdBin * 8);

  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += step) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (0.299 * r + 0.587 * g + 0.114 * b < threshold) continue;
    sumR += r;
    sumG += g;
    sumB += b;
    count += 1;
  }

  if (count === 0) return { r: 1, g: 1, b: 1 };

  const avgR = sumR / count;
  const avgG = sumG / count;
  const avgB = sumB / count;
  const avgLuma = 0.299 * avgR + 0.587 * avgG + 0.114 * avgB;
  if (avgLuma < 1) return { r: 1, g: 1, b: 1 };

  return {
    r: clamp(avgLuma / Math.max(1, avgR), 0.86, 1.16),
    g: clamp(avgLuma / Math.max(1, avgG), 0.86, 1.16),
    b: clamp(avgLuma / Math.max(1, avgB), 0.86, 1.16),
  };
}

/**
 * Applies neutral paper gains plus a smoothstep tone curve, blended by `strength`.
 * `strength` 0 leaves the pixels alone, 1 applies the full treatment.
 */
export function applyPaperFinish(
  data: Uint8ClampedArray,
  gains: ChannelGains,
  strength = 0.6
): void {
  if (strength <= 0) return;
  const blend = clamp(strength, 0, 1);

  // 256-entry lookup table for the tone curve, reused for every channel.
  const curve = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    const t = v / 255;
    const shaped = t * t * (3 - 2 * t); // smoothstep: darker ink, brighter paper
    curve[v] = Math.round(t * 255 + (shaped * 255 - t * 255) * blend);
  }

  for (let i = 0; i < data.length; i += 4) {
    data[i] = curve[clamp(Math.round(data[i] * gains.r), 0, 255)];
    data[i + 1] = curve[clamp(Math.round(data[i + 1] * gains.g), 0, 255)];
    data[i + 2] = curve[clamp(Math.round(data[i + 2] * gains.b), 0, 255)];
  }
}
