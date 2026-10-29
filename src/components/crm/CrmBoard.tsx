"use client";

import { ArrowDown, ArrowUp, CalendarClock, ChevronLeft, ChevronRight, LayoutGrid, Link2, List, Phone, Search, TriangleAlert, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useSyncExternalStore } from "react";
import { Badge, Button, Card, Drawer, Empty, Field, Input, Money, Segmented, Select } from "@/components/ui";
import { addCustomerNote } from "@/lib/actions";
import { cn } from "@/lib/cn";
import { TERMS_LABEL } from "@/lib/domain/ar";
import { CRM_STATUS_LABEL, NOTE_KIND_LABEL, tenureLabel, type CrmRow } from "@/lib/domain/crm";
import type { Customer, CustomerNote, CustomerSegment } from "@/lib/domain/types";
import { formatTWD } from "@/lib/money";
import { crmRows, maps } from "@/lib/selectors";
import { useDb, useStore } from "@/lib/store";
import { addDays, DEMO_TODAY, formatDate, formatDateTime } from "@/lib/time";

type View = "card" | "list";
type Seg = "all" | CustomerSegment;
type SortKey = "name" | "tenure" | "revenue" | "balance";
interface Item {
  c: Customer;
  r: CrmRow;
}

const SEG_TONE: Record<CustomerSegment, "amber" | "info"> = { 炸物店: "amber", 餐廳: "info" };
const SORT_LABEL: Record<SortKey, string> = { name: "客戶名稱", tenure: "合作年資", revenue: "近 30 天營業額", balance: "應收餘額" };
const PRICE_LABEL = { standard: "一般價", volume: "量販價", vip: "VIP 價" } as const;
const VIEW_KEY = "kingjili-crm-view";

function readSavedView(): View | null {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === "card" || v === "list" ? v : null;
  } catch {
    return null;
  }
}

const noopSubscribe = () => () => {};

export function CrmBoard() {
  const db = useDb();
  const router = useRouter();
  const params = useSearchParams();
  const rows = crmRows(db);
  const items = useMemo<Item[]>(() => db.customers.map((c, i) => ({ c, r: rows[i] })), [db.customers, rows]);

  // Server render has no localStorage; the saved choice applies right after hydration.
  const savedView = useSyncExternalStore(noopSubscribe, readSavedView, () => null);
  const view: View = (params.get("view") as View) ?? savedView ?? "card";
  const seg = (params.get("seg") as Seg) ?? "all";
  const [q, setQ] = useState("");
  const [district, setDistrict] = useState("all");
  const [terms, setTerms] = useState("all");
  const [quick, setQuick] = useState<"none" | "attention" | "followup">("none");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "name", dir: 1 });

  const setParam = (k: string, v: string | null) => {
    const p = new URLSearchParams(params.toString());
    p.set("tab", "crm");
    if (v === null) p.delete(k);
    else p.set(k, v);
    router.replace(`/customers?${p.toString()}`, { scroll: false });
  };
  const openId = params.get("open");
  const setOpenId = (id: string | null) => setParam("open", id);
  const setView = (v: View) => {
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* per-viewer convenience only */
    }
    setParam("view", v);
  };

  const weekEnd = addDays(DEMO_TODAY, 7);
  const isFollowUp = (r: CrmRow) => !!r.nextFollowUp && r.nextFollowUp <= weekEnd;
  const districts = [...new Set(db.customers.map((c) => c.district))].sort();
  const segCount = (s: Seg) => items.filter((x) => s === "all" || x.c.segment === s).length;

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    const val = (x: Item): string | number => (sort.key === "name" ? x.c.name : sort.key === "tenure" ? x.r.tenureMonths : sort.key === "revenue" ? x.r.revenue30 : x.r.balance);
    return items
      .filter((x) => seg === "all" || x.c.segment === seg)
      .filter((x) => district === "all" || x.c.district === district)
      .filter((x) => terms === "all" || x.c.settlementTerms === terms)
      .filter((x) => quick === "none" || (quick === "attention" ? x.r.status === "attention" : isFollowUp(x.r)))
      .filter((x) => !term || [x.c.name, x.c.ownerName, x.c.contactName, x.c.phone, x.c.code, x.c.subType].some((f) => f.toLowerCase().includes(term)))
      .sort((a, b) => {
        const va = val(a);
        const vb = val(b);
        return (typeof va === "string" ? va.localeCompare(vb as string, "zh-Hant-TW") : va - (vb as number)) * sort.dir;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, seg, district, terms, quick, q, sort]);

  const filtered = district !== "all" || terms !== "all" || quick !== "none" || q.trim() !== "";
  const clear = () => {
    setQ("");
    setDistrict("all");
    setTerms("all");
    setQuick("none");
  };
  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "name" ? 1 : -1 }));
  const openIdx = shown.findIndex((x) => x.c.id === openId);
  const open = openId ? items.find((x) => x.c.id === openId) : undefined;
  const avgTenure = items.length ? Math.round(items.reduce((a, x) => a + x.r.tenureMonths, 0) / items.length) : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryTile label="客戶總數" value={`${items.length} 家`} foot={`餐廳 ${segCount("餐廳")}・炸物店 ${segCount("炸物店")}`} />
        <SummaryTile label="平均合作年資" value={tenureLabel(avgTenure)} foot={`最久：${[...items].sort((a, b) => b.r.tenureMonths - a.r.tenureMonths)[0]?.c.name ?? "—"}`} />
        <SummaryTile label="需關注" value={`${items.filter((x) => x.r.status === "attention").length} 家`} foot="逾期帳款或叫貨下滑" tone="warn" active={quick === "attention"} onClick={() => setQuick(quick === "attention" ? "none" : "attention")} />
        <SummaryTile label="7 天內追蹤" value={`${items.filter((x) => isFollowUp(x.r)).length} 家`} foot="依往來紀錄的追蹤日" tone="info" active={quick === "followup"} onClick={() => setQuick(quick === "followup" ? "none" : "followup")} />
      </div>

      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋名稱、負責人、電話、代號" className="pl-8" aria-label="搜尋客戶" />
          </div>
          <Segmented
            value={seg}
            onChange={(v) => setParam("seg", v === "all" ? null : v)}
            options={(["all", "餐廳", "炸物店"] as Seg[]).map((s) => ({ value: s, label: `${s === "all" ? "全部" : s} ${segCount(s)}` }))}
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Select value={district} onChange={(e) => setDistrict(e.target.value)} className="h-8 w-[110px] text-[12.5px]" aria-label="地區">
            <option value="all">全部地區</option>
            {districts.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </Select>
          <Select value={terms} onChange={(e) => setTerms(e.target.value)} className="h-8 w-[110px] text-[12.5px]" aria-label="結帳方式">
            <option value="all">全部結帳</option>
            {Object.entries(TERMS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <Select value={`${sort.key}:${sort.dir}`} onChange={(e) => setSort({ key: e.target.value.split(":")[0] as SortKey, dir: Number(e.target.value.split(":")[1]) as 1 | -1 })} className="h-8 w-[150px] text-[12.5px]" aria-label="排序">
            {(Object.keys(SORT_LABEL) as SortKey[]).flatMap((k) => [
              <option key={`${k}1`} value={`${k}:${k === "name" ? 1 : -1}`}>
                {SORT_LABEL[k]}
                {k === "name" ? "" : "（高→低）"}
              </option>,
              <option key={`${k}2`} value={`${k}:${k === "name" ? -1 : 1}`}>
                {SORT_LABEL[k]}
                {k === "name" ? "（反序）" : "（低→高）"}
              </option>,
            ])}
          </Select>
          {filtered && (
            <button onClick={clear} className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[12.5px] text-muted hover:text-ink">
              <X size={13} /> 清除篩選
            </button>
          )}
          <span className="ml-auto text-[12px] text-muted">顯示 {shown.length} 家</span>
          <Segmented
            size="sm"
            value={view}
            onChange={setView}
            options={[
              { value: "card", label: <span className="inline-flex items-center gap-1" aria-label="卡片檢視"><LayoutGrid size={14} /> 卡片</span> },
              { value: "list", label: <span className="inline-flex items-center gap-1" aria-label="列表檢視"><List size={14} /> 列表</span> },
            ]}
          />
        </div>
      </Card>

      {shown.length === 0 ? (
        <Card>
          <Empty icon={<Search size={28} />} title="沒有符合條件的客戶" sub="換個關鍵字，或清除篩選條件。" action={<Button variant="outline" onClick={clear}>清除篩選</Button>} />
        </Card>
      ) : view === "card" ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" data-testid="crm-cards">
          {shown.map((x) => (
            <CustomerCard key={x.c.id} item={x} onOpen={() => setOpenId(x.c.id)} />
          ))}
        </div>
      ) : (
        <CustomerList items={shown} sort={sort} onSort={toggleSort} onOpen={setOpenId} />
      )}

      {open && (
        <CustomerPanel
          key={open.c.id}
          item={open}
          onClose={() => setOpenId(null)}
          onPrev={openIdx > 0 ? () => setOpenId(shown[openIdx - 1].c.id) : undefined}
          onNext={openIdx >= 0 && openIdx < shown.length - 1 ? () => setOpenId(shown[openIdx + 1].c.id) : undefined}
          onAr={() => router.push(`/customers?tab=ar&id=${open.c.id}`, { scroll: false })}
        />
      )}
    </div>
  );
}

function SummaryTile({ label, value, foot, tone, active, onClick }: { label: string; value: string; foot: string; tone?: "warn" | "info"; active?: boolean; onClick?: () => void }) {
  const body = (
    <>
      <div className="text-[12px] text-muted">{label}</div>
      <div className={cn("num mt-0.5 text-[20px] font-semibold", tone === "warn" && "text-warn", tone === "info" && "text-info")}>{value}</div>
      <div className="truncate text-[11.5px] text-faint">{foot}</div>
    </>
  );
  const cls = cn("rounded-xl border bg-surface px-4 py-3 text-left", active ? "border-amber ring-2 ring-amber/25" : "border-line");
  return onClick ? (
    <button onClick={onClick} aria-pressed={active} className={cn(cls, "transition-colors hover:border-line-strong")}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function SegBadge({ c }: { c: Customer }) {
  return (
    <Badge tone={SEG_TONE[c.segment]}>
      {c.segment}・{c.subType}
    </Badge>
  );
}

function StatusDot({ r }: { r: CrmRow }) {
  return (
    <span className={cn("inline-flex items-center gap-1 text-[11.5px]", r.status === "attention" ? "text-warn" : "text-ok")}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {CRM_STATUS_LABEL[r.status]}
    </span>
  );
}

function Avatar({ c, size = 40 }: { c: Customer; size?: number }) {
  return (
    <div
      className={cn("grid shrink-0 place-items-center rounded-xl font-semibold", c.segment === "炸物店" ? "bg-amber-soft text-amber-deep" : "bg-info-soft text-info")}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      aria-hidden
    >
      {c.name.slice(0, 1)}
    </div>
  );
}

function Spark({ values, className }: { values: number[]; className?: string }) {
  const max = Math.max(1, ...values);
  return (
    <div className={cn("flex h-6 items-end gap-[2px]", className)} aria-hidden>
      {values.map((v, i) => (
        <div key={i} className={cn("w-[5px] rounded-[1.5px]", i === values.length - 1 ? "bg-amber" : "bg-line-strong")} style={{ height: `${Math.max(8, (v / max) * 100)}%` }} />
      ))}
    </div>
  );
}

function Trend({ bp }: { bp: number | null }) {
  if (bp === null) return null;
  const pct = Math.round(bp / 100);
  return <span className={cn("num text-[11px]", pct <= -30 ? "text-bad" : pct < 0 ? "text-muted" : "text-ok")}>{pct > 0 ? `▲${pct}%` : pct < 0 ? `▼${-pct}%` : "持平"}</span>;
}

function Tenure({ c, r, className }: { c: Customer; r: CrmRow; className?: string }) {
  return (
    <span className={className}>
      <span className="num">{formatDate(c.onboardedAt, { year: true })}</span>
      <span className="text-muted">・合作 {tenureLabel(r.tenureMonths)}</span>
    </span>
  );
}

function CustomerCard({ item: { c, r }, onOpen }: { item: Item; onOpen: () => void }) {
  return (
    <Card className="group flex flex-col transition-shadow hover:shadow-[var(--shadow-pop)]">
      <button onClick={onOpen} className="flex flex-1 flex-col text-left" aria-label={`開啟 ${c.name}`}>
        <div className="flex items-start gap-3 px-4 pt-4">
          <Avatar c={c} />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="truncate text-[15px] font-semibold text-ink group-hover:text-amber-deep">{c.name}</div>
              <StatusDot r={r} />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted">
              <SegBadge c={c} />
              <span className="num">{c.code}</span>・<span>{c.district}</span>
            </div>
          </div>
        </div>
        <dl className="mx-4 mt-3 grid grid-cols-[64px_1fr] gap-x-2 gap-y-1.5 border-t border-line pt-3 text-[12.5px]">
          <dt className="text-muted">負責人</dt>
          <dd className="font-medium text-ink">{c.ownerName}</dd>
          <dt className="text-muted">聯絡電話</dt>
          <dd className="num text-ink">{c.phone}</dd>
          <dt className="text-muted">往來起始</dt>
          <dd>
            <Tenure c={c} r={r} />
          </dd>
        </dl>
        <div className="mx-4 mt-3 grid grid-cols-2 gap-2 rounded-lg bg-sunk px-3 py-2.5">
          <div className="min-w-0">
            <div className="text-[11px] text-muted">近 30 天營業額</div>
            <div className="flex items-end justify-between gap-1">
              <div>
                <Money cents={r.revenue30} className="text-[14px] font-semibold" /> <Trend bp={r.trendBp} />
              </div>
              <Spark values={r.weekly} />
            </div>
          </div>
          <div className="min-w-0 border-l border-line pl-3">
            <div className="text-[11px] text-muted">應收餘額</div>
            <Money cents={r.balance} className="text-[14px] font-semibold" />
            <div className="text-[11px] text-faint">
              {TERMS_LABEL[c.settlementTerms]}・{r.lastOrderDate ? `每週 ${r.ordersPerWeek} 次` : "尚無訂單"}
            </div>
          </div>
        </div>
        <div className="mt-auto flex min-h-[38px] flex-wrap items-center gap-1.5 px-4 pt-2.5 pb-3 text-[11.5px]">
          {r.overdue > 0 && (
            <Badge tone="bad">
              <TriangleAlert size={11} /> 逾期 {formatTWD(r.overdue)}
            </Badge>
          )}
          {r.reasons.filter((x) => x !== "有逾期帳款").map((x) => (
            <Badge key={x} tone="warn">
              {x}
            </Badge>
          ))}
          {r.nextFollowUp && (
            <Badge tone="info">
              <CalendarClock size={11} /> {formatDate(r.nextFollowUp)} 追蹤
            </Badge>
          )}
          {!r.lastOrderDate && <Badge tone="ok">新客戶</Badge>}
          {c.geoPending && <Badge tone="outline">座標待確認</Badge>}
          {c.linkStatus !== "linked" && <Badge tone="outline">LINE {c.linkStatus === "pending" ? "綁定中" : "未綁定"}</Badge>}
        </div>
      </button>
    </Card>
  );
}

function SortTh({ k, children, right, sort, onSort }: { k: SortKey; children: string; right?: boolean; sort: { key: SortKey; dir: 1 | -1 }; onSort: (k: SortKey) => void }) {
  return (
    <th className={cn(right && "r")} aria-sort={sort.key === k ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
      <button onClick={() => onSort(k)} className={cn("inline-flex items-center gap-0.5 hover:text-ink", sort.key === k && "text-ink")}>
        {children}
        {sort.key === k && (sort.dir === 1 ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
      </button>
    </th>
  );
}

function CustomerList({ items, sort, onSort, onOpen }: { items: Item[]; sort: { key: SortKey; dir: 1 | -1 }; onSort: (k: SortKey) => void; onOpen: (id: string) => void }) {
  return (
    <Card className="overflow-hidden">
      {/* phones: compact two-line rows instead of a sideways-scrolling table */}
      <ul className="divide-y divide-line md:hidden" data-testid="crm-list-compact">
        {items.map(({ c, r }) => (
          <li key={c.id}>
            <button onClick={() => onOpen(c.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-amber-wash">
              <Avatar c={c} size={34} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[14px] font-medium">{c.name}</span>
                  <Money cents={r.balance} className="text-[13px]" />
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2 text-[12px] text-muted">
                  <span className="truncate">
                    {c.ownerName}・<span className="num">{c.phone}</span>
                  </span>
                  <span className="shrink-0">{c.segment}・{tenureLabel(r.tenureMonths)}</span>
                </div>
              </div>
            </button>
          </li>
        ))}
      </ul>
      <div className="scroll-thin hidden overflow-x-auto md:block">
        <table className="tbl" data-testid="crm-table">
          <thead className="sticky top-0 z-[1] bg-surface">
            <tr>
              <SortTh k="name" sort={sort} onSort={onSort}>客戶</SortTh>
              <th>類型</th>
              <th>負責人</th>
              <th>聯絡電話</th>
              <SortTh k="tenure" sort={sort} onSort={onSort}>往來起始・年資</SortTh>
              <th>地區</th>
              <th>結帳</th>
              <SortTh k="revenue" right sort={sort} onSort={onSort}>
                近 30 天
              </SortTh>
              <SortTh k="balance" right sort={sort} onSort={onSort}>
                應收／逾期
              </SortTh>
              <th>狀態</th>
            </tr>
          </thead>
          <tbody>
            {items.map(({ c, r }) => (
              <tr key={c.id} className="row-hover cursor-pointer" onClick={() => onOpen(c.id)}>
                <td>
                  <button className="text-left font-medium hover:text-amber-deep" onClick={() => onOpen(c.id)}>
                    {c.name}
                  </button>
                  <div className="num text-[11px] text-faint">{c.code}</div>
                </td>
                <td>
                  <SegBadge c={c} />
                </td>
                <td>{c.ownerName}</td>
                <td className="num whitespace-nowrap">{c.phone}</td>
                <td className="whitespace-nowrap text-[12.5px]">
                  <div className="num">{formatDate(c.onboardedAt, { year: true })}</div>
                  <div className="text-[11.5px] text-muted">{tenureLabel(r.tenureMonths)}</div>
                </td>
                <td>{c.district}</td>
                <td className="whitespace-nowrap">{TERMS_LABEL[c.settlementTerms]}</td>
                <td className="r whitespace-nowrap">
                  <Money cents={r.revenue30} />
                  <div>
                    <Trend bp={r.trendBp} />
                  </div>
                </td>
                <td className="r whitespace-nowrap">
                  <Money cents={r.balance} />
                  {r.overdue > 0 && <div className="num text-[11.5px] text-bad">逾期 {formatTWD(r.overdue)}</div>}
                </td>
                <td>
                  <StatusDot r={r} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function CustomerPanel({ item: { c, r }, onClose, onPrev, onNext, onAr }: { item: Item; onClose: () => void; onPrev?: () => void; onNext?: () => void; onAr: () => void }) {
  const db = useDb();
  const [tab, setTab] = useState<"overview" | "orders" | "notes">("overview");
  const manager = db.users.find((u) => u.id === c.accountManagerId);
  const notes = db.crmNotes.filter((n) => n.customerId === c.id).sort((a, b) => b.at.localeCompare(a.at));
  return (
    <Drawer
      open
      onClose={onClose}
      width={600}
      title={
        <div className="flex items-center gap-3">
          <Avatar c={c} size={36} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {c.name} <SegBadge c={c} /> <StatusDot r={r} />
            </div>
            <div className="text-[12px] font-normal text-muted">
              {c.code}・{c.district}・合作 {tenureLabel(r.tenureMonths)}
            </div>
          </div>
        </div>
      }
      footer={
        <>
          <div className="mr-auto flex gap-1">
            <Button size="icon" variant="ghost" disabled={!onPrev} onClick={onPrev} aria-label="上一位客戶">
              <ChevronLeft size={16} />
            </Button>
            <Button size="icon" variant="ghost" disabled={!onNext} onClick={onNext} aria-label="下一位客戶">
              <ChevronRight size={16} />
            </Button>
          </div>
          <a href={`tel:${c.phone.replaceAll("-", "")}`}>
            <Button variant="outline">
              <Phone size={14} /> 撥打
            </Button>
          </a>
          <Button variant="primary" onClick={onAr}>
            查看應收明細
          </Button>
        </>
      }
    >
      {r.reasons.length > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2.5 text-[12.5px] text-warn">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" />
          <div>需關注：{r.reasons.join("、")}</div>
        </div>
      )}
      <Segmented
        size="sm"
        value={tab}
        onChange={setTab}
        options={[
          { value: "overview", label: "概覽" },
          { value: "orders", label: "訂購習慣" },
          { value: "notes", label: `往來紀錄（${notes.length}）` },
        ]}
      />
      <div className="mt-4">
        {tab === "overview" && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <MiniStat label="近 30 天營業額" value={<Money cents={r.revenue30} />} foot={<Trend bp={r.trendBp} />} />
              <MiniStat label="應收餘額" value={<Money cents={r.balance} />} foot={r.overdue > 0 ? <span className="text-bad">逾期 {formatTWD(r.overdue)}</span> : "無逾期"} />
              <MiniStat label="下單頻率" value={`每週 ${r.ordersPerWeek} 次`} foot={r.lastOrderDate ? `上次 ${formatDate(r.lastOrderDate)}` : "尚無訂單"} />
            </div>
            <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-2 text-[13px]">
              <Row k="負責人" v={c.ownerName} />
              <Row k="聯絡窗口" v={c.contactName} />
              <Row k="聯絡電話" v={<span className="num">{c.phone}</span>} />
              <Row k="往來起始" v={<Tenure c={c} r={r} />} />
              <Row k="地址" v={<>{c.address}{c.geoPending && <Badge tone="outline" className="ml-1.5">地圖座標待確認</Badge>}</>} />
              <Row k="收貨時段" v={<span className="num">{c.window.start}–{c.window.end}</span>} />
              <Row k="負責業務" v={manager ? `${manager.name}（${manager.title}）` : "—"} />
              <Row k="結帳條件" v={`${TERMS_LABEL[c.settlementTerms]}${c.settlementTerms === "mixed" ? `・當日收 ${(c.sameDayShareBp ?? 0) / 100}%` : ""}・信用額度 ${formatTWD(c.creditLimitCents)}`} />
              <Row k="價格等級" v={PRICE_LABEL[c.priceTier]} />
              <Row k="發票" v={c.invoiceClass === "B2B" ? `B2B・統編 ${c.taxId}` : `B2C${c.carrier ? `・${c.carrier.type === "mobile" ? "手機條碼" : c.carrier.type === "member" ? "會員載具" : "自然人憑證"}` : "・紙本"}`} />
              <Row
                k="LINE"
                v={
                  <Badge tone={c.linkStatus === "linked" ? "ok" : c.linkStatus === "pending" ? "warn" : "neutral"}>
                    <Link2 size={11} /> {c.linkStatus === "linked" ? "已綁定官方帳號" : c.linkStatus === "pending" ? "綁定中" : "未綁定"}
                  </Badge>
                }
              />
            </dl>
          </div>
        )}
        {tab === "orders" && (r.lastOrderDate ? <OrderHabits r={r} /> : <div className="py-8 text-center text-[12.5px] text-muted">尚無訂單。到「訂單」按 ＋ 建立第一張訂單。</div>)}
        {tab === "notes" && <Notes c={c} notes={notes} />}
      </div>
    </Drawer>
  );
}

function MiniStat({ label, value, foot }: { label: string; value: React.ReactNode; foot: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line px-3 py-2">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="num text-[15px] font-semibold">{value}</div>
      <div className="text-[11px] text-muted">{foot}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted">{k}</dt>
      <dd className="min-w-0 text-ink">{v}</dd>
    </>
  );
}

function OrderHabits({ r }: { r: CrmRow }) {
  const db = useDb();
  const products = maps(db).products;
  const max = Math.max(1, ...r.weekly);
  const topMax = Math.max(1, ...r.topProducts.map((t) => t.qtyBase));
  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 text-[12.5px] font-medium">近 8 週營業額（未稅）</div>
        <div className="flex h-32 items-end gap-2 rounded-lg border border-line px-3 pt-3 pb-2">
          {r.weekly.map((v, i) => (
            <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
              <div className="num text-[10px] text-muted">{Math.round(v / 100 / 1000)}k</div>
              <div className={cn("w-full rounded-t-[3px]", i === r.weekly.length - 1 ? "bg-amber" : "bg-line-strong")} style={{ height: `${(v / max) * 75}%` }} title={formatTWD(v)} />
              <div className="num text-[10px] text-faint">{formatDate(addDays(DEMO_TODAY, -7 * (7 - i)))}</div>
            </div>
          ))}
        </div>
        <div className="mt-1 text-[11.5px] text-faint">最後一週含今日；以出貨日的應收單據計。</div>
      </div>
      <div>
        <div className="mb-2 text-[12.5px] font-medium">常購品項（近 60 天）</div>
        <ul className="space-y-2">
          {r.topProducts.map((t) => {
            const p = products.get(t.productId)!;
            const qty = t.qtyBase % p.packSize === 0 ? `${t.qtyBase / p.packSize} ${p.packUnit}` : `${t.qtyBase} ${p.baseUnit}`;
            return (
              <li key={t.productId} className="grid grid-cols-[110px_1fr_70px] items-center gap-3 text-[12.5px]">
                <span className="truncate">{p.name}</span>
                <div className="h-2 rounded-full bg-sunk">
                  <div className="h-2 rounded-full bg-amber/70" style={{ width: `${(t.qtyBase / topMax) * 100}%` }} />
                </div>
                <span className="num text-right text-muted">{qty}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function Notes({ c, notes }: { c: Customer; notes: CustomerNote[] }) {
  const run = useStore((s) => s.run);
  const [kind, setKind] = useState<CustomerNote["kind"]>("call");
  const [text, setText] = useState("");
  const [follow, setFollow] = useState("");
  const submit = () => {
    if (run((d, ctx) => addCustomerNote(d, ctx, { customerId: c.id, kind, text, followUpOn: follow || undefined }), "已新增往來紀錄")) {
      setText("");
      setFollow("");
    }
  };
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-line bg-sunk p-3">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="記錄這次聯絡的內容…" aria-label="往來內容" className="w-full resize-none rounded-md border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-amber" />
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <Field label="方式" className="w-[96px]">
            <Select value={kind} onChange={(e) => setKind(e.target.value as CustomerNote["kind"])} className="h-8 text-[12.5px]">
              {Object.entries(NOTE_KIND_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="下次追蹤（選填）" className="w-[160px]">
            <Input type="date" min={DEMO_TODAY} value={follow} onChange={(e) => setFollow(e.target.value)} className="h-8 text-[12.5px]" />
          </Field>
          <Button variant="primary" size="sm" className="ml-auto" onClick={submit} disabled={!text.trim()}>
            新增紀錄
          </Button>
        </div>
      </div>
      {notes.length === 0 ? (
        <div className="py-6 text-center text-[12.5px] text-muted">尚無往來紀錄</div>
      ) : (
        <ol className="relative space-y-4 border-l border-line pl-4">
          {notes.map((n) => (
            <li key={n.id} className="relative">
              <span className="absolute top-1.5 -left-[21px] h-2.5 w-2.5 rounded-full border-2 border-surface bg-amber" />
              <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted">
                <Badge tone="outline">{NOTE_KIND_LABEL[n.kind]}</Badge>
                <span className="num">{formatDateTime(n.at)}</span>・{n.authorName}
                {n.followUpOn && (
                  <Badge tone={n.followUpOn >= DEMO_TODAY ? "info" : "neutral"}>
                    <CalendarClock size={11} /> 追蹤 {formatDate(n.followUpOn)}
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-[13px] text-ink">{n.text}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
