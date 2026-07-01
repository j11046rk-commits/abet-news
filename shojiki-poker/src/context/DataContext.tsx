import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { CashSession, MttEntry } from '../types';
import { store, makeId } from '../storage/store';
import { cashStats, mttStats, grandTotal, type CashStats, type MttStats } from '../logic/calc';

type DataContextValue = {
  ready: boolean;
  cashSessions: CashSession[];
  mttEntries: MttEntry[];
  cash: CashStats;
  mtt: MttStats;
  grand: number;
  addCash: (s: Omit<CashSession, 'id'>) => Promise<void>;
  addMtt: (e: Omit<MttEntry, 'id'>) => Promise<void>;
  removeCash: (id: string) => Promise<void>;
  removeMtt: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
};

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [cashSessions, setCashSessions] = useState<CashSession[]>([]);
  const [mttEntries, setMttEntries] = useState<MttEntry[]>([]);

  useEffect(() => {
    (async () => {
      const [c, m] = await Promise.all([store.getCashSessions(), store.getMttEntries()]);
      setCashSessions(sortDesc(c));
      setMttEntries(sortDesc(m));
      setReady(true);
    })();
  }, []);

  const persistCash = useCallback(async (next: CashSession[]) => {
    const sorted = sortDesc(next);
    setCashSessions(sorted);
    await store.setCashSessions(sorted);
  }, []);

  const persistMtt = useCallback(async (next: MttEntry[]) => {
    const sorted = sortDesc(next);
    setMttEntries(sorted);
    await store.setMttEntries(sorted);
  }, []);

  const addCash = useCallback(
    async (s: Omit<CashSession, 'id'>) => {
      await persistCash([{ ...s, id: makeId() }, ...cashSessions]);
    },
    [cashSessions, persistCash],
  );

  const addMtt = useCallback(
    async (e: Omit<MttEntry, 'id'>) => {
      await persistMtt([{ ...e, id: makeId() }, ...mttEntries]);
    },
    [mttEntries, persistMtt],
  );

  const removeCash = useCallback(
    async (id: string) => {
      await persistCash(cashSessions.filter((s) => s.id !== id));
    },
    [cashSessions, persistCash],
  );

  const removeMtt = useCallback(
    async (id: string) => {
      await persistMtt(mttEntries.filter((e) => e.id !== id));
    },
    [mttEntries, persistMtt],
  );

  const clearAll = useCallback(async () => {
    setCashSessions([]);
    setMttEntries([]);
    await store.clearRecords();
  }, []);

  const cash = useMemo(() => cashStats(cashSessions), [cashSessions]);
  const mtt = useMemo(() => mttStats(mttEntries), [mttEntries]);
  const grand = useMemo(() => grandTotal(cash, mtt), [cash, mtt]);

  const value: DataContextValue = {
    ready,
    cashSessions,
    mttEntries,
    cash,
    mtt,
    grand,
    addCash,
    addMtt,
    removeCash,
    removeMtt,
    clearAll,
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

function sortDesc<T extends { date: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.date - a.date);
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
}
