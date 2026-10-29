"use client";

import { AlertTriangle, Snowflake } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Input, Modal, VehicleTag } from "@/components/ui";
import { confirmPick, undoPick } from "@/lib/actions";
import { cn } from "@/lib/cn";
import { groupByVehicle, groupByZone, pickStatus, type PickLine } from "@/lib/domain/picking";
import { maps, pickLines } from "@/lib/selectors";
import { useDb, useStore } from "@/lib/store";

function Tick({ line }: { line: PickLine }) {
  const db = useDb();
  const run = useStore((s) => s.run);
  const conf = db.pickConfirmations[line.orderLineId];
  const st = pickStatus(line, conf);
  const toggle = () => (conf ? run((d, c) => undoPick(d, c, line.orderLineId)) : run((d, c) => confirmPick(d, c, [line.orderLineId])));
  return (
    <button
      onClick={toggle}
      aria-label={conf ? "取消確認" : "確認已揀"}
      className={cn(
        "grid h-7 w-7 shrink-0 place-items-center rounded-[7px] border-2 transition-colors",
        st === "ok" && "border-ok bg-ok text-white",
        st === "pending" && "border-line-strong bg-surface hover:border-ok",
        (st === "short" || st === "over") && "border-warn bg-warn text-white",
        st === "moved" && "border-bad bg-bad text-white",
      )}
    >
      {st !== "pending" && (
        <svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2">
          {st === "moved" ? <path d="M6 2.5v4M6 9v.5" /> : <path d="M2.5 6.2 5 8.5l4.5-5" />}
        </svg>
      )}
    </button>
  );
}

function StatusNote({ line }: { line: PickLine }) {
  const db = useDb();
  const conf = db.pickConfirmations[line.orderLineId];
  const st = pickStatus(line, conf);
  if (st === "moved") return <Badge tone="bad">已改 {line.vehicleId} 車：請移至 {line.vehicleId} 車暫存區</Badge>;
  if (st === "short") return <Badge tone="warn">短少 {line.qtyBase - conf!.qtyBase}</Badge>;
  if (st === "over") return <Badge tone="warn">多揀 {conf!.qtyBase - line.qtyBase}</Badge>;
  if (conf?.flagged) return <Badge tone="warn">{conf.flagged}</Badge>;
  return null;
}

function DiscrepancyButton({ line }: { line: PickLine }) {
  const run = useStore((s) => s.run);
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState(String(line.qtyBase));
  const [reason, setReason] = useState("箱損");
  return (
    <>
      <button onClick={() => setOpen(true)} className="text-[11.5px] text-faint hover:text-warn" title="回報差異">
        <AlertTriangle size={13} />
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        width={420}
        title="回報揀貨差異"
        sub={`${line.productName}・${line.customerName}・需 ${line.qtyBase}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (run((d, c) => confirmPick(d, c, [line.orderLineId], Number(qty), `${reason}：實揀 ${qty}`), "已記錄差異，業務會通知客戶")) setOpen(false);
              }}
            >
              記錄差異
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <label className="text-[12px]">
            實揀數量（基本單位）
            <Input type="number" min={0} value={qty} onChange={(e) => setQty(e.target.value)} className="mt-1" />
          </label>
          <label className="text-[12px]">
            原因
            <Input value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1" />
          </label>
        </div>
      </Modal>
    </>
  );
}

export function PickByZone() {
  const db = useDb();
  const run = useStore((s) => s.run);
  const lines = pickLines(db);
  const groups = groupByZone(lines, maps(db).products);
  return (
    <div className="divide-y divide-line">
      {groups.map((g, gi) => {
        const done = g.skus.flatMap((s) => s.lines).filter((l) => db.pickConfirmations[l.orderLineId]).length;
        return (
          <section key={g.zone} className="px-5 py-4">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-frost text-info">
                <Snowflake size={17} />
              </span>
              <div>
                <div className="text-[15px] font-semibold">
                  凍庫 {g.zone}
                  <span className="ml-2 text-[12px] font-normal text-faint">第 {gi + 1} 站・開門一次取完</span>
                </div>
                <div className="text-[12px] text-muted">
                  {g.skus.length} 品項・{g.lineCount} 行・已揀 {done}
                </div>
              </div>
              {g.lineCount > 0 && (
                <Button size="sm" variant="outline" className="ml-auto" onClick={() => run((d, c) => confirmPick(d, c, g.skus.flatMap((s) => s.lines.filter((l) => !db.pickConfirmations[l.orderLineId]).map((l) => l.orderLineId))), `凍庫 ${g.zone} 已全部確認`)} disabled={done === g.lineCount}>
                  整區確認
                </Button>
              )}
            </div>
            {g.lineCount === 0 ? (
              <div className="rounded-[10px] bg-sunk px-4 py-3 text-[12.5px] text-faint">今日此凍庫無需揀貨</div>
            ) : (
              <div className="overflow-x-auto rounded-[12px] border border-line">
                <table className="tbl min-w-[760px] text-[13px]">
                  <thead>
                    <tr>
                      <th className="w-[230px]">品項・架位</th>
                      <th className="r w-[110px]">合計</th>
                      <th>分配（車・站・客戶）</th>
                      <th className="r w-[90px]">需揀</th>
                      <th className="w-[200px]">批號／效期（FEFO）</th>
                      <th className="w-[70px]">確認</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.skus.map((s) =>
                      s.lines.map((l, i) => (
                        <tr key={l.id} className={cn(i === s.lines.length - 1 ? "" : "[&>td]:border-b-[#f6f3ee]")}>
                          {i === 0 && (
                            <>
                              <td rowSpan={s.lines.length} className="border-r border-line bg-sunk/40 align-top">
                                <div className="font-semibold text-ink">{s.name}</div>
                                <div className="text-[11.5px] text-faint">
                                  {s.sku}・架位 {s.shelf}
                                </div>
                              </td>
                              <td rowSpan={s.lines.length} className="r num border-r border-line bg-sunk/40 align-top font-semibold">
                                {s.totalLabel}
                              </td>
                            </>
                          )}
                          <td>
                            <span className="inline-flex flex-wrap items-center gap-1.5">
                              <VehicleTag v={l.vehicleId} />
                              <span className="num text-[12px] text-faint">#{l.stopSequence}</span>
                              <span>{l.customerName}</span>
                              {l.source === "LINE" && <Badge tone="ok">LINE</Badge>}
                              <StatusNote line={l} />
                            </span>
                          </td>
                          <td className="r num font-medium">
                            {l.qty} {l.unit}
                          </td>
                          <td className="text-[12px] text-muted">
                            {l.lots.map((x) => (
                              <div key={x.lot} className="num">
                                {x.lot}・{x.expiry.slice(2)}
                                {l.lots.length > 1 && <span className="text-faint">（{x.qtyBase}）</span>}
                              </div>
                            ))}
                          </td>
                          <td>
                            <span className="flex items-center gap-2">
                              <Tick line={l} />
                              <DiscrepancyButton line={l} />
                            </span>
                          </td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

export function PickByVehicle() {
  const db = useDb();
  const lines = pickLines(db);
  const byV = groupByVehicle(lines);
  return (
    <div className="grid gap-5 p-5 lg:grid-cols-2">
      {(["A", "B"] as const).map((v) => {
        const veh = db.vehicles.find((x) => x.id === v)!;
        const all = byV[v].flatMap((s) => s.lines);
        const done = all.filter((l) => db.pickConfirmations[l.orderLineId]).length;
        return (
          <div key={v} className="rounded-[12px] border border-line">
            <div className={cn("flex items-center justify-between rounded-t-[12px] px-4 py-3", v === "A" ? "bg-amber-soft/60" : "bg-truck-b-soft")}>
              <div className="flex items-center gap-2 font-semibold">
                <VehicleTag v={v} /> {veh.name} 理貨單・{veh.driverName}
              </div>
              <span className="num text-[12px] text-muted">
                {byV[v].length} 站・{done}/{all.length} 行
              </span>
            </div>
            <div className="divide-y divide-line">
              {byV[v].map((stop) => (
                <div key={stop.stopSequence} className="px-4 py-3">
                  <div className="mb-1.5 flex items-center justify-between text-[13px]">
                    <span className="font-semibold">
                      <span className="num mr-1.5 text-faint">#{stop.stopSequence}</span>
                      {stop.customerName}
                    </span>
                    <span className="text-[11.5px] text-faint">{stop.orderNo}</span>
                  </div>
                  {stop.lines.map((l) => (
                    <div key={l.id} className="flex items-center gap-3 py-1 text-[13px]">
                      <Tick line={l} />
                      <span className="w-6 text-center text-[11.5px] font-semibold text-info">{l.zone}</span>
                      <span className="flex-1">
                        {l.productName}
                        <span className="ml-1 text-[11.5px] text-faint">{l.sku}</span>
                      </span>
                      <StatusNote line={l} />
                      <span className="num w-16 text-right font-medium">
                        {l.qty} {l.unit}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
