import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { AutomationRule } from "./automation";
import { SEED_VERSION } from "./seed";
import { DEMO_NOW } from "./time";

const SEED_RULES: AutomationRule[] = [
  { id: "rule-1", text: "收款跟應收差 10 元以內就自動沖帳，其他交給我", kind: "receipt_match", params: { toleranceCents: 1000 }, enabled: true, createdAt: "2026-10-20T09:12:00+08:00", createdBy: "周筱汶" },
  { id: "rule-2", text: "稅額只差 1 元的旗標自動開更正單，其他旗標都要給我看", kind: "audit_flag", params: { maxTaxDiffCents: 100 }, enabled: true, createdAt: "2026-10-21T17:40:00+08:00", createdBy: "周筱汶" },
];

interface RuleStore {
  rules: AutomationRule[];
  add: (rule: Omit<AutomationRule, "id" | "createdAt">) => void;
  toggle: (id: string) => void;
  remove: (id: string) => void;
  reset: () => void;
}

/** Automation rules kept in this browser. Simulation only: rules never write to the ledger. */
export const useAutomationRules = create<RuleStore>()(
  persist(
    (set, get) => ({
      rules: SEED_RULES,
      add: (rule) => set({ rules: [{ ...rule, id: `rule-${Date.now().toString(36)}`, createdAt: DEMO_NOW }, ...get().rules] }),
      toggle: (id) => set({ rules: get().rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)) }),
      remove: (id) => set({ rules: get().rules.filter((r) => r.id !== id) }),
      reset: () => set({ rules: SEED_RULES }),
    }),
    {
      name: "kingjili-automation-rules",
      version: SEED_VERSION,
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      migrate: () => ({ rules: SEED_RULES }) as unknown as RuleStore,
    },
  ),
);
