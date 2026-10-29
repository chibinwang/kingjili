"use client";

import { ChevronDown, MapPin, Phone } from "lucide-react";
import { useState } from "react";
import { Badge, Bar, Button, Field, Input, Modal, Money, Segmented, Select, VehicleTag } from "@/components/ui";
import { cn } from "@/lib/cn";
import { METHOD_LABEL } from "@/lib/domain/ar";
import type { DayCollections } from "@/lib/domain/collections";
import { completeDelivery } from "@/lib/actions";
import { codFor } from "@/lib/cod";
import type { Payment, VehicleId } from "@/lib/domain/types";
import { formatTWD, twd } from "@/lib/money";
import { collectionsFor, maps, routeView } from "@/lib/selectors";
import { useCurrentUser, useDb, useStore } from "@/lib/store";
import { hhmm, timePart } from "@/lib/time";

/** Mobile-first driver screen: stops in order, deliver, record the collection (cash ≠ bank-settled). */
export function DriverView() {
  const db = useDb();
  const user = useCurrentUser();
  // a driver only ever sees their own truck; office roles can switch
  const locked = user.role === "driver" && !!user.vehicleId;
  const [picked, setV] = useState<VehicleId>(user.vehicleId ?? "A");
  const v = locked ? user.vehicleId! : picked;
  const view = routeView(db)!;
  const m = maps(db);
  const [stopId, setStopId] = useState<string | null>(null);
  const stops = view.evaluation.routes[v].stops;
  const day = collectionsFor(db, v);
  const byStop = new Map(day.stops.map((s) => [s.deliveryId, s]));
  const vehicle = db.vehicles.find((x) => x.id === v)!;
  return (
    <div className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {locked ? (
          <div className="flex items-center gap-2 text-[14px] font-semibold">
            <VehicleTag v={v} /> {vehicle.name}・{vehicle.driverName}
          </div>
        ) : (
          <Segmented
            value={v}
            onChange={setV}
            options={db.vehicles.map((x) => ({ value: x.id, label: `${x.name}・${x.driverName}` }))}
          />
        )}
        <div className="text-[12px] text-faint">現金回倉繳回後，由會計確認存入</div>
      </div>
      <CollectionSummary day={day} />
      <div className="mx-auto mt-4 grid max-w-[880px] gap-3 md:grid-cols-2">
        {stops.map((s) => {
          const c = m.customers.get(s.customerId)!;
          const d = db.deliveries.find((x) => x.id === s.deliveryId)!;
          const cod = codFor(db, s.orderId);
          const sc = byStop.get(s.deliveryId)!;
          const done = d.status === "delivered";
          return (
            <div key={s.deliveryId} className={`rounded-[14px] border p-4 ${done ? "border-ok/30 bg-ok-soft/30" : "border-line bg-surface"}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-[15px] font-semibold">
                    <VehicleTag v={v} />
                    <span className="num text-faint">#{s.sequence}</span> {c.name}
                  </div>
                  <div className="mt-1 flex items-center gap-1 text-[12.5px] text-muted">
                    <MapPin size={13} /> {c.address}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1 text-[12.5px] text-muted">
                    <Phone size={13} /> {c.contactName}・{c.phone}
                  </div>
                </div>
                <div className="text-right">
                  <div className="num text-[12px] text-muted">
                    {c.window.start}–{c.window.end}
                  </div>
                  <div className={`num text-[13px] font-semibold ${s.late ? "text-bad" : ""}`}>約 {hhmm(s.startMin)}</div>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between rounded-[10px] bg-sunk px-3 py-2">
                <span className="text-[12px] text-muted">{cod.label}</span>
                {cod.cents ? <Money cents={cod.cents} className="text-[15px] font-semibold" /> : <span className="text-[12.5px] text-faint">—</span>}
              </div>
              {done && cod.cents > 0 && (
                <div className={cn("mt-1.5 flex justify-between px-1 text-[12px]", sc.shortfallCents > 0 ? "text-warn" : "text-ok")}>
                  <span>已收 {sc.methods.map((x) => METHOD_LABEL[x]).join("・") || "—"}</span>
                  <span className="num font-medium">
                    {formatTWD(sc.collectedCents)}
                    {sc.shortfallCents > 0 && `（差 ${formatTWD(sc.shortfallCents)}）`}
                  </span>
                </div>
              )}
              {sc.priorBalanceCents > 0 && (
                <div className="mt-1.5 px-1 text-[11.5px] text-muted">
                  前期未付 <span className="num">{formatTWD(sc.priorBalanceCents)}</span>・不在今日應收內，客戶主動付款可一併登錄
                </div>
              )}
              {done ? (
                <div className="mt-3 flex items-center justify-between text-[12.5px]">
                  <Badge tone="ok" dot>
                    {timePart(d.deliveredAt!)} 已送達
                  </Badge>
                  <span className="text-muted">已建立應收與日結單</span>
                </div>
              ) : (
                <Button variant="primary" size="lg" className="mt-3 h-12 w-full" onClick={() => setStopId(s.deliveryId)}>
                  完成送達{cod.cents ? "並登錄收款" : ""}
                </Button>
              )}
            </div>
          );
        })}
      </div>
      {stopId && <CompleteModal deliveryId={stopId} onClose={() => setStopId(null)} />}
    </div>
  );
}

function CompleteModal({ deliveryId, onClose }: { deliveryId: string; onClose: () => void }) {
  const db = useDb();
  const run = useStore((s) => s.run);
  const user = useCurrentUser();
  const d = db.deliveries.find((x) => x.id === deliveryId)!;
  const c = maps(db).customers.get(d.customerId)!;
  const cod = codFor(db, d.orderId);
  const [amount, setAmount] = useState(String(cod.cents / 100));
  const [method, setMethod] = useState<Payment["method"]>("cash");
  const [proof, setProof] = useState(`簽收聯 ${d.noteNo}`);
  const [note, setNote] = useState("");
  const driver = db.users.find((u) => u.vehicleId === d.vehicleId)!;
  const asDriver = user.role !== "driver" && user.role !== "owner";
  const amt = Math.round(Number(amount || 0));
  const submit = () => {
    const ok = run(
      (x, ctx) => completeDelivery(x, ctx, deliveryId, amt > 0 ? { method, amountCents: twd(amt), proofRef: proof, note: note || (amt * 100 < cod.cents ? "部分收款" : undefined) } : undefined),
      amt > 0 ? `${c.name} 已送達，收款 NT$${amt.toLocaleString()} 已登錄（現金待繳回）` : `${c.name} 已送達，建立應收`,
      asDriver ? { asUserId: driver.id } : undefined,
    );
    if (ok) onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      width={460}
      title={`完成送達・${c.name}`}
      sub={`${d.noteNo}・日結單不等於發票，也不等於銀行入帳`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" size="lg" onClick={submit}>
            確認送達
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="rounded-[10px] bg-sunk px-3 py-2 text-[12.5px] text-muted">
          {cod.label}；應收 <span className="num font-semibold text-ink">{formatTWD(cod.cents)}</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="收款方式">
            <Select value={method} onChange={(e) => setMethod(e.target.value as Payment["method"])}>
              <option value="cash">現金</option>
              <option value="transfer">轉帳（待核對）</option>
              <option value="check">支票</option>
              <option value="linepay">LINE Pay</option>
            </Select>
          </Field>
          <Field label="實收金額（元）" hint={amt * 100 < cod.cents && amt > 0 ? "部分收款，餘額留在應收" : undefined}>
            <Input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} className="num h-11 text-[16px]" />
          </Field>
        </div>
        <Field label="憑證">
          <Input value={proof} onChange={(e) => setProof(e.target.value)} />
        </Field>
        <Field label="備註">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：客戶說餘額月底付" />
        </Field>
        <div className="text-[11.5px] text-faint">登錄者：{asDriver ? `${driver.name}（示範代登）` : user.name}・收款時間以系統時間記錄</div>
      </div>
    </Modal>
  );
}

/** Today's collection picture for one truck: progress, where the money is, and per-customer detail. */
function CollectionSummary({ day }: { day: DayCollections }) {
  const db = useDb();
  const m = maps(db);
  const [open, setOpen] = useState(false);
  const due = day.stops.filter((s) => s.expectedCents > 0 || s.collectedCents > 0);
  return (
    <div className="mx-auto max-w-[880px] rounded-[14px] border border-line bg-surface" data-testid="driver-collections">
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 pt-4 sm:grid-cols-4">
        <SummaryFigure label="今日應收（現場）" cents={day.expectedCents} foot={`${due.length} 站需收款`} />
        <SummaryFigure label="已收" cents={day.collectedCents} foot={`${day.deliveredStops}／${day.stops.length} 站已送達`} tone="ok" />
        <SummaryFigure label="待收" cents={day.pendingCents} foot={day.shortfallCents > 0 ? `另有短收 ${formatTWD(day.shortfallCents)}` : "未送達站點"} tone={day.shortfallCents > 0 ? "warn" : undefined} />
        <SummaryFigure label="身上現金" cents={day.cashHeldCents} foot={`已繳回 ${formatTWD(day.handedOverCents)}・非現金 ${formatTWD(day.nonCashCents)}`} />
      </div>
      <div className="px-4 pt-3 pb-1">
        <Bar value={day.collectedCents} max={day.expectedCents} tone="ok" />
      </div>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center justify-between px-4 py-2.5 text-[12.5px] text-muted hover:text-ink">
        <span>各客戶收款明細（{day.stops.length} 站）</span>
        <ChevronDown size={14} className={cn("transition-transform", !open && "-rotate-90")} />
      </button>
      {open && (
        <div className="scroll-thin overflow-x-auto border-t border-line">
          <table className="tbl text-[12.5px]">
            <thead>
              <tr>
                <th>站・客戶</th>
                <th className="r">本次應收</th>
                <th className="r">已收</th>
                <th>方式</th>
                <th className="r">前期未付</th>
              </tr>
            </thead>
            <tbody>
              {day.stops.map((s) => (
                <tr key={s.deliveryId}>
                  <td className="whitespace-nowrap">
                    <span className="num text-faint">#{s.sequence}</span> {m.customers.get(s.customerId)?.name}
                    <div className="text-[11px] text-faint">{s.label}</div>
                  </td>
                  <td className="r num whitespace-nowrap">{s.expectedCents ? formatTWD(s.expectedCents) : "—"}</td>
                  <td className={cn("r num whitespace-nowrap", s.shortfallCents > 0 && "text-warn")}>{s.delivered ? formatTWD(s.collectedCents) : <span className="text-faint">未送達</span>}</td>
                  <td className="whitespace-nowrap text-muted">{s.methods.map((x) => METHOD_LABEL[x]).join("・") || "—"}</td>
                  <td className="r num whitespace-nowrap text-muted">{s.priorBalanceCents ? formatTWD(s.priorBalanceCents) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SummaryFigure({ label, cents, foot, tone }: { label: string; cents: number; foot: string; tone?: "ok" | "warn" }) {
  return (
    <div className="min-w-0">
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className={cn("num text-[19px] leading-tight font-semibold", tone === "ok" && "text-ok", tone === "warn" && "text-warn")}>{formatTWD(cents)}</div>
      <div className="truncate text-[11px] text-faint">{foot}</div>
    </div>
  );
}
