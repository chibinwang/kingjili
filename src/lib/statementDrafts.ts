import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { DocChange } from "./domain/statementCommands";
import type { StatementDoc } from "./domain/statementDoc";
import { SEED_VERSION } from "./seed";

/** One chat turn in the statement editor. */
export interface DraftMsg {
  role: "user" | "agent";
  text: string;
  ok?: boolean;
  changes?: DocChange[];
}

interface Draft {
  doc: StatementDoc;
  /** Undo stack of earlier versions, newest last. */
  history: StatementDoc[];
}

interface DraftStore {
  drafts: Record<string, Draft>;
  chats: Record<string, DraftMsg[]>;
  save: (key: string, doc: StatementDoc, prev: StatementDoc) => void;
  undo: (key: string) => void;
  discard: (key: string) => void;
  say: (key: string, msg: DraftMsg) => void;
  clearAll: () => void;
}

export const draftKey = (customerId: string, period: string) => `${customerId}:${period}`;

/**
 * Edited copies of customer statements, kept per customer + period in this browser.
 * They only change the document sent to the customer; the ledger is never touched.
 */
export const useStatementDrafts = create<DraftStore>()(
  persist(
    (set, get) => ({
      drafts: {},
      chats: {},
      save: (key, doc, prev) => set({ drafts: { ...get().drafts, [key]: { doc, history: [...(get().drafts[key]?.history ?? []), prev].slice(-30) } } }),
      undo: (key) => {
        const d = get().drafts[key];
        if (!d?.history.length) return;
        const doc = d.history.at(-1)!;
        set({ drafts: { ...get().drafts, [key]: { doc, history: d.history.slice(0, -1) } } });
      },
      discard: (key) => {
        const drafts = { ...get().drafts };
        delete drafts[key];
        set({ drafts });
      },
      say: (key, msg) => set({ chats: { ...get().chats, [key]: [...(get().chats[key] ?? []), msg] } }),
      clearAll: () => set({ drafts: {}, chats: {} }),
    }),
    {
      name: "kingjili-statement-drafts",
      version: SEED_VERSION,
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      migrate: () => ({ drafts: {}, chats: {} }) as unknown as DraftStore,
    },
  ),
);
