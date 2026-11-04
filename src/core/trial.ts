// Free trial shown on the Pro page. The trial itself is a store offer (App Store introductory offer /
// Google Play free-trial phase) set up in the store consoles: the app only reads it and shows it, so the
// length shown is always what the store will really give. No trial configured → nothing is shown.

export interface Period {
  unit: string; // day | week | month | year
  value: number;
}

export function periodText(p: Period | null | undefined): string | null {
  if (!p || !(p.value > 0) || !["day", "week", "month", "year"].includes(p.unit)) return null;
  return `${p.value} ${p.unit}${p.value === 1 ? "" : "s"}`;
}

// Google Play billing periods are ISO-8601 durations: P7D, P1W, P1M, P1Y.
export function isoPeriod(s: string | null | undefined): Period | null {
  const m = String(s || "").match(/^P(\d+)([DWMY])$/);
  if (!m) return null;
  return { value: Number(m[1]), unit: { D: "day", W: "week", M: "month", Y: "year" }[m[2] as "D"] };
}

const free = (ph: any) => String(ph?.priceAmountMicros ?? "") === "0";

/** The free trial a store product offers to this user, e.g. { length: "1 month" }, or null. */
export function trialOf(p: any): { length: string; offerToken?: string } | null {
  for (const o of p?.subscriptionOffers || []) {
    const phases = o?.pricingPhasesAndroid?.pricingPhaseList || [];
    const trialPhase = phases.find(free);
    if (trialPhase) {
      const n = Number(trialPhase.billingCycleCount) || 1;
      const per = isoPeriod(trialPhase.billingPeriod);
      const len = periodText(per && { unit: per.unit, value: per.value * n });
      if (len) return { length: len, offerToken: o.offerTokenAndroid || undefined };
    }
    if (o?.paymentMode === "free-trial" && !phases.length) {
      const per = o.period ? { unit: o.period.unit, value: o.period.value * (Number(o.periodCount) || 1) } : null;
      const len = periodText(per);
      if (len) return { length: len };
    }
  }
  if (p?.introductoryPricePaymentModeIOS === "free-trial") {
    const len = periodText({
      unit: p.introductoryPriceSubscriptionPeriodIOS,
      value: Number(p.introductoryPriceNumberOfPeriodsIOS) || 1,
    });
    if (len) return { length: len };
  }
  return null;
}

/** Google Play: the offer token to buy with — the trial offer when there is one, else the base plan. */
export function offerTokenFor(p: any): string | null {
  const t = trialOf(p);
  if (t?.offerToken) return t.offerToken;
  const offers = (p?.subscriptionOffers || []).filter((x: any) => x?.offerTokenAndroid);
  const base = offers.find((x: any) => !(x?.pricingPhasesAndroid?.pricingPhaseList || []).some(free)) || offers[0];
  return base?.offerTokenAndroid || null;
}

/** Pro page button: "1 month free, then $9.99/month" with a trial, else "Monthly · $9.99". */
export function proLabel(period: "monthly" | "yearly", price: string, trial?: string): string {
  const per = period === "yearly" ? "year" : "month";
  return trial ? `${trial} free, then ${price}/${per}` : `${period === "yearly" ? "Yearly" : "Monthly"} · ${price}`;
}
