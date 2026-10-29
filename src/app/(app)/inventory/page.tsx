"use client";

import { AlertTriangle, PackagePlus, Pencil } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { AddMenu } from "@/components/AddMenu";
import { ProductForm } from "@/components/forms/ProductForm";
import { Badge, Bar, Button, Card, Field, Input, Modal, PageHeader, Segmented, Select } from "@/components/ui";
import { WarehouseIso } from "@/components/WarehouseIso";
import { adjustStock, setReorderPoint } from "@/lib/actions";
import { cn } from "@/lib/cn";
import { daysToExpiry, isExpired } from "@/lib/domain/inventory";
import type { InventoryLot, Product, ZoneId } from "@/lib/domain/types";
import { maps, stockPositions } from "@/lib/selectors";
import { useDb, useStore } from "@/lib/store";
import { DEMO_TODAY, formatDateTime } from "@/lib/time";

export default function InventoryPage() {
  return (
    <Suspense>
      <Inventory />
    </Suspense>
  );
}

const fmtQty = (p: Product, q: number) => {
  const packs = Math.floor(q / p.packSize);
  const loose = q % p.packSize;
  return packs ? `${packs} ${p.packUnit}${loose ? ` ${loose} ${p.baseUnit}` : ""}` : `${q} ${p.baseUnit}`;
};

function Inventory() {
  const db = useDb();
  const params = useSearchParams();
  const pos = stockPositions(db);
  const m = maps(db);
  const [tab, setTab] = useState<"stock" | "lots" | "log" | "map">("stock");
  const [zone, setZone] = useState<ZoneId | "all">("all");
  const [editing, setEditing] = useState<Product | null>(null);
  const [adjusting, setAdjusting] = useState<InventoryLot | null>(null);
  const [adding, setAdding] = useState(false);
  const router = useRouter();
  const focus = params.get("sku");

  const products = db.products.filter((p) => zone === "all" || p.zone === zone);
  const lots = useMemo(() => [...db.lots].filter((l) => zone === "all" || l.zone === zone).sort((a, b) => a.zone.localeCompare(b.zone) || a.productId.localeCompare(b.productId) || a.expiry.localeCompare(b.expiry)), [db.lots, zone]);
  const lowCount = db.products.filter((p) => pos.get(p.id)!.belowReorder).length;
  const expiredUnits = [...pos.values()].reduce((a, s) => a + s.expired, 0);
  const near = db.lots.filter((l) => !isExpired(l, DEMO_TODAY) && daysToExpiry(l, DEMO_TODAY) <= 14 && l.qtyOnHand > 0).length;

  return (
    <div className="animate-rise space-y-5">
      <PageHeader
        eyebrow="INVENTORY"
        title="庫存與凍庫"
        sub="可用量 = 現有（排除過期）− 已保留；預估可用 = 可用 + 在途。過期批號不可配貨，分配一律先到期先出（FEFO）。"
        right={
          <>
            <Segmented
              value={tab}
              onChange={setTab}
              options={[
                { value: "stock", label: "品項庫存" },
                { value: "lots", label: "批號／效期" },
                { value: "log", label: "調整紀錄" },
                { value: "map", label: "凍庫配置" },
              ]}
            />
            <AddMenu items={[{ key: "product", label: "新增品項", desc: "品名、架位、價格、補貨點", icon: <PackagePlus size={16} />, perm: "product.manage", onSelect: () => setAdding(true) }]} />
          </>
        }
      />
      {adding && (
        <ProductForm
          onClose={() => setAdding(false)}
          onCreated={(id) => {
            setAdding(false);
            setTab("stock");
            setZone("all");
            router.replace(`/inventory?sku=${id}`, { scroll: false });
          }}
        />
      )}
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { l: "品項", v: db.products.length, t: "" },
          { l: "低於補貨點", v: lowCount, t: lowCount ? "text-warn" : "" },
          { l: "14 天內到期批號", v: near, t: near ? "text-warn" : "" },
          { l: "過期（鎖定不可配）", v: `${expiredUnits} 包`, t: expiredUnits ? "text-bad" : "" },
        ].map((k) => (
          <Card key={k.l} className="px-4 py-3">
            <div className="text-[12px] text-muted">{k.l}</div>
            <div className={cn("num mt-0.5 text-[20px] font-semibold", k.t)}>{k.v}</div>
          </Card>
        ))}
      </div>

      {tab === "map" ? (
        <WarehouseIso />
      ) : (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4 pb-3">
            <Segmented
              size="sm"
              value={zone}
              onChange={setZone}
              options={[{ value: "all", label: "全部凍庫" }, ...(["A", "B", "C", "D"] as ZoneId[]).map((z) => ({ value: z, label: `凍庫 ${z}` }))]}
            />
            <span className="text-[12px] text-faint">數量以基本單位計（包／袋），括號內換算箱</span>
          </div>
          {tab === "stock" && (
            <div className="overflow-x-auto">
              <table className="tbl min-w-[980px]">
                <thead>
                  <tr>
                    <th>品項</th>
                    <th>凍庫・架位</th>
                    <th className="r">現有</th>
                    <th className="r">已保留</th>
                    <th className="r">在途</th>
                    <th className="r">預估可用</th>
                    <th className="w-[220px]">補貨點</th>
                    <th>最近效期</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => {
                    const s = pos.get(p.id)!;
                    return (
                      <tr key={p.id} className={cn("row-hover", focus === p.id && "bg-amber-wash")}>
                        <td>
                          <div className="font-medium">
                            {p.name}
                            {!db.lots.some((l) => l.productId === p.id) && (
                              <Badge tone="ok" className="ml-1.5">
                                新品・尚無庫存
                              </Badge>
                            )}
                          </div>
                          <div className="text-[11.5px] text-faint">
                            {p.sku}・{p.spec}・{m.suppliers.get(p.supplierId)?.name}
                          </div>
                        </td>
                        <td>
                          <Badge tone="info">{p.zone}</Badge> <span className="text-[12px] text-muted">{p.shelf}</span>
                        </td>
                        <td className="r num">
                          {s.onHand}
                          {s.expired > 0 && <div className="text-[11px] text-bad">含過期 {s.expired}</div>}
                        </td>
                        <td className="r num text-muted">{s.reserved || "—"}</td>
                        <td className="r num text-muted">{s.inbound || "—"}</td>
                        <td className="r num font-semibold">
                          <span className={s.belowReorder ? "text-warn" : ""}>{s.projected}</span>
                          <div className="text-[11px] font-normal text-faint">{fmtQty(p, Math.max(0, s.projected))}</div>
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            <div className="flex-1">
                              <Bar value={Math.max(0, s.projected)} max={Math.max(p.reorderPoint * 2, s.projected)} tone={s.belowReorder ? "amber" : "ok"} />
                              <div className="mt-1 flex justify-between text-[11px] text-muted">
                                <span>門檻 {fmtQty(p, p.reorderPoint)}</span>
                                {s.belowReorder && <span className="font-medium text-warn">需補貨</span>}
                              </div>
                            </div>
                            <button onClick={() => setEditing(p)} className="grid h-7 w-7 place-items-center rounded-md text-faint hover:bg-sunk hover:text-ink" aria-label="修改補貨點">
                              <Pencil size={13} />
                            </button>
                          </div>
                        </td>
                        <td className="num text-[12.5px]">{s.nearestExpiry ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {tab === "lots" && (
            <div className="overflow-x-auto">
              <table className="tbl min-w-[900px]">
                <thead>
                  <tr>
                    <th>凍庫</th>
                    <th>品項</th>
                    <th>批號</th>
                    <th>入庫</th>
                    <th>效期</th>
                    <th className="r">現有</th>
                    <th className="r">已保留</th>
                    <th>狀態</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {lots.map((l) => {
                    const p = m.products.get(l.productId)!;
                    const exp = isExpired(l, DEMO_TODAY);
                    const d = daysToExpiry(l, DEMO_TODAY);
                    return (
                      <tr key={l.id} className={cn("row-hover", exp && "bg-bad-soft/30")}>
                        <td>
                          <Badge tone="info">{l.zone}</Badge>
                        </td>
                        <td>{p.name}</td>
                        <td className="num">{l.lot}</td>
                        <td className="num text-muted">{l.receivedAt}</td>
                        <td className="num">{l.expiry}</td>
                        <td className="r num">{l.qtyOnHand}</td>
                        <td className="r num text-muted">{l.qtyReserved || "—"}</td>
                        <td>
                          {exp ? (
                            <Badge tone="bad">
                              <AlertTriangle size={11} /> 已過期・不可配貨
                            </Badge>
                          ) : d <= 14 ? (
                            <Badge tone="warn">{d} 天內到期・FEFO 優先</Badge>
                          ) : (
                            <Badge tone="ok">正常</Badge>
                          )}
                        </td>
                        <td className="r">
                          <Button size="sm" variant="ghost" onClick={() => setAdjusting(l)}>
                            盤點／調整
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {tab === "log" && (
            <div className="px-5 pb-5">
              {db.adjustments.length === 0 ? (
                <div className="rounded-[10px] bg-sunk px-4 py-8 text-center text-[13px] text-muted">尚無盤點或調整紀錄。調整需填寫原因，盤點與帳面調整分開記錄。</div>
              ) : (
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>時間</th>
                      <th>類型</th>
                      <th>批號</th>
                      <th className="r">差異</th>
                      <th>原因</th>
                      <th>人員</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...db.adjustments].reverse().map((a) => {
                      const lot = m.lots.get(a.lotId);
                      return (
                        <tr key={a.id}>
                          <td className="num">{formatDateTime(a.at)}</td>
                          <td>{a.kind === "physical_count" ? "實地盤點" : "帳面調整"}</td>
                          <td>
                            {m.products.get(lot?.productId ?? "")?.name} {lot?.lot}
                          </td>
                          <td className={cn("r num", a.delta < 0 ? "text-bad" : "text-ok")}>
                            {a.delta > 0 ? "+" : ""}
                            {a.delta}
                          </td>
                          <td>{a.reason}</td>
                          <td>{m.users.get(a.actorId)?.name}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </Card>
      )}
      {editing && <ThresholdModal p={editing} onClose={() => setEditing(null)} />}
      {adjusting && <AdjustModal lot={adjusting} onClose={() => setAdjusting(null)} />}
    </div>
  );
}

function ThresholdModal({ p, onClose }: { p: Product; onClose: () => void }) {
  const db = useDb();
  const run = useStore((s) => s.run);
  const s = stockPositions(db).get(p.id)!;
  const [packs, setPacks] = useState(String(Math.round(p.reorderPoint / p.packSize)));
  const [reason, setReason] = useState("");
  const q = Math.round(Number(packs || 0)) * p.packSize;
  const proc = db.users.find((u) => u.role === "procurement")!;
  return (
    <Modal
      open
      onClose={onClose}
      width={460}
      title={`修改補貨點・${p.name}`}
      sub="只影響低庫存提醒與補貨建議，不會自動叫貨"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" onClick={() => run((d, c) => setReorderPoint(d, c, p.id, q, reason || "手動調整"), "補貨點已更新") && onClose()}>
            確認變更
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label={`新補貨點（${p.packUnit}）`} hint={`= ${q} ${p.baseUnit}`}>
            <Input type="number" min={0} value={packs} onChange={(e) => setPacks(e.target.value)} />
          </Field>
          <Field label="原因">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例如：天冷需求上升" />
          </Field>
        </div>
        <div className="rounded-[10px] bg-sunk px-3 py-2.5 text-[12.5px] text-ink-2">
          目前預估可用 <b className="num">{s.projected}</b> {p.baseUnit}；變更後{s.projected < q ? <span className="font-semibold text-warn"> 會觸發補貨建議</span> : " 不觸發補貨"}。
        </div>
        <div className="text-[11.5px] text-faint">權限：採購（{proc.name}）或主任</div>
      </div>
    </Modal>
  );
}

function AdjustModal({ lot, onClose }: { lot: InventoryLot; onClose: () => void }) {
  const db = useDb();
  const run = useStore((s) => s.run);
  const p = maps(db).products.get(lot.productId)!;
  const [kind, setKind] = useState<"physical_count" | "ledger_adjustment">("physical_count");
  const [qty, setQty] = useState(String(lot.qtyOnHand));
  const [reason, setReason] = useState("");
  return (
    <Modal
      open
      onClose={onClose}
      width={480}
      title={`${p.name}・批號 ${lot.lot}`}
      sub={`帳面 ${lot.qtyOnHand} ${p.baseUnit}・已保留 ${lot.qtyReserved}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" onClick={() => run((d, c) => adjustStock(d, c, lot.id, kind, Number(qty), reason), "已記錄並寫入操作紀錄") && onClose()}>
            送出
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="類型">
          <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="physical_count">實地盤點（輸入實際數量）</option>
            <option value="ledger_adjustment">帳面調整（輸入增減量，例如 −2）</option>
          </Select>
        </Field>
        <Field label={kind === "physical_count" ? "實際數量" : "增減量"}>
          <Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
        <Field label="原因（必填）">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例如：盤點差異、破損報廢、過期銷毀" />
        </Field>
      </div>
    </Modal>
  );
}
