"use client";

import { Printer } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { groupByVehicle, groupByZone, type PickLine } from "@/lib/domain/picking";
import type { VehicleId } from "@/lib/domain/types";
import { maps, pickLines, routeView } from "@/lib/selectors";
import { useDb } from "@/lib/store";
import { DEMO_TODAY, formatDate, hhmm } from "@/lib/time";

export default function PrintPickList() {
  return (
    <Suspense>
      <Sheet />
    </Suspense>
  );
}

function Head({ title, sub, version }: { title: string; sub: string; version: number }) {
  return (
    <div className="mb-4 flex items-end justify-between border-b-2 border-ink pb-2">
      <div>
        <div className="text-[11px] tracking-[.2em] text-muted">金吉利食品・理貨單</div>
        <div className="text-[20px] font-bold">{title}</div>
        <div className="text-[12px] text-ink-2">{sub}</div>
      </div>
      <div className="text-right text-[11px] text-muted">
        <div>{formatDate(DEMO_TODAY, { year: true, weekday: true })}</div>
        <div>路線 v{version}・示範資料</div>
      </div>
    </div>
  );
}

const box = <span className="inline-block h-4 w-4 border border-ink align-middle" />;

function ZoneSheet({ lines, version }: { lines: PickLine[]; version: number }) {
  const db = useDb();
  const groups = groupByZone(lines, maps(db).products);
  return (
    <section className="print-page">
      <Head title="按凍庫理貨（A → B → C → D）" sub="每個凍庫開門一次取完；取出後依車次分區暫存，裝車時逐車核對。" version={version} />
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className="border-b border-ink text-left">
            {["凍庫", "SKU", "商品", "架位", "需揀", "單位", "車", "站", "配送客戶", "批號／效期", "實揀", "✓"].map((h) => (
              <th key={h} className="py-1.5 pr-2 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.flatMap((g) =>
            g.skus.flatMap((s) =>
              s.lines.map((l, i) => (
                <tr key={l.id} className={i === s.lines.length - 1 ? "border-b border-line-strong" : "border-b border-line"}>
                  <td className="py-1.5 pr-2 font-bold">{i === 0 ? g.zone : ""}</td>
                  <td className="pr-2">{i === 0 ? s.sku : ""}</td>
                  <td className="pr-2 font-medium">{i === 0 ? `${s.name}（共 ${s.totalLabel}）` : ""}</td>
                  <td className="pr-2">{i === 0 ? s.shelf : ""}</td>
                  <td className="num pr-2 text-right font-semibold">{l.qty}</td>
                  <td className="pr-2">{l.unit}</td>
                  <td className="pr-2 font-bold">{l.vehicleId}</td>
                  <td className="num pr-2">{l.stopSequence}</td>
                  <td className="pr-2">{l.customerName}</td>
                  <td className="num pr-2 text-[11px]">{l.lots.map((x) => `${x.lot}/${x.expiry.slice(2)}`).join(" ")}</td>
                  <td className="pr-2">＿＿</td>
                  <td>{box}</td>
                </tr>
              )),
            ),
          )}
        </tbody>
      </table>
      <Sign />
    </section>
  );
}

function VehicleSheet({ v, lines, version }: { v: VehicleId; lines: PickLine[]; version: number }) {
  const db = useDb();
  const veh = db.vehicles.find((x) => x.id === v)!;
  const stops = groupByVehicle(lines)[v];
  const route = routeView(db)!.evaluation.routes[v];
  return (
    <section className="print-page">
      <Head title={`車 ${v} 理貨單`} sub={`${veh.plate}・司機 ${veh.driverName}・${stops.length} 站・${veh.departAt} 出車`} version={version} />
      {stops.map((s) => {
        const c = maps(db).customers.get(s.customerId)!;
        const eta = route.stops.find((x) => x.customerId === s.customerId);
        return (
          <div key={s.stopSequence} className="mb-3 break-inside-avoid border border-line-strong">
            <div className="flex justify-between bg-sunk px-2 py-1 text-[12px]">
              <span className="font-bold">
                #{s.stopSequence} {s.customerName}
              </span>
              <span>
                {c.address}・收貨 {c.window.start}–{c.window.end}・約 {eta ? hhmm(eta.startMin) : "—"}・{s.orderNo}
              </span>
            </div>
            <table className="w-full text-[12px]">
              <tbody>
                {s.lines.map((l) => (
                  <tr key={l.id} className="border-t border-line">
                    <td className="w-10 px-2 py-1 font-bold">{l.zone}</td>
                    <td className="w-14">{l.sku}</td>
                    <td>{l.productName}</td>
                    <td className="num w-24 text-right font-semibold">
                      {l.qty} {l.unit}
                    </td>
                    <td className="num w-40 px-2 text-[11px]">{l.lots.map((x) => `${x.lot}/${x.expiry.slice(2)}`).join(" ")}</td>
                    <td className="w-8">{box}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
      <Sign />
    </section>
  );
}

function Sign() {
  return (
    <div className="mt-6 grid grid-cols-3 gap-6 text-[12px]">
      {["揀貨人", "覆核（倉管）", "司機簽收"].map((x) => (
        <div key={x} className="border-t border-ink pt-1 text-muted">
          {x}
        </div>
      ))}
    </div>
  );
}

function Sheet() {
  const db = useDb();
  const params = useSearchParams();
  const mode = params.get("mode") ?? "all";
  const lines = pickLines(db);
  const version = routeView(db)?.plan.version ?? 1;
  return (
    <div className="mx-auto max-w-[900px] p-8 text-ink">
      <div className="no-print mb-6 flex items-center justify-between rounded-xl border border-line bg-sunk px-4 py-3 text-[13px]">
        <span>預覽列印：{mode === "zone" ? "按凍庫" : mode === "vehicles" ? "A/B 車" : mode === "A" || mode === "B" ? `${mode} 車` : "凍庫總表＋A/B 車"}（路線 v{version}）</span>
        <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 text-white">
          <Printer size={14} /> 列印／存成 PDF
        </button>
      </div>
      {(mode === "all" || mode === "zone") && <ZoneSheet lines={lines} version={version} />}
      {(mode === "all" || mode === "vehicles" || mode === "A") && <VehicleSheet v="A" lines={lines} version={version} />}
      {(mode === "all" || mode === "vehicles" || mode === "B") && <VehicleSheet v="B" lines={lines} version={version} />}
    </div>
  );
}
