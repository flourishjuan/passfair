// Passfair Pro through the App Store (auto-renewing subscription). Pro features unlock the moment the
// store confirms the purchase, and are re-checked on every launch. Nothing about the user is sent to us:
// Apple handles payment and the entitlement check runs on the phone.
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { PRO_PRODUCTS, type Tier } from "../core/plan";

export interface ProProduct {
  id: string;
  period: "monthly" | "yearly";
  price: string;
  title: string;
}
const SKUS = [PRO_PRODUCTS.monthly, PRO_PRODUCTS.yearly];

function iap(): any | null {
  if (Platform.OS === "web") return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-iap");
  } catch {
    return null;
  }
}

export function usePro(cached: boolean, onChange: (active: boolean) => void) {
  const [tier, setTier] = useState<Tier>(cached ? "pro" : "free");
  const [products, setProducts] = useState<ProProduct[]>([]);
  const offers = useRef(new Map<string, string>()); // Google Play: product id → offer token
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const ready = useRef(false);
  const set = useCallback(
    (active: boolean) => {
      setTier(active ? "pro" : "free");
      onChange(active);
    },
    [onChange],
  );

  const refresh = useCallback(async () => {
    const m = iap();
    if (!m || !ready.current) return;
    try {
      const subs = await m.getActiveSubscriptions(SKUS);
      set(Array.isArray(subs) && subs.length > 0);
    } catch {}
  }, [set]);

  useEffect(() => {
    const m = iap();
    if (!m) {
      setNote("Pro is purchased in the iPhone or Android app.");
      return;
    }
    let up: { remove: () => void } | undefined;
    let err: { remove: () => void } | undefined;
    (async () => {
      try {
        await m.initConnection();
        ready.current = true;
        up = m.purchaseUpdatedListener(async (p: any) => {
          if (SKUS.includes(p?.productId)) {
            try {
              await m.finishTransaction({ purchase: p, isConsumable: false });
            } catch {}
            set(true);
            setBusy(false);
          }
        });
        err = m.purchaseErrorListener((e: any) => {
          setBusy(false);
          if (e?.code !== "user-cancelled" && e?.code !== "E_USER_CANCELLED") setNote(e?.message || "Purchase failed.");
        });
        const list = (await m.fetchProducts({ skus: SKUS, type: "subs" })) || [];
        for (const p of list) {
          const o = (p.subscriptionOffers || []).find((x: any) => x?.offerTokenAndroid) || null;
          if (o) offers.current.set(p.id, o.offerTokenAndroid);
        }
        setProducts(
          list
            .map((p: any) => ({
              id: p.id,
              period: p.id === PRO_PRODUCTS.yearly ? "yearly" : "monthly",
              price: p.displayPrice || (p.subscriptionOffers || [])[0]?.displayPrice || "",
              title: p.title,
            }))
            .sort((a: ProProduct) => (a.period === "monthly" ? -1 : 1)),
        );
        if (!list.length) setNote("Pro is not on sale yet. Check back soon.");
        await refresh();
      } catch {
        setNote("The App Store is not reachable right now.");
      }
    })();
    return () => {
      up?.remove();
      err?.remove();
      try {
        m.endConnection();
      } catch {}
    };
  }, [refresh, set]);

  const buy = useCallback(async (id: string) => {
    const m = iap();
    if (!m) return;
    setBusy(true);
    setNote("");
    try {
      const token = offers.current.get(id);
      await m.requestPurchase({
        request: {
          apple: { sku: id },
          google: { skus: [id], ...(token ? { subscriptionOffers: [{ sku: id, offerToken: token }] } : {}) },
        },
        type: "subs",
      });
    } catch (e: any) {
      setBusy(false);
      setNote(e?.message || "Purchase failed.");
    }
  }, []);
  const restore = useCallback(async () => {
    const m = iap();
    if (!m) return;
    setBusy(true);
    try {
      await m.restorePurchases();
      const subs = await m.getActiveSubscriptions(SKUS);
      const active = Array.isArray(subs) && subs.length > 0;
      set(active);
      setNote(active ? "Pro restored." : "No active Pro subscription on this Apple ID.");
    } catch {
      setNote("Restore failed. Try again.");
    } finally {
      setBusy(false);
    }
  }, [set]);
  const manage = useCallback(async () => {
    try {
      await iap()?.deepLinkToSubscriptions({
        packageNameAndroid: "ai.agentsfair.passfair",
        skuAndroid: PRO_PRODUCTS.monthly,
      });
    } catch {}
  }, []);

  return { tier, products, busy, note, buy, restore, manage };
}
