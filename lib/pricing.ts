import type { Resolution } from "./types";

// Wan 3.0 video generation on Alibaba Cloud Model Studio (Beijing).
// USD per second of output video, by resolution tier.
export type PricedWanModel = "wan3.0-video" | "wan3.0-video-prime";

export const WAN_RATES: Record<
  PricedWanModel,
  { label: string; note: string; rates: Record<Resolution, number> }
> = {
  "wan3.0-video": {
    label: "Wan 3.0",
    note: "30% off promo",
    rates: { "480p": 0.028879, "720p": 0.057759, "1080p": 0.115518 },
  },
  "wan3.0-video-prime": {
    label: "Wan 3.0 Prime",
    note: "list price",
    rates: { "480p": 0.0636, "720p": 0.127199, "1080p": 0.254399 },
  },
};

// Matches wan3.0-video, wan-3, wan_3-prime… but not wan30 or wan2.x.
const WAN3_PATTERN = /(^|[^a-z0-9])wan[-_.]?3(?!\d)/;

export function pricedWanModel(model?: string): PricedWanModel | undefined {
  const id = (model || "").trim().toLowerCase();
  if (!WAN3_PATTERN.test(id)) return undefined;
  return id.includes("prime") ? "wan3.0-video-prime" : "wan3.0-video";
}

export type WanPriceEstimate = {
  model: PricedWanModel;
  label: string;
  note: string;
  resolution: Resolution;
  rate: number;
  adaptive: boolean;
  seconds: { min: number; max: number };
  total: { min: number; max: number };
};

// `duration` below zero is DashScope's smart-duration mode (-1): the model
// picks any length in [minDuration, maxDuration], so the price is a range.
export function estimateWanPrice(input: {
  model?: string;
  resolution: Resolution;
  duration: number;
  minDuration?: number;
  maxDuration?: number;
}): WanPriceEstimate | undefined {
  const model = pricedWanModel(input.model);
  if (!model) return undefined;
  const entry = WAN_RATES[model];
  const rate = entry.rates[input.resolution];
  const adaptive = input.duration < 0;
  const min = adaptive ? input.minDuration ?? 2 : input.duration;
  const max = adaptive ? input.maxDuration ?? 30 : input.duration;
  return {
    model,
    label: entry.label,
    note: entry.note,
    resolution: input.resolution,
    rate,
    adaptive,
    seconds: { min, max },
    total: { min: rate * min, max: rate * max },
  };
}

// Small totals keep more decimals so a 2s 480p take does not read as $0.06.
export function formatUsd(value: number): string {
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.1) return `$${value.toFixed(3)}`;
  if (value >= 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(5)}`;
}

export function formatUsdRange(estimate: WanPriceEstimate): string {
  if (!estimate.adaptive) return formatUsd(estimate.total.max);
  return `${formatUsd(estimate.total.min)} – ${formatUsd(estimate.total.max)}`;
}
