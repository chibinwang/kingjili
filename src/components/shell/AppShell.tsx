"use client";

import {
  Bell,
  ClipboardList,
  FileText,
  History,
  LayoutDashboard,
  Menu,
  PackagePlus,
  PanelLeftClose,
  PanelLeftOpen,
  Receipt,
  Search,
  Settings,
  Snowflake,
  Sparkles,
  Truck,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { ROLE_LABEL } from "@/lib/permissions";
import { auditFor, routeView, stockPositions } from "@/lib/selectors";
import { useCurrentUser, useDb, useStore } from "@/lib/store";
import { useEscalations } from "../ai/RulesPanel";
import { TodayTasksButton, useTodayTasks } from "../TodayTasks";
import { DEMO_TODAY, formatDate, periodOf, timePart } from "@/lib/time";
import { AiDrawer } from "./AiDrawer";
import { Hydrator } from "./Hydrator";

export const NAV = [
  { href: "/", label: "總覽", icon: LayoutDashboard },
  { href: "/orders", label: "訂單", icon: ClipboardList },
  { href: "/dispatch", label: "今日配送", icon: Truck },
  { href: "/inventory", label: "庫存與凍庫", icon: Snowflake },
  { href: "/procurement", label: "採購", icon: PackagePlus },
  { href: "/customers", label: "客戶與應收", icon: Users },
  { href: "/accounting", label: "帳單與會計", icon: Receipt },
  { href: "/invoices", label: "電子發票", icon: FileText },
  { href: "/ai", label: "AI 工作台", icon: Sparkles },
  { href: "/activity", label: "操作紀錄", icon: History },
  { href: "/settings", label: "設定", icon: Settings },
] as const;

function useBadges() {
  const db = useDb();
  return useMemo(() => {
    const drafts = db.orders.filter((o) => o.state === "Draft").length + db.inbox.filter((m) => m.status === "new").length;
    const tasks = db.aiTasks.filter((t) => t.status === "awaiting_approval").length;
    const route = routeView(db)?.suggestion ? 1 : 0;
    const low = [...stockPositions(db).values()].filter((p) => p.belowReorder || p.expired > 0).length;
    const flags = auditFor(db, periodOf(DEMO_TODAY)).reduce((a, c) => a + c.flags.length, 0);
    const invoices = db.invoices.filter((i) => ["staged", "preflight_failed", "rejected", "ready"].includes(i.providerStatus)).length;
    return { "/orders": drafts, "/ai": tasks, "/dispatch": route, "/inventory": low, "/accounting": flags, "/invoices": invoices } as Record<string, number>;
  }, [db]);
}

function Sidebar({ onNavigate, collapsed = false }: { onNavigate?: () => void; collapsed?: boolean }) {
  const path = usePathname();
  const badges = useBadges();
  return (
    <nav className="flex h-full flex-col">
      <div className={cn("flex pt-5 pb-6", collapsed ? "flex-col items-center gap-2" : "items-center justify-between pr-3 pl-5")}>
        <Link href="/" className="flex items-center gap-2.5" onClick={onNavigate} aria-label={collapsed ? "金吉利營運中心・總覽" : undefined}>
          <BrandMark />
          {!collapsed && (
            <div className="leading-tight">
              <div className="text-[15px] font-semibold tracking-[.02em] text-ink">金吉利營運中心</div>
              <div className="text-[10.5px] font-medium tracking-[.16em] text-faint">EVERYSE ERP</div>
            </div>
          )}
        </Link>
        {/* the mobile drawer has its own close button */}
        {!onNavigate && <CollapseToggle collapsed={collapsed} />}
      </div>
      <div className={cn("scroll-thin flex-1 space-y-0.5 overflow-y-auto", collapsed ? "px-2" : "px-3")}>
        {NAV.map((n, i) => {
          const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
          const b = badges[n.href];
          return (
            <div key={n.href}>
              {(i === 1 || i === 5 || i === 8) && <div className={cn("my-2.5 h-px bg-line", collapsed ? "mx-2" : "mx-3")} />}
              <Link
                href={n.href}
                onClick={onNavigate}
                title={collapsed ? (b ? `${n.label}（${b}）` : n.label) : undefined}
                aria-label={collapsed ? n.label : undefined}
                className={cn(
                  "group relative flex h-9 items-center rounded-[9px] text-[13.5px] transition-colors",
                  collapsed ? "justify-center" : "gap-3 px-3",
                  active ? "bg-surface font-semibold text-ink shadow-[0_1px_2px_rgba(0,0,0,.06)]" : "text-ink-2 hover:bg-black/[.035]",
                )}
              >
                {active && <span className="absolute top-2 bottom-2 left-0 w-[3px] rounded-full bg-amber" />}
                <n.icon size={16} strokeWidth={active ? 2.2 : 1.8} className={cn(active ? "text-amber-deep" : "text-faint group-hover:text-ink-2", n.href === "/ai" && "text-ai")} />
                {collapsed ? (
                  b ? <span className={cn("num absolute top-0.5 right-1 grid h-[15px] min-w-[15px] place-items-center rounded-full px-[3px] text-[9.5px] font-semibold", n.href === "/ai" ? "bg-ai text-white" : n.href === "/accounting" ? "bg-bad text-white" : "bg-amber text-ink")}>{b}</span> : null
                ) : (
                  <span className="flex-1">{n.label}</span>
                )}
                {!collapsed && b ? (
                  <span className={cn("num rounded-full px-1.5 text-[10.5px] leading-[17px] font-semibold", n.href === "/ai" ? "bg-ai text-white" : n.href === "/accounting" ? "bg-bad-soft text-bad" : "bg-amber-soft text-amber-deep")}>{b}</span>
                ) : null}
              </Link>
            </div>
          );
        })}
      </div>
      {!collapsed && (
        <div className="m-3 rounded-[12px] border border-dashed border-line-strong bg-sunk/70 p-3 text-[11.5px] leading-relaxed text-muted">
          <div className="mb-0.5 font-semibold text-ink-2">示範模式</div>
          所有數字、客戶與金額均為示範資料；LINE、綠界、ECOUNT 皆為模擬連接，不會對外發送。
        </div>
      )}
    </nav>
  );
}

/** Icon-only button that folds the desktop sidebar down to icons and back. */
function CollapseToggle({ collapsed }: { collapsed: boolean }) {
  const setNavCollapsed = useStore((s) => s.setNavCollapsed);
  const label = collapsed ? "展開側邊欄" : "收合側邊欄";
  return (
    <button onClick={() => setNavCollapsed(!collapsed)} aria-label={label} title={label} aria-expanded={!collapsed} className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] text-faint hover:bg-black/[.05] hover:text-ink-2">
      {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
    </button>
  );
}

export function BrandMark({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <rect x="1" y="1" width="38" height="38" rx="11" fill="#1b2430" />
      <path d="M20 8 30.4 14v12L20 32 9.6 26V14Z" fill="none" stroke="#e0a020" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M20 8v24M9.6 14 30.4 26M30.4 14 9.6 26" stroke="#e0a020" strokeWidth="1.2" opacity=".55" />
      <circle cx="20" cy="20" r="3.2" fill="#e0a020" />
    </svg>
  );
}

function GlobalSearch() {
  const db = useDb();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  const results = useMemo(() => {
    const t = q.trim();
    if (!t) return [];
    const out: { label: string; sub: string; href: string }[] = [];
    for (const c of db.customers) if (c.name.includes(t) || c.code.toLowerCase().includes(t.toLowerCase())) out.push({ label: c.name, sub: `客戶 · ${c.code}`, href: `/customers?id=${c.id}` });
    for (const p of db.products) if (p.name.includes(t) || p.sku.toLowerCase().includes(t.toLowerCase())) out.push({ label: `${p.sku} ${p.name}`, sub: `品項 · 凍庫 ${p.zone}`, href: `/inventory?sku=${p.id}` });
    for (const o of db.orders) if (o.no.toLowerCase().includes(t.toLowerCase())) out.push({ label: o.no, sub: `訂單 · ${o.deliveryDate}`, href: `/orders?id=${o.id}` });
    for (const d of db.arDocs) if (d.no.toLowerCase().includes(t.toLowerCase())) out.push({ label: d.no, sub: "應收文件", href: `/customers?id=${d.customerId}` });
    return out.slice(0, 8);
  }, [q, db]);
  return (
    <div className="relative w-full max-w-[340px]">
      <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
      <input
        ref={ref}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="搜尋客戶、品項、訂單、單號"
        className="h-9 w-full rounded-[10px] border border-line bg-sunk pr-9 pl-9 text-[13px] placeholder:text-faint focus:border-amber focus:bg-surface focus:outline-none"
      />
      <kbd className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 rounded border border-line bg-surface px-1.5 text-[10.5px] text-faint">/</kbd>
      {open && results.length > 0 && (
        <div className="absolute top-11 left-0 z-40 w-full animate-rise overflow-hidden rounded-[12px] border border-line bg-surface shadow-[var(--shadow-pop)]">
          {results.map((r) => (
            <button
              key={r.href + r.label}
              className="flex w-full items-center justify-between px-3.5 py-2 text-left hover:bg-amber-wash"
              onMouseDown={() => {
                router.push(r.href);
                setQ("");
              }}
            >
              <span className="text-[13px] text-ink">{r.label}</span>
              <span className="text-[11.5px] text-faint">{r.sub}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function UserSwitcher() {
  const db = useDb();
  const user = useCurrentUser();
  const setUser = useStore((s) => s.setUser);
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-[10px] py-1 pr-2 pl-1 hover:bg-black/[.04]">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-amber-soft text-[13px] font-semibold text-amber-deep">{user.name.slice(0, 1)}</span>
        <span className="hidden text-left leading-tight sm:block">
          <span className="block text-[12.5px] font-semibold text-ink">{user.name}</span>
          <span className="block text-[11px] text-muted">{ROLE_LABEL[user.role]}</span>
        </span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute top-12 right-0 z-40 w-[250px] animate-rise overflow-hidden rounded-[12px] border border-line bg-surface p-1.5 shadow-[var(--shadow-pop)]">
            <div className="px-2.5 pt-1.5 pb-2 text-[11px] text-faint">切換示範身分（權限會跟著改變）</div>
            {db.users.map((u) => (
              <button
                key={u.id}
                onClick={() => {
                  setUser(u.id);
                  setOpen(false);
                }}
                className={cn("flex w-full items-center justify-between rounded-[8px] px-2.5 py-1.5 text-left text-[13px] hover:bg-amber-wash", u.id === user.id && "bg-amber-soft/60")}
              >
                <span>{u.name}</span>
                <span className="text-[11.5px] text-muted">{u.title}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The bell is for things to know; anything someone has to act on lives in 今日任務.
 * An alert is left out while a pending AI proposal or an automation rule already covers it,
 * and comes back on its own once that proposal is gone or the rule is switched off.
 */
function Alerts() {
  const db = useDb();
  const [open, setOpen] = useState(false);
  const { pending } = useTodayTasks();
  const { escalated, handled } = useEscalations();
  const items = useMemo(() => {
    const out: { label: string; href: string; tone: string }[] = [];
    const reorderCovered = new Set(pending.filter((t) => t.kind === "reorder_draft").flatMap((t) => (t.payload as { lines?: { productId: string }[] }).lines?.map((l) => l.productId) ?? []));
    const reorderTask = pending.some((t) => t.kind === "reorder_draft");
    const pos = stockPositions(db);
    for (const p of db.products) {
      const s = pos.get(p.id)!;
      if (s.expired) out.push({ label: `${p.name} 有 ${s.expired} ${p.baseUnit} 已過期，不可配貨`, href: "/inventory", tone: "bad" });
      // an older reorder proposal without line detail covers every item below its reorder point
      else if (s.belowReorder && !reorderCovered.has(p.id) && !(reorderTask && reorderCovered.size === 0)) out.push({ label: `${p.name} 預估可用量低於補貨點`, href: "/procurement", tone: "warn" });
    }
    const ruled = new Set([...escalated, ...handled].filter((o) => o.rule.kind === "audit_flag").map((o) => o.subject));
    const flags = auditFor(db, periodOf(DEMO_TODAY)).flatMap((c) => c.flags).filter((f) => !ruled.has(f.title));
    if (flags.length) out.push({ label: `本月對帳審查有 ${flags.length} 個旗標`, href: "/accounting?tab=review", tone: "bad" });
    const late = routeView(db)?.evaluation.routes;
    const lateCount = late ? late.A.stops.filter((s) => s.late).length + late.B.stops.filter((s) => s.late).length : 0;
    if (lateCount && !pending.some((t) => t.kind === "route_reassign")) out.push({ label: `今日路線有 ${lateCount} 站預估超出收貨時段`, href: "/dispatch", tone: "warn" });
    if (handled.length) out.push({ label: `自動化規則已處理 ${handled.length} 件（模擬）：${handled.map((h) => h.subject).join("、")}`, href: "/ai?tab=rules", tone: "ok" });
    return out;
  }, [db, pending, escalated, handled]);
  const count = items.filter((it) => it.tone !== "ok").length;
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open]);
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="relative grid h-9 w-9 place-items-center rounded-[10px] text-ink-2 hover:bg-black/[.04]" aria-label="提醒">
        <Bell size={17} />
        {count > 0 && <span className="num absolute top-1 right-1 grid h-4 min-w-4 place-items-center rounded-full bg-bad px-1 text-[10px] font-semibold text-white">{count}</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute top-12 right-0 z-40 w-[330px] animate-rise overflow-hidden rounded-[12px] border border-line bg-surface shadow-[var(--shadow-pop)]">
            <div className="border-b border-line px-4 py-2.5">
              <div className="text-[12.5px] font-semibold">提醒</div>
              <div className="text-[11.5px] text-muted">知道就好；需要你處理的事在「今日任務」</div>
            </div>
            {items.length === 0 && <div className="px-4 py-5 text-center text-[12.5px] text-muted">目前沒有新的提醒</div>}
            {items.map((it, i) => (
              <Link key={i} href={it.href} onClick={() => setOpen(false)} className="flex items-start gap-2.5 px-4 py-2.5 text-[12.5px] hover:bg-amber-wash">
                <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", it.tone === "bad" ? "bg-bad" : it.tone === "ok" ? "bg-ok" : "bg-warn")} />
                {it.label}
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Topbar({ onMenu }: { onMenu: () => void }) {
  const path = usePathname();
  useStore((s) => s.tick);
  const now = useStore.getState().now();
  const setAiOpen = useStore((s) => s.setAiOpen);
  const current = NAV.find((n) => (n.href === "/" ? path === "/" : path.startsWith(n.href)));
  return (
    <header className="no-print sticky top-0 z-20 flex h-[60px] items-center gap-3 border-b border-line bg-paper/85 px-4 backdrop-blur-md md:px-8">
      <button className="grid h-9 w-9 place-items-center rounded-[10px] hover:bg-black/[.04] lg:hidden" onClick={onMenu} aria-label="選單">
        <Menu size={18} />
      </button>
      <div className="hidden min-w-[150px] text-[12.5px] text-muted md:block">
        <span className="text-ink-2">{formatDate(DEMO_TODAY, { year: true, weekday: true })}</span>
        <span className="num ml-2 text-faint">{timePart(now)}</span>
        {current && <span className="ml-3 hidden text-faint xl:inline">／ {current.label}</span>}
      </div>
      <div className="flex flex-1 justify-center">
        <GlobalSearch />
      </div>
      <span className="hidden items-center gap-1.5 rounded-full border border-dashed border-amber/60 bg-amber-wash px-2.5 py-1 text-[11.5px] font-medium text-amber-deep sm:inline-flex">
        <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-amber" />
        示範模式・離線
      </span>
      <button onClick={() => setAiOpen(true)} aria-label="問 AI" className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-ai-soft px-3 text-[12.5px] font-semibold text-ai hover:bg-[#e6e1f8]">
        <Sparkles size={15} /> <span className="hidden sm:inline">問 AI</span>
      </button>
      <TodayTasksButton />
      <Alerts />
      <UserSwitcher />
    </header>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileNav, setMobileNav] = useState(false);
  const navCollapsed = useStore((s) => s.navCollapsed);
  return (
    <Hydrator>
      <div className="flex min-h-screen">
        <aside className={cn("no-print sticky top-0 hidden h-screen shrink-0 overflow-hidden border-r border-line bg-paper transition-[width] duration-200 lg:block", navCollapsed ? "w-[64px]" : "w-[236px]")}>
          <Sidebar collapsed={navCollapsed} />
        </aside>
        {mobileNav && (
          <div className="no-print fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-ink/25" onClick={() => setMobileNav(false)} />
            <aside className="absolute inset-y-0 left-0 w-[260px] animate-slide-in border-r border-line bg-paper">
              <button className="absolute top-4 right-3 grid h-8 w-8 place-items-center rounded-lg hover:bg-black/5" onClick={() => setMobileNav(false)} aria-label="關閉">
                <X size={16} />
              </button>
              <Sidebar onNavigate={() => setMobileNav(false)} />
            </aside>
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar onMenu={() => setMobileNav(true)} />
          <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 pt-7 pb-16 md:px-8">{children}</main>
        </div>
        <AiDrawer />
      </div>
    </Hydrator>
  );
}
