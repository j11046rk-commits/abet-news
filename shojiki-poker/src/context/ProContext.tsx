import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { store } from '../storage/store';
import {
  configurePurchases,
  fetchProStatus,
  purchasePro,
  restorePro,
  purchasesAvailable,
} from '../purchases/purchases';

type ProContextValue = {
  isPro: boolean;
  adsEnabled: boolean; // Proならデフォルトでオフ。無料は常にオン。
  purchasesLive: boolean; // RevenueCatが実際に稼働しているか
  buyPro: () => Promise<boolean>;
  restore: () => Promise<boolean>;
  /** 開発/デモ用のローカルPro切替（§5-4「無料↔Pro切替」）。 */
  toggleProLocal: (v: boolean) => Promise<void>;
  setAdsEnabled: (v: boolean) => Promise<void>;
};

const ProContext = createContext<ProContextValue | null>(null);

export function ProProvider({ children }: { children: React.ReactNode }) {
  const [isPro, setIsPro] = useState(false);
  const [adsEnabled, setAds] = useState(true);
  const purchasesLive = purchasesAvailable();

  useEffect(() => {
    (async () => {
      await configurePurchases();
      const [localPro, localAds] = await Promise.all([store.getPro(), store.getAdsEnabled()]);
      // RevenueCatが生きていればそれを真実とする。無ければローカルフラグ。
      const remotePro = await fetchProStatus();
      const effectivePro = remotePro ?? localPro;
      setIsPro(effectivePro);
      setAds(localAds);
    })();
  }, []);

  const applyPro = useCallback(async (v: boolean) => {
    setIsPro(v);
    await store.setPro(v);
  }, []);

  const buyPro = useCallback(async () => {
    const ok = await purchasePro();
    const success = ok === true;
    if (success) await applyPro(true);
    return success;
  }, [applyPro]);

  const restore = useCallback(async () => {
    const ok = await restorePro();
    const success = ok === true;
    if (success) await applyPro(true);
    return success;
  }, [applyPro]);

  const toggleProLocal = useCallback(
    async (v: boolean) => {
      await applyPro(v);
    },
    [applyPro],
  );

  const setAdsEnabled = useCallback(async (v: boolean) => {
    setAds(v);
    await store.setAdsEnabled(v);
  }, []);

  const value: ProContextValue = {
    isPro,
    // Proは広告なし（§6）。無料はadsEnabled設定に従う（デフォルトtrue）。
    adsEnabled: isPro ? false : adsEnabled,
    purchasesLive,
    buyPro,
    restore,
    toggleProLocal,
    setAdsEnabled,
  };

  return <ProContext.Provider value={value}>{children}</ProContext.Provider>;
}

export function usePro(): ProContextValue {
  const ctx = useContext(ProContext);
  if (!ctx) throw new Error('usePro must be used within ProProvider');
  return ctx;
}
