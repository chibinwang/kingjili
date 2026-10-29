"use client";

import { Download, Printer, Route, Sparkles, Truck } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { RouteMap } from "@/components/RouteMap";
import { DriverView } from "@/components/dispatch/DriverView";
import { PickByVehicle, PickByZone } from "@/components/dispatch/PickTables";
import { RouteCompare } from "@/components/dispatch/RouteCompare";
import { Badge, Bar, Button, Card, CardHeader, Check, DemoNote, Money, PageHeader, Segmented, VehicleTag } from "@/components/ui";
import { codFor } from "@/lib/cod";
import type { VehicleId } from "@/lib/domain/types";
import { downloadPickWorkbook } from "@/lib/exports";
import { maps, pickLines, routeView } from "@/lib/selectors";
import { useDb, useStore } from "@/lib/store";
import { addOrderToRoute, insertionOptions, unroutedToday } from "@/lib/actions";
import { DEMO_TODAY, formatDate, formatDateTime, hhmm } from "@/lib/time";

export default function DispatchPage() {
  return (
    <Suspense>
      <Dispatch />
    </Suspense>
  );
}

function Dispatch() {
  const db = useDb();
  const params = useSearchParams();
  const view = routeView(db);
  const m = maps(db);
  const lines = pickLines(db);
  const [focus, setFocus] = useState<VehicleId | "all">("all");
  const [tab, setTab] = useState<"zone" | "vehicle" | "driver">((params.get("tab") as "zone" | "vehicle" | "driver") ?? "zone");
  const [compare, setCompare] = useState(false);
  const [selected, setSelected] = useState<string | undefined>();

  const prev = useMemo(() => db.routePlans.filter((p) => p.date === DEMO_TODAY).sort((a, b) => b.version - a.version)[1], [db.routePlans]);

  if (!view) return <PageHeader title="今日配送" sub="今天沒有路線" />;
  const { plan, evaluation, suggestion } = view;
  const lateIds = [...evaluation.routes.A.stops, ...evaluation.routes.B.stops].filter((s) => s.late).map((s) => s.customerId);
  const picked = lines.filter((l) => db.pickConfirmations[l.orderLineId]).length;
  const approver = plan.approvedBy ? m.users.get(plan.approvedBy)?.name : undefined;

  return (
    <div className="animate-rise space-y-5">
      <PageHeader
        eyebrow={`DISPATCH · ${formatDate(DEMO_TODAY, { year: true, weekday: true })}`}
        title="今日配送"
        sub="07:00 接單截止後排車；AI 只提出建議，路線調整需主任核准，理貨單隨路線版本即時更新。"
        right={
          <>
            <Badge tone="outline">路線 v{plan.version}</Badge>
            <Link href="/driver">
              <Button variant="ghost">
                <Truck size={15} /> 司機手機版
              </Button>
            </Link>
            <Button variant="outline" onClick={() => downloadPickWorkbook(lines, db.vehicles, DEMO_TODAY, plan.version, db.pickConfirmations)}>
              <Download size={15} /> 下載理貨單 XLSX
            </Button>
            <Link href="/print/picklist?mode=all" target="_blank">
              <Button variant="primary">
                <Printer size={15} /> 列印 PDF
              </Button>
            </Link>
          </>
        }
      />

      <UnroutedBanner version={plan.version} />

      {suggestion ? (
        <div className="flex flex-wrap items-center gap-4 rounded-[14px] border border-ai/20 bg-[linear-gradient(100deg,#f3f0fd_0%,#fbfaff_60%)] px-5 py-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[11px] bg-ai text-white">
            <Sparkles size={18} />
          </span>
          <div className="min-w-[260px] flex-1">
            <div className="flex flex-wrap items-center gap-2 text-[14.5px] font-semibold text-ink">
              {m.customers.get(suggestion.customerId)?.name} 由 <VehicleTag v={suggestion.from} /> 改至 <VehicleTag v={suggestion.to} /> 第 {suggestion.position} 站
              <Badge tone="ai" dot>
                AI 建議
              </Badge>
            </div>
            <div className="mt-0.5 text-[12.5px] text-ink-2">
              兩車合計少跑約 <b className="num">{suggestion.savedKm.toFixed(1)} km</b>、工時少 <b className="num">{Math.round(suggestion.savedMin)} 分鐘</b>
              {lateIds.length > 0 && <>，並解決 {lateIds.length} 站超時</>}；載重、時段、溫層、工時、回倉 12 項限制全部通過。
              <span className="text-faint">（示意估算，非導航引擎）</span>
            </div>
          </div>
          <Button variant="ai" size="lg" onClick={() => setCompare(true)}>
            <Route size={16} /> 預覽 AI 路線建議
          </Button>
        </div>
      ) : (
        prev && (
          <div className="flex flex-wrap items-center gap-3 rounded-[14px] border border-ok/25 bg-ok-soft/60 px-5 py-3.5 text-[13px] text-ok">
            <Check ok size={14} />
            <span>
              路線 v{plan.version} 已由 {approver ?? "—"} 於 {formatDateTime(plan.createdAt)} 核准套用（{plan.reason}）。A/B 理貨單、列印與 XLSX 已同步更新。
            </span>
            <Link href="/activity?feature=dispatch" className="ml-auto text-[12.5px] underline underline-offset-2">
              查看紀錄
            </Link>
          </div>
        )
      )}

      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4 pb-2">
            <div className="flex items-center gap-2">
              <div className="text-[14px] font-semibold">路線圖</div>
              <Badge tone="mock">示意路線，未連接導航／交通資料</Badge>
            </div>
            <Segmented
              size="sm"
              value={focus}
              onChange={setFocus}
              options={[
                { value: "all", label: "全部" },
                { value: "A", label: "A 車" },
                { value: "B", label: "B 車" },
              ]}
            />
          </div>
          <RouteMap stops={plan.stops} customers={m.customers} focusVehicle={focus} highlight={suggestion?.customerId} lateIds={lateIds} onSelect={setSelected} selected={selected} />
        </Card>
        <div className="space-y-4">
          {(["A", "B"] as VehicleId[]).map((v) => {
            const r = evaluation.routes[v];
            const veh = db.vehicles.find((x) => x.id === v)!;
            const cons = evaluation.constraints[v];
            return (
              <Card key={v} className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <VehicleTag v={v} className="h-6 min-w-6 text-[12px]" />
                    <div>
                      <div className="text-[14px] font-semibold">
                        {veh.name}・{veh.driverName}
                      </div>
                      <div className="text-[11.5px] text-faint">
                        {veh.plate}・冷凍車・{veh.departAt} 出車
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="num text-[18px] font-semibold">{r.stops.length} 站</div>
                    <div className="num text-[11.5px] text-muted">{r.distanceKm.toFixed(1)} km（示意）</div>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-[12px]">
                  <div>
                    <div className="mb-1 flex justify-between text-muted">
                      <span>載重</span>
                      <span className="num">
                        {Math.round(r.loadKg)}/{veh.capacityKg} kg
                      </span>
                    </div>
                    <Bar value={r.loadKg} max={veh.capacityKg} tone={v === "A" ? "amber" : "b"} />
                  </div>
                  <div>
                    <div className="mb-1 flex justify-between text-muted">
                      <span>工時</span>
                      <span className="num">
                        {(r.shiftMin / 60).toFixed(1)}/{veh.maxShiftMin / 60} h
                      </span>
                    </div>
                    <Bar value={r.shiftMin} max={veh.maxShiftMin} tone={v === "A" ? "amber" : "b"} />
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
                  {cons.map((c) => (
                    <span key={c.id} className={`inline-flex items-center gap-1 text-[11.5px] ${c.pass ? "text-muted" : "font-medium text-bad"}`} title={c.detail}>
                      <Check ok={c.pass} size={10} />
                      {c.label}
                    </span>
                  ))}
                </div>
                <div className="mt-3 border-t border-line pt-2.5 text-[12px] text-muted">預估回倉 {hhmm(r.returnMin)}</div>
              </Card>
            );
          })}
        </div>
      </div>

      <Card>
        <CardHeader title="停靠站" sub="時段為客戶收貨時間；應收金額依客戶結帳條件（日結當日收、月結不收）" />
        <div className="overflow-x-auto">
          <table className="tbl min-w-[860px]">
            <thead>
              <tr>
                <th>車・站</th>
                <th>客戶</th>
                <th>收貨時段</th>
                <th>預估抵達</th>
                <th>地址</th>
                <th className="r">當日應收</th>
                <th>狀態</th>
              </tr>
            </thead>
            <tbody>
              {(["A", "B"] as VehicleId[]).flatMap((v) =>
                evaluation.routes[v].stops
                  .filter(() => focus === "all" || focus === v)
                  .map((s) => {
                    const c = m.customers.get(s.customerId)!;
                    const d = db.deliveries.find((x) => x.id === s.deliveryId)!;
                    const cod = codFor(db, s.orderId);
                    return (
                      <tr key={s.deliveryId} className={`row-hover ${selected === c.id ? "bg-amber-wash" : ""}`} onClick={() => setSelected(c.id)}>
                        <td>
                          <span className="inline-flex items-center gap-1.5">
                            <VehicleTag v={v} />
                            <span className="num text-muted">#{s.sequence}</span>
                          </span>
                        </td>
                        <td>
                          <div className="font-medium">{c.name}</div>
                          <div className="text-[11.5px] text-faint">{maps(db).orders.get(s.orderId)?.no}</div>
                        </td>
                        <td className="num">
                          {c.window.start}–{c.window.end}
                        </td>
                        <td className="num">
                          <span className={s.late ? "font-semibold text-bad" : ""}>{hhmm(s.startMin)}</span>
                          {s.late && <Badge tone="bad" className="ml-1.5">超時</Badge>}
                        </td>
                        <td className="text-[12.5px] text-muted">{c.address}</td>
                        <td className="r">
                          {cod.cents ? <Money cents={cod.cents} className="font-medium" /> : <span className="text-faint">—</span>}
                          <div className="text-[11px] text-faint">{cod.label}</div>
                        </td>
                        <td>{d.status === "delivered" ? <Badge tone="ok" dot>已送達</Badge> : <Badge tone="neutral">待出車</Badge>}</td>
                      </tr>
                    );
                  }),
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: "zone", label: "按凍庫揀貨" },
              { value: "vehicle", label: "按車配送" },
              { value: "driver", label: (<span className="inline-flex items-center gap-1"><Truck size={13} /> 司機作業</span>) },
            ]}
          />
          <div className="flex items-center gap-3 text-[12.5px] text-muted">
            <span className="num">
              已揀 {picked}/{lines.length} 行
            </span>
            <div className="w-28">
              <Bar value={picked} max={lines.length} tone="ok" />
            </div>
          </div>
        </div>
        {tab === "zone" && <PickByZone />}
        {tab === "vehicle" && <PickByVehicle />}
        {tab === "driver" && <DriverView />}
      </Card>
      <DemoNote>路線距離、時間與油耗為示意估算；地圖為示意位置，非實際地址座標。</DemoNote>

      {compare && suggestion && <RouteCompare onClose={() => setCompare(false)} />}
    </div>
  );
}

/** Orders confirmed for today after the route was planned: the manager picks a truck (best position, that truck's limits checked). */
function UnroutedBanner({ version }: { version: number }) {
  const db = useDb();
  const run = useStore((st) => st.run);
  const m = maps(db);
  const owner = db.users.find((u) => u.role === "owner")!;
  const orders = unroutedToday(db);
  if (!orders.length) return null;
  return (
    <div className="rounded-[14px] border border-info/25 bg-info-soft/60 px-5 py-3.5" data-testid="unrouted">
      <div className="text-[13.5px] font-semibold text-info">{orders.length} 張今日新增訂單待排車</div>
      <div className="mt-2 space-y-2">
        {orders.map((o) => {
          const opts = insertionOptions(db, o.id);
          return (
            <div key={o.id} className="flex flex-wrap items-center gap-2 rounded-[10px] bg-surface px-3 py-2 text-[13px]">
              <span className="font-medium">{m.customers.get(o.customerId)?.name}</span>
              <span className="num text-[12px] text-muted">{o.no}</span>
              {o.state === "Validated" && <Badge tone="warn">部分缺貨</Badge>}
              <div className="ml-auto flex flex-wrap gap-1.5">
                {opts.map((x) => (
                  <Button
                    key={x.vehicleId}
                    size="sm"
                    variant={x.feasible ? "outline" : "ghost"}
                    disabled={!x.feasible}
                    title={x.feasible ? undefined : `${x.failed.join("、")}未通過`}
                    onClick={() => run((d, c) => addOrderToRoute(d, c, o.id, x.vehicleId, version), `已加入 ${x.vehicleId} 車，路線 v${version + 1}，理貨單已更新`, { asUserId: owner.id })}
                  >
                    加入 {x.vehicleId} 車
                    <span className="text-[11.5px] text-muted">{x.feasible ? `+${x.addedKm.toFixed(1)} km・+${Math.round(x.addedMin)} 分` : `${x.failed.join("、")}不符`}</span>
                  </Button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 text-[11.5px] text-muted">系統找出各車成本最低的插入位置並檢查該車的載重、時段與工時；由主任 {owner.name} 確認加入。</div>
    </div>
  );
}
