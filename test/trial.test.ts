import assert from "node:assert/strict";
import { test } from "node:test";
import { isoPeriod, offerTokenFor, periodText, proLabel, trialOf } from "../src/core/trial";

test("periods read as words", () => {
  assert.equal(periodText({ unit: "month", value: 1 }), "1 month");
  assert.equal(periodText({ unit: "day", value: 7 }), "7 days");
  assert.equal(periodText({ unit: "empty", value: 1 }), null);
  assert.deepEqual(isoPeriod("P1M"), { unit: "month", value: 1 });
  assert.deepEqual(isoPeriod("P7D"), { unit: "day", value: 7 });
  assert.equal(isoPeriod("bad"), null);
});

test("iOS: a 1-month free introductory offer is shown; a paid intro or none is not", () => {
  assert.deepEqual(
    trialOf({
      introductoryPricePaymentModeIOS: "free-trial",
      introductoryPriceSubscriptionPeriodIOS: "month",
      introductoryPriceNumberOfPeriodsIOS: "1",
    }),
    { length: "1 month" },
  );
  assert.equal(
    trialOf({ introductoryPricePaymentModeIOS: "pay-as-you-go", introductoryPriceSubscriptionPeriodIOS: "month" }),
    null,
  );
  assert.equal(trialOf({ introductoryPricePaymentModeIOS: "empty" }), null);
});

const playProduct = {
  subscriptionOffers: [
    {
      offerTokenAndroid: "BASE",
      pricingPhasesAndroid: {
        pricingPhaseList: [
          { priceAmountMicros: "9990000", billingPeriod: "P1M", billingCycleCount: 0, formattedPrice: "$9.99" },
        ],
      },
    },
    {
      offerTokenAndroid: "TRIAL",
      pricingPhasesAndroid: {
        pricingPhaseList: [
          { priceAmountMicros: "0", billingPeriod: "P1M", billingCycleCount: 1, formattedPrice: "Free" },
          { priceAmountMicros: "9990000", billingPeriod: "P1M", billingCycleCount: 0, formattedPrice: "$9.99" },
        ],
      },
    },
  ],
};

test("Google Play: the free phase gives the trial length and its offer token is used to buy", () => {
  assert.deepEqual(trialOf(playProduct), { length: "1 month", offerToken: "TRIAL" });
  assert.equal(offerTokenFor(playProduct), "TRIAL");
});

test("Google Play: someone who already had the trial only gets the base plan (no trial shown)", () => {
  const used = { subscriptionOffers: [playProduct.subscriptionOffers[0]] };
  assert.equal(trialOf(used), null);
  assert.equal(offerTokenFor(used), "BASE");
});

test("Pro buttons say the trial length and the price it renews at", () => {
  assert.equal(proLabel("monthly", "$9.99", "1 month"), "1 month free, then $9.99/month");
  assert.equal(proLabel("yearly", "$79.99", "1 month"), "1 month free, then $79.99/year");
  assert.equal(proLabel("monthly", "$9.99"), "Monthly · $9.99");
});
