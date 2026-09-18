/* wan-pricing.ts
 * Wan 3.0 rates: Alibaba Cloud Model Studio, Sep 2026.
 * cost = (inputSeconds + outputSeconds) × ratePerSecond
 * wan3.0-video runs a 0.7 promo until 2026-09-24 00:00 Beijing time; prime
 * has no promo. Failed generations cost 0 and do not consume free quota.
 */

export type Wan3Model = "wan3.0-video" | "wan3.0-video-prime";
export type Wan3Resolution = "480P" | "720P" | "1080P";
export type Wan3Region = "singapore" | "beijing" | "global";

const WAN3_RATES: Record<Wan3Model, Record<Wan3Region, Record<Wan3Resolution, number>>> = {
  "wan3.0-video": {
    singapore: { "480P": 0.05, "720P": 0.1, "1080P": 0.2 },
    beijing: { "480P": 0.041256, "720P": 0.082513, "1080P": 0.165025 },
    global: { "480P": 0.041256, "720P": 0.082513, "1080P": 0.165025 },
  },
  "wan3.0-video-prime": {
    singapore: { "480P": 0.068, "720P": 0.14, "1080P": 0.28 },
    beijing: { "480P": 0.0636, "720P": 0.127199, "1080P": 0.254399 },
    global: { "480P": 0.0636, "720P": 0.127199, "1080P": 0.254399 },
  },
};

const WAN3_PROMO = {
  factor: 0.7,
  until: new Date("2026-09-24T00:00:00+08:00"),
  appliesTo: "wan3.0-video" as Wan3Model,
};

export interface Wan3QuoteInput {
  model: Wan3Model;
  resolution: Wan3Resolution;
  region: Wan3Region;
  outputSeconds: number;
  inputSeconds?: number; // input/reference video duration, default 0
  freeQuotaSeconds?: number; // remaining free quota (Singapore), default 0
  now?: Date;
}

export interface Wan3Quote {
  ratePerSecond: number;
  totalSeconds: number;
  billableSeconds: number;
  cost: number;
  hasPromo: boolean;
}

export function quoteWan3(opts: Wan3QuoteInput): Wan3Quote {
  const {
    model,
    resolution,
    region,
    outputSeconds,
    inputSeconds = 0,
    freeQuotaSeconds = 0,
    now = new Date(),
  } = opts;

  const listRate = WAN3_RATES[model][region][resolution];
  const hasPromo = model === WAN3_PROMO.appliesTo && now < WAN3_PROMO.until;
  const ratePerSecond = listRate * (hasPromo ? WAN3_PROMO.factor : 1);

  const totalSeconds = inputSeconds + outputSeconds;
  const billableSeconds = Math.max(0, totalSeconds - freeQuotaSeconds);
  const cost = billableSeconds * ratePerSecond;

  return { ratePerSecond, totalSeconds, billableSeconds, cost, hasPromo };
}

/** Pick the rate card from the configured DashScope host. */
export function wanRegion(baseUrl?: string): Wan3Region {
  const url = (baseUrl || "").toLowerCase();
  if (url.includes("cn-beijing") || url.includes("cn-shanghai") || url.includes("cn-hangzhou")) {
    return "beijing";
  }
  if (url.includes("intl") || url.includes("singapore") || url.includes("ap-southeast")) {
    return "singapore";
  }
  if (url.includes("aliyuncs.com")) return "beijing";
  return "global";
}
