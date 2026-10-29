"use client";

import { Sparkles } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "./ui";

/** A button whose options stay hidden until it is hovered, focused or tapped. */
export function HoverMenu({ label, hint, items, onPick, size = "md", width = 280 }: { label: ReactNode; hint?: string; items: string[]; onPick: (item: string) => void; size?: "sm" | "md"; width?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)} onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
      <Button variant="outline" size={size} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((o) => !o)} onFocus={() => setOpen(true)}>
        {label}
      </Button>
      {open && (
        // pt-2 bridges the gap so the pointer can travel from the button into the list
        <div className="absolute top-full right-0 z-30 pt-2" style={{ width }}>
          <div role="menu" className="animate-rise overflow-hidden rounded-[12px] border border-line bg-surface p-1.5 shadow-[var(--shadow-pop)]">
            {hint && <div className="px-2.5 pt-1 pb-1.5 text-[11px] text-faint">{hint}</div>}
            {items.map((c) => (
              <button
                key={c}
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onPick(c);
                }}
                className="flex w-full items-start gap-2 rounded-[8px] px-2.5 py-2 text-left text-[13px] text-ink-2 hover:bg-ai-soft hover:text-ai focus:bg-ai-soft focus:text-ai focus:outline-none"
              >
                <Sparkles size={13} className="mt-[3px] shrink-0 text-ai/70" /> {c}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
