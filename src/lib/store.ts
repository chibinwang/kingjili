"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { toast } from "sonner";
import { ActionError, type ActCtx, type Actor } from "./actions";
import type { Db } from "./db";
import { buildSeed, SEED_VERSION } from "./seed";
import { useAutomationRules } from "./automationRules";
import { useStatementDrafts } from "./statementDrafts";
import { DEMO_NOW, toTaipeiIso } from "./time";

interface Store {
  db: Db;
  userId: string;
  tick: number;
  aiOpen: boolean;
  aiDraft: string;
  /** Desktop sidebar shows icons only. */
  navCollapsed: boolean;
  setNavCollapsed: (collapsed: boolean) => void;
  setUser: (id: string) => void;
  setAiOpen: (open: boolean, draft?: string) => void;
  /** Run a pure action against the db; shows toast on success/failure. Returns true on success. */
  run: (fn: (db: Db, ctx: ActCtx) => Db, success?: string, opts?: { asUserId?: string; correlationId?: string; approvedBy?: string }) => boolean;
  /** Like run, but for actions that also return a value. */
  runWith: <T>(fn: (db: Db, ctx: ActCtx) => { db: Db; value: T }, opts?: { asUserId?: string }) => T | null;
  now: () => string;
  reset: () => void;
}

export const useStore = create<Store>()(
  persist(
    (set, get) => {
      const nextNow = () => {
        const tick = get().tick + 1;
        set({ tick });
        return toTaipeiIso(Date.parse(DEMO_NOW) + tick * 23_000);
      };
      const actorFor = (userId: string): Actor => {
        const u = get().db.users.find((x) => x.id === userId)!;
        return { id: u.id, name: u.name, type: "user", user: u };
      };
      return {
        db: buildSeed(),
        userId: "u-owner",
        tick: 0,
        aiOpen: false,
        aiDraft: "",
        navCollapsed: false,
        setNavCollapsed: (navCollapsed) => set({ navCollapsed }),
        setUser: (id) => set({ userId: id }),
        setAiOpen: (open, draft) => set({ aiOpen: open, aiDraft: draft ?? get().aiDraft }),
        now: () => toTaipeiIso(Date.parse(DEMO_NOW) + get().tick * 23_000),
        run: (fn, success, opts) => {
          try {
            const ctx: ActCtx = { actor: actorFor(opts?.asUserId ?? get().userId), now: nextNow(), correlationId: opts?.correlationId, approvedBy: opts?.approvedBy };
            const db = fn(get().db, ctx);
            set({ db });
            if (success) toast.success(success);
            return true;
          } catch (e) {
            if (e instanceof ActionError) toast.error(e.message);
            else {
              console.error(e);
              toast.error(`發生錯誤：${(e as Error).message}`);
            }
            return false;
          }
        },
        runWith: (fn, opts) => {
          try {
            const ctx: ActCtx = { actor: actorFor(opts?.asUserId ?? get().userId), now: nextNow() };
            const { db, value } = fn(get().db, ctx);
            set({ db });
            return value;
          } catch (e) {
            toast.error((e as Error).message);
            return null;
          }
        },
        reset: () => {
          set({ db: buildSeed(), tick: 0, userId: "u-owner" });
          useStatementDrafts.getState().clearAll();
          useAutomationRules.getState().reset();
          toast.success("示範資料已重置");
        },
      };
    },
    {
      name: "kingjili-demo",
      version: SEED_VERSION,
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: (s) => ({ db: s.db, userId: s.userId, tick: s.tick, navCollapsed: s.navCollapsed }),
      migrate: () => ({ db: buildSeed(), userId: "u-owner", tick: 0 }) as unknown as Store,
    },
  ),
);

/** The whole db (stable reference until an action commits). Derive views with the memoised selectors. */
export function useDb(): Db {
  return useStore((s) => s.db);
}

export function useCurrentUser() {
  const userId = useStore((s) => s.userId);
  const users = useStore((s) => s.db.users);
  return users.find((u) => u.id === userId)!;
}
