"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import { useEffect, useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { formatTWD, type Cents } from "@/lib/money";

export const buttonStyles = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[9px] text-[13px] font-medium transition-[background,border,color,box-shadow] duration-150 disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/50",
  {
    variants: {
      variant: {
        primary: "bg-ink text-white hover:bg-ink-2 shadow-[0_1px_0_rgba(0,0,0,.08)]",
        accent: "bg-amber text-ink hover:bg-[#d4951a] shadow-[0_1px_0_rgba(0,0,0,.06)]",
        outline: "border border-line-strong bg-surface text-ink-2 hover:border-amber hover:text-ink",
        ghost: "text-ink-2 hover:bg-black/[.04]",
        danger: "border border-bad/30 bg-surface text-bad hover:bg-bad-soft",
        ai: "bg-ai text-white hover:bg-[#5c47b8]",
      },
      size: {
        sm: "h-8 px-2.5 text-[12.5px]",
        md: "h-9 px-3.5",
        lg: "h-11 px-5 text-[14px]",
        icon: "h-8 w-8",
      },
    },
    defaultVariants: { variant: "outline", size: "md" },
  },
);

export function Button({ className, variant, size, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonStyles>) {
  return <button className={cn(buttonStyles({ variant, size }), className)} {...props} />;
}

const badgeStyles = cva("inline-flex items-center gap-1 rounded-full px-2 py-[1px] text-[11.5px] font-medium whitespace-nowrap leading-[18px]", {
  variants: {
    tone: {
      neutral: "bg-black/[.05] text-ink-2",
      ok: "bg-ok-soft text-ok",
      warn: "bg-warn-soft text-warn",
      bad: "bg-bad-soft text-bad",
      info: "bg-info-soft text-info",
      ai: "bg-ai-soft text-ai",
      amber: "bg-amber-soft text-amber-deep",
      a: "bg-amber-soft text-[#a86b07]",
      b: "bg-truck-b-soft text-truck-b",
      outline: "border border-line-strong text-muted",
      mock: "border border-dashed border-faint/70 text-muted",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({ tone, className, children, dot }: VariantProps<typeof badgeStyles> & { className?: string; children: ReactNode; dot?: boolean }) {
  return (
    <span className={cn(badgeStyles({ tone }), className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/** The five user-visible truth states from PRD §2.5. */
export type TruthState = "confirmed" | "pending" | "ai" | "mock" | "external_off";
const TRUTH: Record<TruthState, { label: string; tone: VariantProps<typeof badgeStyles>["tone"] }> = {
  confirmed: { label: "已確認", tone: "ok" },
  pending: { label: "待審核", tone: "warn" },
  ai: { label: "AI 建議", tone: "ai" },
  mock: { label: "模擬資料", tone: "mock" },
  external_off: { label: "外部發送未啟用", tone: "mock" },
};
export function Truth({ state, className }: { state: TruthState; className?: string }) {
  const t = TRUTH[state];
  return (
    <Badge tone={t.tone} className={className} dot={state !== "mock" && state !== "external_off"}>
      {t.label}
    </Badge>
  );
}

export function VehicleTag({ v, className }: { v: "A" | "B"; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-[20px] min-w-[20px] items-center justify-center rounded-[6px] px-1 text-[11px] font-bold text-white",
        v === "A" ? "bg-truck-a" : "bg-truck-b",
        className,
      )}
    >
      {v}
    </span>
  );
}

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, sub, right, className }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start justify-between gap-3 px-5 pt-4 pb-3", className)}>
      <div className="min-w-0">
        <div className="text-[14px] font-semibold text-ink">{title}</div>
        {sub && <div className="mt-0.5 text-[12.5px] text-muted">{sub}</div>}
      </div>
      {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
    </div>
  );
}

export function PageHeader({ eyebrow, title, sub, right }: { eyebrow?: string; title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-[11.5px] font-semibold tracking-[.12em] text-faint">{eyebrow}</div>}
        <h1 className="text-[24px] leading-tight font-semibold tracking-[-0.01em] text-ink">{title}</h1>
        {sub && <div className="mt-1.5 max-w-[720px] text-[13px] text-muted">{sub}</div>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options, className, size = "md" }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; className?: string; size?: "sm" | "md" }) {
  return (
    <div className={cn("inline-flex rounded-[10px] border border-line bg-sunk p-[3px]", className)} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-[7px] font-medium transition-colors",
            size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-8 px-3.5 text-[13px]",
            value === o.value ? "bg-surface text-ink shadow-[0_1px_2px_rgba(0,0,0,.08)]" : "text-muted hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Money({ cents, className, sign, muted }: { cents: Cents; className?: string; sign?: boolean; muted?: boolean }) {
  return <span className={cn("num", cents < 0 && !muted && "text-bad", className)}>{formatTWD(cents, { sign })}</span>;
}

export function Metric({ label, value, foot, className, tone }: { label: ReactNode; value: ReactNode; foot?: ReactNode; className?: string; tone?: "bad" | "ok" | "warn" }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="text-[12px] text-muted">{label}</div>
      <div className={cn("num mt-1 text-[22px] leading-tight font-semibold tracking-[-0.01em]", tone === "bad" && "text-bad", tone === "ok" && "text-ok", tone === "warn" && "text-warn")}>{value}</div>
      {foot && <div className="mt-1 text-[12px] text-muted">{foot}</div>}
    </div>
  );
}

export function Empty({ icon, title, sub, action }: { icon?: ReactNode; title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon && <div className="mb-3 text-faint">{icon}</div>}
      <div className="text-[14px] font-medium text-ink-2">{title}</div>
      {sub && <div className="mt-1 max-w-[360px] text-[12.5px] text-muted">{sub}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
}

export function Drawer({ open, onClose, title, sub, children, footer, width = 560 }: { open: boolean; onClose: () => void; title: ReactNode; sub?: ReactNode; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEscape(open, onClose);
  const titleId = useId();
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="no-print fixed inset-0 z-50">
      <div className="absolute inset-0 animate-fade bg-ink/20 backdrop-blur-[1px]" onClick={onClose} />
      <aside role="dialog" aria-modal="true" aria-labelledby={titleId} className="absolute top-0 right-0 flex h-full max-w-full animate-slide-in flex-col border-l border-line bg-surface shadow-[var(--shadow-pop)]" style={{ width }}>
        <div className="flex items-start justify-between gap-3 border-b border-line px-6 py-4">
          <div className="min-w-0">
            <div id={titleId} className="text-[16px] font-semibold text-ink">{title}</div>
            {sub && <div className="mt-0.5 text-[12.5px] text-muted">{sub}</div>}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="關閉">
            <X size={16} />
          </Button>
        </div>
        <div className="scroll-thin flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-sunk px-6 py-3">{footer}</div>}
      </aside>
    </div>,
    document.body,
  );
}

export function Modal({ open, onClose, title, sub, children, footer, width = 760 }: { open: boolean; onClose: () => void; title: ReactNode; sub?: ReactNode; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEscape(open, onClose);
  const titleId = useId();
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="no-print fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-[6vh]">
      <div className="fixed inset-0 animate-fade bg-ink/25 backdrop-blur-[1px]" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="relative w-full animate-rise rounded-[16px] border border-line bg-surface shadow-[var(--shadow-pop)]" style={{ maxWidth: width }}>
        <div className="flex items-start justify-between gap-3 border-b border-line px-6 py-4">
          <div>
            <div id={titleId} className="text-[16px] font-semibold">{title}</div>
            {sub && <div className="mt-0.5 text-[12.5px] text-muted">{sub}</div>}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="關閉">
            <X size={16} />
          </Button>
        </div>
        <div className="px-6 py-5">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 rounded-b-[16px] border-t border-line bg-sunk px-6 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Form field. Pass `group` when it wraps several controls (segmented buttons, time ranges) so it renders a labelled group, not a <label>. */
export function Field({ label, hint, error, required, group, children, className }: { label: ReactNode; hint?: ReactNode; error?: string; required?: boolean; group?: boolean; children: ReactNode; className?: string }) {
  const id = useId();
  const Tag = group ? "div" : "label";
  return (
    <Tag className={cn("block", error && "[&_input]:border-bad [&_select]:border-bad", className)} {...(group ? { role: "group", "aria-labelledby": id } : {})}>
      <div id={id} className="mb-1 text-[12px] font-medium text-ink-2">
        {label}
        {required && <span className="ml-0.5 text-bad">*</span>}
      </div>
      {children}
      {error ? <div className="mt-1 text-[11.5px] text-bad" role="alert">{error}</div> : hint && <div className="mt-1 text-[11.5px] text-muted">{hint}</div>}
    </Tag>
  );
}

export const inputCls =
  "h-9 w-full rounded-[9px] border border-line-strong bg-surface px-3 text-[13px] text-ink placeholder:text-faint focus:border-amber focus:outline-none focus:ring-2 focus:ring-amber/20";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(inputCls, props.className)} />;
}

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cn(inputCls, "appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%236f7782%22 stroke-width=%222%22><path d=%22m6 9 6 6 6-6%22/></svg>')] bg-[right_10px_center] bg-no-repeat pr-8", className)}>
      {children}
    </select>
  );
}

export function Check({ ok, size = 14 }: { ok: boolean; size?: number }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-full text-white", ok ? "bg-ok" : "bg-bad")} style={{ width: size + 4, height: size + 4 }}>
      <svg width={size - 4} height={size - 4} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
        {ok ? <path d="M2.5 6.2 5 8.5l4.5-5" /> : <path d="M3 3l6 6M9 3l-6 6" />}
      </svg>
    </span>
  );
}

export function Bar({ value, max, className, tone = "ink" }: { value: number; max: number; className?: string; tone?: "ink" | "amber" | "bad" | "ok" | "b" }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const color = { ink: "bg-ink-2", amber: "bg-amber", bad: "bg-bad", ok: "bg-ok", b: "bg-truck-b" }[tone];
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-black/[.06]", className)}>
      <div className={cn("h-full rounded-full transition-[width] duration-500", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function DemoNote({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("inline-flex items-center gap-1.5 text-[11.5px] text-faint", className)}>{children}</div>;
}
