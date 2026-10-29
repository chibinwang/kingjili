"use client";

import { Info } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button, Drawer, Field, Input, Segmented, Select } from "@/components/ui";
import { createProduct } from "@/lib/actions";
import { fieldErrors, nextShelf, productSchema, splitAliases, type ProductInput } from "@/lib/domain/forms";
import { productAliases } from "@/lib/domain/lineParser";
import type { ZoneId } from "@/lib/domain/types";
import { useDb, useStore } from "@/lib/store";

function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink">
        <span className="grid h-5 w-5 place-items-center rounded-full bg-ink text-[11px] text-white">{n}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

const num = (s: string) => (s.trim() === "" ? NaN : Number(s));

export function ProductForm({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const db = useDb();
  const runWith = useStore((s) => s.runWith);
  const [v, setV] = useState<ProductInput>({
    name: "",
    category: "冷凍炸物",
    spec: "",
    baseUnit: "包",
    packSize: 10,
    weightGram: 1000,
    zone: "A",
    shelf: nextShelf(db.products, "A"),
    tempC: -18,
    supplierId: db.suppliers.find((s) => s.approved)?.id ?? "",
    cost: null,
    priceStandard: NaN,
    priceVolume: NaN,
    priceVip: NaN,
    reorderPointPacks: 4,
    reorderQtyPacks: 6,
    aliases: "",
  });
  // Volume / VIP follow the standard price (96% / 92%, like the existing catalogue) until edited by hand.
  const [tierTouched, setTierTouched] = useState(false);
  const [tried, setTried] = useState(false);
  const set = <K extends keyof ProductInput>(k: K, val: ProductInput[K]) => setV((x) => ({ ...x, [k]: val }));

  const parsed = productSchema.safeParse(v);
  const errs = tried && !parsed.success ? fieldErrors(parsed.error) : {};
  const nameTaken = db.products.some((p) => p.name === v.name.trim());
  const shelfTaken = db.products.some((p) => p.shelf === v.shelf.trim());
  const taken = new Map(productAliases(db.products).flatMap(([id, ns]) => ns.map((n) => [n, id] as const)));
  const clash = [v.name.trim(), ...splitAliases(v.aliases)].filter(Boolean).find((a) => taken.has(a));
  const clashMsg = clash ? `「${clash}」已是 ${db.products.find((p) => p.id === taken.get(clash))?.name} 的 LINE 名稱` : undefined;
  const supplier = db.suppliers.find((s) => s.id === v.supplierId);

  const submit = () => {
    setTried(true);
    if (!parsed.success || nameTaken || shelfTaken || clash) return;
    const id = runWith((d, ctx) => createProduct(d, ctx, v));
    if (id) {
      toast.success(`已新增 ${v.name}。庫存為 0，請到「採購」建立採購單入庫。`);
      onCreated(id);
    }
  };

  return (
    <Drawer
      open
      onClose={onClose}
      width={640}
      title="新增品項"
      sub="建檔後即可接單與叫貨；首批庫存透過採購單收貨入庫（含批號與效期）。"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" onClick={submit}>
            建立品項
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <Section n={1} title="品項資料">
          <div className="grid grid-cols-2 gap-3">
            <Field label="品名" required error={nameTaken ? "已有同名品項" : errs.name} className="col-span-2 sm:col-span-1">
              <Input value={v.name} onChange={(e) => set("name", e.target.value)} placeholder="例：洋芋球" autoFocus />
            </Field>
            <Field label="分類" required className="col-span-2 sm:col-span-1">
              <Select value={v.category} onChange={(e) => set("category", e.target.value as ProductInput["category"])}>
                <option>冷凍炸物</option>
                <option>蔬食</option>
                <option>調理品</option>
              </Select>
            </Field>
            <Field label="規格" required error={errs.spec} hint="印在理貨單與對帳單上">
              <Input value={v.spec} onChange={(e) => set("spec", e.target.value)} placeholder="1kg／包" />
            </Field>
            <Field group label="基本單位" required>
              <Segmented value={v.baseUnit} onChange={(u) => set("baseUnit", u)} options={[{ value: "包", label: "包" }, { value: "袋", label: "袋" }]} />
            </Field>
            <Field label={`每箱幾${v.baseUnit}`} required error={errs.packSize}>
              <Input type="number" min={1} value={Number.isNaN(v.packSize) ? "" : v.packSize} onChange={(e) => set("packSize", num(e.target.value))} className="num" />
            </Field>
            <Field label={`每${v.baseUnit}重量（g）`} required error={errs.weightGram} hint="用於貨車載重計算">
              <Input type="number" min={1} value={Number.isNaN(v.weightGram) ? "" : v.weightGram} onChange={(e) => set("weightGram", num(e.target.value))} className="num" />
            </Field>
          </div>
        </Section>

        <Section n={2} title="存放位置">
          <div className="grid grid-cols-2 gap-3">
            <Field group label="凍庫" required className="col-span-2">
              <Segmented value={v.zone} onChange={(z: ZoneId) => setV((x) => ({ ...x, zone: z, shelf: nextShelf(db.products, z) }))} options={(["A", "B", "C", "D"] as const).map((z) => ({ value: z, label: `凍庫 ${z}` }))} />
            </Field>
            <Field label="架位" required error={shelfTaken ? `架位 ${v.shelf} 已被使用` : errs.shelf} hint="預設帶入該凍庫下一個空架位">
              <Input value={v.shelf} onChange={(e) => set("shelf", e.target.value.toUpperCase())} className="num" />
            </Field>
            <Field label="溫層">
              <Select value={v.tempC} onChange={(e) => set("tempC", Number(e.target.value) as -18 | -25)}>
                <option value={-18}>−18°C 冷凍</option>
                <option value={-25}>−25°C 超低溫</option>
              </Select>
            </Field>
          </div>
        </Section>

        <Section n={3} title="價格與成本（未稅，每基本單位）">
          <div className="grid grid-cols-3 gap-3">
            <Field label="一般價" required error={errs.priceStandard}>
              <Input
                type="number"
                min={1}
                value={Number.isNaN(v.priceStandard) ? "" : v.priceStandard}
                onChange={(e) => {
                  const n = num(e.target.value);
                  setV((x) => ({ ...x, priceStandard: n, ...(tierTouched || Number.isNaN(n) ? {} : { priceVolume: Math.round(n * 0.96), priceVip: Math.round(n * 0.92) }) }));
                }}
                className="num"
              />
            </Field>
            <Field label="量販價" required error={errs.priceVolume} hint={tierTouched ? undefined : "自動 96%"}>
              <Input
                type="number"
                min={1}
                value={Number.isNaN(v.priceVolume) ? "" : v.priceVolume}
                onChange={(e) => {
                  setTierTouched(true);
                  set("priceVolume", num(e.target.value));
                }}
                className="num"
              />
            </Field>
            <Field label="VIP 價" required error={errs.priceVip} hint={tierTouched ? undefined : "自動 92%"}>
              <Input
                type="number"
                min={1}
                value={Number.isNaN(v.priceVip) ? "" : v.priceVip}
                onChange={(e) => {
                  setTierTouched(true);
                  set("priceVip", num(e.target.value));
                }}
                className="num"
              />
            </Field>
            <Field label="進貨成本" error={errs.cost} hint="空白＝尚無成本，毛利會標示不完整" className="col-span-3 sm:col-span-1">
              <Input type="number" min={0} value={v.cost ?? ""} onChange={(e) => set("cost", e.target.value.trim() === "" ? null : Number(e.target.value))} className="num" />
            </Field>
          </div>
        </Section>

        <Section n={4} title="採購與補貨">
          <div className="grid grid-cols-2 gap-3">
            <Field label="供應商" required error={errs.supplierId} className="col-span-2" hint={supplier && !supplier.approved ? `${supplier.name} 尚未核准，核准前不可叫貨` : undefined}>
              <Select value={v.supplierId} onChange={(e) => set("supplierId", e.target.value)}>
                {db.suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.approved ? "" : "（未核准）"}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="補貨點（箱）" required error={errs.reorderPointPacks} hint={`預估可用低於 ${(v.reorderPointPacks || 0) * (v.packSize || 0)} ${v.baseUnit} 時建議叫貨`}>
              <Input type="number" min={0} value={Number.isNaN(v.reorderPointPacks) ? "" : v.reorderPointPacks} onChange={(e) => set("reorderPointPacks", num(e.target.value))} className="num" />
            </Field>
            <Field label="每次叫貨量（箱）" required error={errs.reorderQtyPacks}>
              <Input type="number" min={1} value={Number.isNaN(v.reorderQtyPacks) ? "" : v.reorderQtyPacks} onChange={(e) => set("reorderQtyPacks", num(e.target.value))} className="num" />
            </Field>
          </div>
        </Section>

        <Section n={5} title="LINE 下單辨識">
          <Field label="客戶常用叫法（選填）" error={clashMsg} hint="以逗號或頓號分隔，例：洋芋球、馬鈴薯球。AI 解析 LINE 訊息時會用品名與這些名稱比對。">
            <Input value={v.aliases} onChange={(e) => set("aliases", e.target.value)} />
          </Field>
        </Section>

        <div className="flex items-start gap-2 rounded-lg border border-info/25 bg-info-soft px-3 py-2 text-[12.5px] text-info">
          <Info size={14} className="mt-0.5 shrink-0" />
          新品項庫存為 0。到「採購」按 ＋ 建立採購單，收貨時填入批號與效期，才會有可配貨庫存（FEFO）。
        </div>
      </div>
    </Drawer>
  );
}
