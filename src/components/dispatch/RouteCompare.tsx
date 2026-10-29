"use client";

import { ArrowRight, Fuel, ShieldCheck, Timer, TrendingDown } from "lucide-react";
import { RouteMap } from "@/components/RouteMap";
import { Badge, Button, Check, Modal, VehicleTag } from "@/components/ui";
import { applyRoutePlan } from "@/lib/actions";
import { cn } from "@/lib/cn";
import { ROUTING, type PlanEvaluation } from "@/lib/domain/routing";
import type { VehicleId } from "@/lib/domain/types";
import { can } from "@/lib/permissions";
import { maps, routeView } from "@/lib/selectors";
import { useCurrentUser, useDb, useStore } from "@/lib/store";
import { hhmm } from "@/lib/time";

function StopList({ ev, moved, side }: { ev: PlanEvaluation; moved: string; side: "before" | "after" }) {
  const db = useDb();
  const m = maps(db);
  return (
    <div className="grid grid-cols-2 gap-3">
      {(["A", "B"] as VehicleId[]).map((v) => (
        <div key={v} className="rounded-[10px] border border-line bg-sunk/60 p-2.5">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[12.5px] font-semibold">
              <VehicleTag v={v} /> {ev.routes[v].stops.length} 站
            </span>
            <span className="num text-[11.5px] text-muted">
              {ev.routes[v].distanceKm.toFixed(1)} km・回倉 {hhmm(ev.routes[v].returnMin)}
            </span>
          </div>
          <ol className="space-y-0.5">
            {ev.routes[v].stops.map((s) => {
              const isMoved = s.customerId === moved;
              return (
                <li key={s.deliveryId} className={cn("flex items-center justify-between rounded-[6px] px-1.5 py-[3px] text-[12px]", isMoved && (side === "after" ? "bg-ok-soft font-semibold text-ok" : "bg-bad-soft/70 text-bad line-through decoration-bad/40"))}>
                  <span>
                    <span className="num mr-1.5 text-faint">{s.sequence}</span>
                    {m.customers.get(s.customerId)?.name}
                  </span>
                  <span className={cn("num", s.late ? "font-semibold text-bad" : "text-muted")}>{hhmm(s.startMin)}</span>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}

export function RouteCompare({ onClose }: { onClose: () => void }) {
  const db = useDb();
  const user = useCurrentUser();
  const run = useStore((s) => s.run);
  const view = routeView(db)!;
  const s = view.suggestion!;
  const m = maps(db);
  const c = m.customers.get(s.customerId)!;
  const allowed = can(user.role, "route.approve");
  const owner = db.users.find((u) => u.role === "owner")!;
  const task = db.aiTasks.find((t) => t.kind === "route_reassign" && t.status === "awaiting_approval");
  const fuel = s.savedKm * ROUTING.dieselLPerKm;

  const approve = () => {
    const ok = run(
      (d, ctx) => applyRoutePlan(d, { ...ctx, correlationId: task?.correlationId }, view.plan.version, s.stops, `AI 建議：${c.name} ${s.from}→${s.to} 車`, task?.id),
      `已套用路線 v${view.plan.version + 1}，A/B 理貨單已更新`,
      allowed ? undefined : { asUserId: owner.id },
    );
    if (ok) onClose();
  };

  const all = [...s.after.constraints.A.map((x) => ({ ...x, v: "A" as const })), ...s.after.constraints.B.map((x) => ({ ...x, v: "B" as const }))];
  const beforeFails = [...view.evaluation.constraints.A, ...view.evaluation.constraints.B].filter((x) => !x.pass);

  return (
    <Modal
      open
      onClose={onClose}
      width={1080}
      title={
        <span className="flex items-center gap-2">
          路線調整預覽 <Badge tone="ai" dot>AI 建議</Badge>
        </span>
      }
      sub={`v${view.plan.version} → v${view.plan.version + 1}（預覽）・核准前不會改變任何資料`}
      footer={
        <>
          <span className="mr-auto flex items-center gap-1.5 text-[12px] text-muted">
            <ShieldCheck size={14} /> 需主任核准；套用後路線、送貨單車次、A/B 理貨單一次更新並寫入操作紀錄
          </span>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="accent" size="lg" onClick={approve}>
            {allowed ? "確認調整" : `以主任 ${owner.name} 確認調整`}
          </Button>
        </>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-[12px] bg-sunk px-4 py-3 text-[13.5px]">
        <span className="font-semibold">{c.name}</span>
        <VehicleTag v={s.from} />
        <ArrowRight size={14} className="text-faint" />
        <VehicleTag v={s.to} />
        <span className="text-ink-2">第 {s.position} 站</span>
        <span className="text-muted">
          ・與 {m.customers.get(s.nearestNeighbor?.customerId ?? "")?.name} 相距約 {s.nearestNeighbor?.km.toFixed(1)} km；原本 {s.from} 車需繞到 {s.to} 車的服務區再折返
        </span>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[13px] font-semibold text-muted">調整前・v{view.plan.version}</span>
            {beforeFails.length > 0 && <Badge tone="bad">{beforeFails.length} 項限制未過：{beforeFails.map((x) => x.label).join("、")}</Badge>}
          </div>
          <div className="overflow-hidden rounded-[12px] border border-line">
            <RouteMap stops={view.plan.stops} customers={m.customers} highlight={s.customerId} lateIds={[...view.evaluation.routes.A.stops, ...view.evaluation.routes.B.stops].filter((x) => x.late).map((x) => x.customerId)} />
          </div>
          <div className="mt-3">
            <StopList ev={s.before} moved={s.customerId} side="before" />
          </div>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[13px] font-semibold text-ok">調整後・預覽</span>
            <Badge tone="ok">所有限制通過</Badge>
          </div>
          <div className="overflow-hidden rounded-[12px] border border-ok/30">
            <RouteMap stops={s.stops} ghost={view.plan.stops} customers={m.customers} highlight={s.customerId} />
          </div>
          <div className="mt-3">
            <StopList ev={s.after} moved={s.customerId} side="after" />
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-[1fr_1.4fr]">
        <div className="grid grid-cols-3 gap-2">
          {[
            { icon: TrendingDown, label: "里程", v: `−${s.savedKm.toFixed(1)} km` },
            { icon: Timer, label: "總工時", v: `−${Math.round(s.savedMin)} 分` },
            { icon: Fuel, label: "柴油（示意）", v: `−${fuel.toFixed(1)} L` },
          ].map((k) => (
            <div key={k.label} className="rounded-[12px] border border-ok/20 bg-ok-soft/50 px-3 py-3">
              <k.icon size={15} className="text-ok" />
              <div className="num mt-1.5 text-[17px] font-semibold text-ok">{k.v}</div>
              <div className="text-[11.5px] text-muted">{k.label}</div>
            </div>
          ))}
          <div className="col-span-3 text-[11.5px] text-faint">直線距離 × 道路係數 {ROUTING.roadFactor}、均速 {ROUTING.speedKmh} km/h、每站卸貨 {ROUTING.serviceMin} 分；未使用路線 API。</div>
        </div>
        <div className="rounded-[12px] border border-line p-3">
          <div className="mb-2 text-[12.5px] font-semibold">硬性限制檢查（調整後）</div>
          <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
            {all.map((x) => (
              <div key={x.v + x.id} className="flex items-center gap-2 text-[12px]">
                <Check ok={x.pass} size={11} />
                <VehicleTag v={x.v} className="h-4 min-w-4 text-[9.5px]" />
                <span className="text-ink-2">{x.label}</span>
                <span className="num ml-auto text-faint">{x.detail}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
