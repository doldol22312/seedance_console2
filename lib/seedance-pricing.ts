/* seedance-pricing.ts
 * Rates: Volcano Engine Ark (CNY) / BytePlus ModelArk (USD), Sep 2026
 * tokensPerSecond values are derived from the official price examples so
 * quotes match the published tables exactly.
 */

export type Currency = "CNY" | "USD";
export type SeedanceResolution = "480p" | "720p" | "1080p" | "4k";
export type SeedanceModel =
  | "seedance-2.5"
  | "seedance-2.0"
  | "seedance-2.0-fast"
  | "seedance-2.0-mini";

interface Rates {
  noVideo: number;
  withVideo: number; // per 1M tokens
}

interface Promo {
  factor: number; // 0.72 = 28% off
  until: string; // ISO, UTC+8
  enterpriseOnly?: boolean;
}

interface Tier {
  tokensPerSecond: number;
  cny: Rates; // Volcano Engine
  usd: Rates; // BytePlus
  promo?: Promo;
}

const PRICING: Record<SeedanceModel, Partial<Record<SeedanceResolution, Tier>>> = {
  "seedance-2.5": {
    "480p": { tokensPerSecond: 9_600, cny: { noVideo: 70, withVideo: 42 }, usd: { noVideo: 10.7, withVideo: 6.4 } },
    "720p": { tokensPerSecond: 21_600, cny: { noVideo: 70, withVideo: 42 }, usd: { noVideo: 10.7, withVideo: 6.4 } },
    "1080p": {
      tokensPerSecond: 48_600,
      cny: { noVideo: 77, withVideo: 46 },
      usd: { noVideo: 11.7, withVideo: 7.0 },
      promo: { factor: 0.72, until: "2026-09-17T14:00:00+08:00" },
    },
  },
  "seedance-2.0": {
    "480p": { tokensPerSecond: 10_000, cny: { noVideo: 46, withVideo: 28 }, usd: { noVideo: 7.0, withVideo: 4.3 } },
    "720p": { tokensPerSecond: 21_600, cny: { noVideo: 46, withVideo: 28 }, usd: { noVideo: 7.0, withVideo: 4.3 } },
    "1080p": { tokensPerSecond: 48_600, cny: { noVideo: 51, withVideo: 31 }, usd: { noVideo: 7.7, withVideo: 4.7 } },
    "4k": { tokensPerSecond: 194_400, cny: { noVideo: 26, withVideo: 16 }, usd: { noVideo: 4.0, withVideo: 2.4 } },
  },
  "seedance-2.0-fast": {
    "480p": {
      tokensPerSecond: 10_000,
      cny: { noVideo: 37, withVideo: 22 },
      usd: { noVideo: 5.6, withVideo: 3.3 },
      promo: { factor: 0.75, until: "2026-10-07T14:00:00+08:00", enterpriseOnly: true },
    },
    "720p": {
      tokensPerSecond: 21_600,
      cny: { noVideo: 37, withVideo: 22 },
      usd: { noVideo: 5.6, withVideo: 3.3 },
      promo: { factor: 0.75, until: "2026-10-07T14:00:00+08:00", enterpriseOnly: true },
    },
  },
  "seedance-2.0-mini": {
    "480p": {
      tokensPerSecond: 10_000,
      cny: { noVideo: 23, withVideo: 14 },
      usd: { noVideo: 3.5, withVideo: 2.1 },
      promo: { factor: 0.4, until: "2026-10-07T14:00:00+08:00", enterpriseOnly: true },
    },
    "720p": {
      tokensPerSecond: 21_600,
      cny: { noVideo: 23, withVideo: 14 },
      usd: { noVideo: 3.5, withVideo: 2.1 },
      promo: { factor: 0.4, until: "2026-10-07T14:00:00+08:00", enterpriseOnly: true },
    },
  },
};

/** With a video input you're billed for input duration, but never less than 4s. */
const MIN_BILLABLE_INPUT_SECONDS = 4;

export interface QuoteInput {
  model: SeedanceModel;
  resolution: SeedanceResolution;
  outputSeconds: number;
  inputSeconds?: number; // omit/0 = text/image-only (no video input)
  currency?: Currency; // CNY = Volcano Engine, USD = BytePlus (default CNY)
  enterprise?: boolean; // required for fast/mini promos
  applyPromo?: boolean; // default true
  now?: Date; // injectable for tests
}

export interface Quote {
  tokens: number;
  billableSeconds: number;
  ratePerM: number;
  baseRatePerM: number;
  promoApplied: boolean;
  promoEndsAt?: string;
  cost: number;
  currency: Currency;
}

function resolveRate(
  tier: Tier,
  currency: Currency,
  hasVideo: boolean,
  opts: Pick<QuoteInput, "enterprise" | "applyPromo" | "now">,
) {
  const table = currency === "CNY" ? tier.cny : tier.usd;
  const baseRatePerM = hasVideo ? table.withVideo : table.noVideo;

  let factor = 1;
  if (opts.applyPromo !== false && tier.promo) {
    const now = opts.now ?? new Date();
    const notExpired = now.getTime() < new Date(tier.promo.until).getTime();
    const allowed = !tier.promo.enterpriseOnly || !!opts.enterprise;
    if (notExpired && allowed) factor = tier.promo.factor;
  }

  return {
    baseRatePerM,
    ratePerM: baseRatePerM * factor,
    promoApplied: factor !== 1,
    promoEndsAt: factor !== 1 ? tier.promo!.until : undefined,
  };
}

export function quoteSeedance(input: QuoteInput): Quote {
  const tier = PRICING[input.model]?.[input.resolution];
  if (!tier) throw new Error(`No Seedance pricing for ${input.model} @ ${input.resolution}`);

  const currency = input.currency ?? "CNY";
  const hasVideo = (input.inputSeconds ?? 0) > 0;

  const billableSeconds = hasVideo
    ? input.outputSeconds + Math.max(input.inputSeconds!, MIN_BILLABLE_INPUT_SECONDS)
    : input.outputSeconds;

  const tokens = Math.ceil(billableSeconds * tier.tokensPerSecond);
  const rate = resolveRate(tier, currency, hasVideo, input);

  return {
    tokens,
    billableSeconds,
    ...rate,
    cost: (tokens / 1_000_000) * rate.ratePerM,
    currency,
  };
}

/** After the API responds, bill/display off the real usage.completion_tokens. */
export function costFromActualTokens(actualTokens: number, input: QuoteInput): number {
  const tier = PRICING[input.model]?.[input.resolution];
  if (!tier) throw new Error(`No Seedance pricing for ${input.model} @ ${input.resolution}`);
  const hasVideo = (input.inputSeconds ?? 0) > 0;
  const rate = resolveRate(tier, input.currency ?? "CNY", hasVideo, input);
  return (actualTokens / 1_000_000) * rate.ratePerM;
}

export function formatMoney(value: number, currency: Currency): string {
  return new Intl.NumberFormat(currency === "CNY" ? "zh-CN" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}
