"use client";

import { Plus } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { can, ROLE_LABEL, rolesFor, type Permission } from "@/lib/permissions";
import { useCurrentUser } from "@/lib/store";

export interface AddItem {
  key: string;
  label: string;
  desc: string;
  icon: ReactNode;
  perm: Permission;
  onSelect: () => void;
}

/**
 * The page's single "＋". One item → the button opens it directly; several → a small menu.
 * Items the current role can't use stay visible but disabled, with the roles that can.
 */
export function AddMenu({ items }: { items: AddItem[] }) {
  const user = useCurrentUser();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const allowed = (i: AddItem) => can(user.role, i.perm);
  const need = (i: AddItem) => `需 ${rolesFor(i.perm).map((r) => ROLE_LABEL[r]).join("／")}`;

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    wrap.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')?.focus();
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const single = items.length === 1 ? items[0] : null;
  const btn = "grid h-9 w-9 place-items-center rounded-full bg-ink text-white shadow-[0_1px_2px_rgba(0,0,0,.15)] transition-colors hover:bg-ink-2 focus-visible:ring-2 focus-visible:ring-amber/50 focus-visible:outline-none disabled:opacity-40";

  if (single) {
    const ok = allowed(single);
    return (
      <button type="button" className={btn} onClick={single.onSelect} disabled={!ok} aria-label={single.label} title={ok ? single.label : `${single.label}（${need(single)}）`}>
        <Plus size={18} strokeWidth={2.4} />
      </button>
    );
  }

  const move = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const els = [...(wrap.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? [])];
    const i = els.indexOf(document.activeElement as HTMLButtonElement);
    els[(i + (e.key === "ArrowDown" ? 1 : -1) + els.length) % els.length]?.focus();
  };

  return (
    <div ref={wrap} className="relative">
      <button type="button" className={cn(btn, open && "bg-ink-2")} onClick={() => setOpen((o) => !o)} aria-label="新增" aria-haspopup="menu" aria-expanded={open} aria-controls={menuId} title="新增">
        <Plus size={18} strokeWidth={2.4} className={cn("transition-transform", open && "rotate-45")} />
      </button>
      {open && (
        <div id={menuId} role="menu" onKeyDown={move} className="absolute top-11 right-0 z-40 w-[248px] animate-rise rounded-[12px] border border-line bg-surface p-1.5 shadow-[var(--shadow-pop)]">
          {items.map((i) => {
            const ok = allowed(i);
            return (
              <button
                key={i.key}
                type="button"
                role="menuitem"
                disabled={!ok}
                onClick={() => {
                  setOpen(false);
                  i.onSelect();
                }}
                className="flex w-full items-start gap-2.5 rounded-[8px] px-2.5 py-2 text-left outline-none hover:bg-sunk focus-visible:bg-amber-wash disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="mt-0.5 text-ink-2">{i.icon}</span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-ink">{i.label}</span>
                  <span className="block text-[11.5px] text-muted">{ok ? i.desc : need(i)}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
