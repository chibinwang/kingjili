"use client";

import { Info, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Drawer, Field, Input, Money, Segmented, Select } from "@/components/ui";
import { createSupplier, draftPurchaseOrders } from "@/lib/actions";
import { fieldErrors, findSupplierDuplicates, supplierSchema, type SupplierInput } from "@/lib/domain/forms";
import { lineAmount } from "@/lib/money";
import { stockPositions } from "@/lib/selectors";
import { useDb, useStore } from "@/lib/store";
import { addDays, DEMO_TODAY, formatDate } from "@/lib/time";

export function SupplierForm({ onClose }: { onClose: () => void }) {
  const db = useDb();
  const runWith = useStore((s) => s.runWith);
  const [v, setV] = useState<SupplierInput>({ name: "", contactName: "", phone: "", channel: "phone", email: "", leadTimeDays: 2 });
  const [tried, setTried] = useState(false);
  const parsed = supplierSchema.safeParse(v);
  const errs = tried && !parsed.success ? fieldErrors(parsed.error) : {};
  const dups = findSupplierDuplicates(db.suppliers, v.name);
  const set = <K extends keyof SupplierInput>(k: K, val: SupplierInput[K]) => setV((x) => ({ ...x, [k]: val }));
  const submit = () => {
    setTried(true);
    if (!parsed.success || dups.length) return;
    if (runWith((d, ctx) => createSupplier(d, ctx, v))) {
      toast.success(`已新增供應商 ${v.name}，待主管核准`);
      onClose();
    }
  };
  return (
    <Drawer
      open
      onClose={onClose}
      width={520}
      title="新增供應商"
      sub="新供應商需經主管核准後，才可叫貨或列入自動補貨。"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" onClick={submit}>
            建立供應商
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="供應商名稱" required error={dups.length ? "已有同名供應商" : errs.name} className="col-span-2">
          <Input value={v.name} onChange={(e) => set("name", e.target.value)} autoFocus />
        </Field>
        <Field label="聯絡人" required error={errs.contactName}>
          <Input value={v.contactName} onChange={(e) => set("contactName", e.target.value)} />
        </Field>
        <Field label="電話" required error={errs.phone}>
          <Input value={v.phone} onChange={(e) => set("phone", e.target.value)} inputMode="tel" className="num" />
        </Field>
        <Field group label="叫貨管道" className="col-span-2">
          <Segmented
            value={v.channel}
            onChange={(c) => set("channel", c)}
            options={[
              { value: "phone", label: "電話" },
              { value: "line_group", label: "LINE 群組" },
              { value: "email", label: "Email" },
            ]}
          />
        </Field>
        {v.channel === "email" && (
          <Field label="Email" required error={errs.email} className="col-span-2">
            <Input type="email" value={v.email} onChange={(e) => set("email", e.target.value)} />
          </Field>
        )}
        <Field label="交期（天）" required error={errs.leadTimeDays} hint="叫貨到收貨的天數">
          <Input type="number" min={0} max={30} value={v.leadTimeDays} onChange={(e) => set("leadTimeDays", Number(e.target.value))} className="num" />
        </Field>
        {v.channel === "line_group" && (
          <div className="col-span-2 flex items-start gap-2 rounded-lg border border-info/25 bg-info-soft px-3 py-2 text-[12.5px] text-info">
            <Info size={14} className="mt-0.5 shrink-0" />
            LINE 群組建立後為「未驗證」：需官方帳號機器人在群組內並收到 group ID 事件，才能透過 LINE 發送叫貨單；驗證前請改用電話。
          </div>
        )}
      </div>
    </Drawer>
  );
}

export function PurchaseOrderForm({ onClose }: { onClose: () => void }) {
  const db = useDb();
  const run = useStore((s) => s.run);
  const pos = stockPositions(db);
  const approved = db.suppliers.filter((s) => s.approved);
  const [supplierId, setSupplierId] = useState(approved[0]?.id ?? "");
  const s = db.suppliers.find((x) => x.id === supplierId);
  const products = db.products.filter((p) => p.supplierId === supplierId);
  const [qty, setQty] = useState<Record<string, number>>({});
  const suggested = (id: string) => pos.get(id)?.suggestedQty ?? 0;
  const q = (id: string) => qty[id] ?? suggested(id);
  const lines = products.map((p) => ({ productId: p.id, qtyBase: q(p.id) })).filter((l) => l.qtyBase > 0);
  const total = lines.reduce((a, l) => a + lineAmount(l.qtyBase, db.products.find((p) => p.id === l.productId)!.costCents ?? 0), 0);
  const unapproved = db.suppliers.filter((x) => !x.approved);
  return (
    <Drawer
      open
      onClose={onClose}
      width={620}
      title="手動建立採購單"
      sub="建立後為「待主管核准」，核准後才可發送（模擬）。"
      footer={
        <>
          <div className="mr-auto text-[12.5px] text-muted">
            預估成本 <Money cents={total} className="text-[15px] font-semibold text-ink" />
          </div>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" disabled={!lines.length} onClick={() => run((d, ctx) => draftPurchaseOrders(d, ctx, lines, "manual"), "已建立採購單，待主管核准") && onClose()}>
            建立採購單
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="供應商" required hint={unapproved.length ? `${unapproved.map((x) => x.name).join("、")} 尚未核准，暫不可選` : undefined}>
            <Select
              value={supplierId}
              onChange={(e) => {
                setSupplierId(e.target.value);
                setQty({});
              }}
            >
              {approved.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          </Field>
          {s && (
            <Field group label="預計到貨">
              <div className="flex h-9 items-center text-[13px]">
                {formatDate(addDays(DEMO_TODAY, s.leadTimeDays), { weekday: true })}
                <span className="ml-1.5 text-muted">（交期 {s.leadTimeDays} 天）</span>
              </div>
            </Field>
          )}
        </div>
        {s && s.channel === "line_group" && !s.lineGroupVerified && (
          <div className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-[12.5px] text-warn">
            <TriangleAlert size={14} className="mt-0.5 shrink-0" /> {s.name} LINE 群組未驗證，核准後需改用電話叫貨。
          </div>
        )}
        {products.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line-strong py-8 text-center text-[12.5px] text-muted">此供應商目前沒有對應品項</div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>品項</th>
                <th className="r">預估可用</th>
                <th className="r">補貨點</th>
                <th className="r">叫貨量（基本單位）</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const sp = pos.get(p.id)!;
                return (
                  <tr key={p.id}>
                    <td>
                      <div className="font-medium">{p.name}</div>
                      <div className="text-[11px] text-faint">
                        {p.spec}・每{p.packUnit} {p.packSize} {p.baseUnit}
                      </div>
                    </td>
                    <td className="r num">
                      {sp.projected}
                      {sp.belowReorder && (
                        <div>
                          <Badge tone="warn">低於補貨點</Badge>
                        </div>
                      )}
                    </td>
                    <td className="r num text-muted">{p.reorderPoint}</td>
                    <td className="r">
                      <Input type="number" min={0} step={p.packSize} value={q(p.id)} onChange={(e) => setQty((x) => ({ ...x, [p.id]: Math.max(0, Math.round(Number(e.target.value))) }))} className="num ml-auto h-8 w-[96px] text-right" aria-label={`${p.name} 叫貨量`} />
                      <div className="mt-0.5 text-[11px] text-faint">{q(p.id) ? `≈ ${(q(p.id) / p.packSize).toFixed(1)} ${p.packUnit}` : "不叫"}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="text-[11.5px] text-muted">叫貨量預設帶入補貨建議，可自行調整；0 代表不叫。</p>
      </div>
    </Drawer>
  );
}
