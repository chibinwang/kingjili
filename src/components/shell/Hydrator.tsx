"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useAutomationRules } from "@/lib/automationRules";
import { useStatementDrafts } from "@/lib/statementDrafts";
import { useStore } from "@/lib/store";

/** Rehydrate persisted demo state after mount so SSR markup (seed data) matches the first client render. */
export function Hydrator({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    Promise.all([useStore.persist.rehydrate(), useStatementDrafts.persist.rehydrate(), useAutomationRules.persist.rehydrate()]).finally(() => setReady(true));
  }, []);
  return <div data-hydrated={ready ? "1" : "0"}>{children}</div>;
}
