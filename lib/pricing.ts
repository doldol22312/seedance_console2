import type { Provider, Resolution } from "./types";
import {
  formatMoney,
  quoteSeedance,
  type Currency,
  type SeedanceModel,
  type SeedanceResolution,
} from "./seedance-pricing";
import { quoteWan3, wanRegion, type Wan3Resolution } from "./wan-pricing";

export { formatMoney };
export type { Currency };

export type PricedWanModel = "wan3.0-video" | "wan3.0-video-prime";

const WAN_LABELS: Record<PricedWanModel, string> = {
  "wan3.0-video": "Wan 3.0",
  "wan3.0-video-prime": "Wan 3.0 Prime",
};

// Matches wan3.0-video, wan-3, wan_3-prime… but not wan30 or wan2.x.
const WAN3_PATTERN = /(^|[^a-z0-9])wan[-_.]?3(?!\d)/;

export function pricedWanModel(model?: string): PricedWanModel | undefined {
  const id = (model || "").trim().toLowerCase();
  if (!WAN3_PATTERN.test(id)) return undefined;
  return id.includes("prime") ? "wan3.0-video-prime" : "wan3.0-video";
}

// Seedance is token-billed: tokensPerSecond × rate per 1M tokens, with a 4s
// input floor when a video is attached. The tables live in seedance-pricing.ts.
const SEEDANCE_MODELS: { id: SeedanceModel; label: string; pattern: RegExp }[] = [
  { id: "seedance-2.0-fast", label: "Seedance 2.0 Fast", pattern: /(seedance|sd)[-_. ]?2[-_. ]?0[-_. ]?fast/ },
  { id: "seedance-2.0-mini", label: "Seedance 2.0 Mini", pattern: /(seedance|sd)[-_. ]?2[-_. ]?0[-_. ]?mini/ },
  { id: "seedance-2.5", label: "Seedance 2.5", pattern: /(seedance|sd)[-_. ]?2[-_. ]?5/ },
  { id: "seedance-2.0", label: "Seedance 2.0", pattern: /(seedance|sd)[-_. ]?2[-_. ]?0/ },
];

export function pricedSeedanceModel(model?: string) {
  const id = (model || "").trim().toLowerCase();
  return SEEDANCE_MODELS.find((entry) => entry.pattern.test(id));
}

export type PriceEstimate = {
  label: string;
  note: string;
  provider: Provider;
  resolution: Resolution | SeedanceResolution;
  currency: Currency;
  adaptive: boolean;
  seconds: { min: number; max: number };
  cost: { min: number; max: number };
  rate?: number; // Wan effective price per second
  ratePerM?: number; // Seedance price per 1M tokens
  tokens?: { min: number; max: number };
  promoApplied?: boolean;
  promoEndsAt?: string;
};

export type PriceInput = {
  model?: string;
  resolution: Resolution;
  duration: number;
  minDuration?: number;
  maxDuration?: number;
  inputSeconds?: number;
  baseUrl?: string;
  freeQuotaSeconds?: number;
  currency?: Currency;
  enterprise?: boolean;
  now?: Date;
};

function estimateWan(model: PricedWanModel, input: PriceInput): PriceEstimate {
  const adaptive = input.duration < 0;
  const min = adaptive ? input.minDuration ?? 2 : input.duration;
  const max = adaptive ? input.maxDuration ?? 30 : input.duration;
  const region = wanRegion(input.baseUrl);

  const quote = (outputSeconds: number) =>
    quoteWan3({
      model,
      resolution: input.resolution.toUpperCase() as Wan3Resolution,
      region,
      outputSeconds,
      inputSeconds: input.inputSeconds ?? 0,
      freeQuotaSeconds: input.freeQuotaSeconds ?? 0,
      now: input.now,
    });

  const low = quote(min);
  const high = adaptive ? quote(max) : low;
  return {
    label: WAN_LABELS[model],
    note: `${low.hasPromo ? "30% off promo" : "list price"} · ${region}`,
    provider: "dashscope",
    resolution: input.resolution,
    currency: "USD",
    adaptive,
    seconds: { min, max },
    cost: { min: low.cost, max: high.cost },
    rate: low.ratePerSecond,
  };
}

function estimateSeedance(
  entry: (typeof SEEDANCE_MODELS)[number],
  input: PriceInput,
): PriceEstimate | undefined {
  const currency = input.currency ?? "CNY";
  const adaptive = input.duration < 0;
  const minSeconds = adaptive ? input.minDuration ?? 4 : input.duration;
  const maxSeconds = adaptive ? input.maxDuration ?? 30 : input.duration;
  const inputSeconds = Math.max(input.inputSeconds ?? 0, 0);

  const quote = (outputSeconds: number) =>
    quoteSeedance({
      model: entry.id,
      resolution: input.resolution,
      outputSeconds,
      inputSeconds,
      currency,
      enterprise: input.enterprise,
      now: input.now,
    });

  try {
    const low = quote(minSeconds);
    const high = adaptive ? quote(maxSeconds) : low;
    const source = inputSeconds > 0 ? "with video input" : "text / image only";
    return {
      label: entry.label,
      note: low.promoApplied ? `${source} · promo applied` : source,
      provider: "ark",
      resolution: input.resolution,
      currency,
      adaptive,
      seconds: { min: minSeconds, max: maxSeconds },
      cost: { min: low.cost, max: high.cost },
      ratePerM: low.ratePerM,
      tokens: { min: low.tokens, max: high.tokens },
      promoApplied: low.promoApplied,
      promoEndsAt: low.promoEndsAt,
    };
  } catch {
    // No published rate for this model / resolution combo (e.g. fast @ 1080p).
    return undefined;
  }
}

// `duration` below zero is the provider's auto-length mode (-1): the model
// picks any length in [minDuration, maxDuration], so the price is a range.
export function estimatePrice(input: PriceInput): PriceEstimate | undefined {
  const seedance = pricedSeedanceModel(input.model);
  if (seedance) return estimateSeedance(seedance, input);
  const wan = pricedWanModel(input.model);
  if (wan) return estimateWan(wan, input);
  return undefined;
}

export function formatPriceRange(estimate: PriceEstimate): string {
  if (!estimate.adaptive) return formatMoney(estimate.cost.max, estimate.currency);
  return `${formatMoney(estimate.cost.min, estimate.currency)} – ${formatMoney(estimate.cost.max, estimate.currency)}`;
}
