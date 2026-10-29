"use client";

import { TriangleAlert } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Button, Drawer, Field, Input, Segmented, Select } from "@/components/ui";
import { createCustomer } from "@/lib/actions";
import { customerSchema, DEFAULT_CREDIT, fieldErrors, findCustomerDuplicates, SUBTYPE_SUGGESTIONS, type CustomerInput } from "@/lib/domain/forms";
import { useDb, useStore } from "@/lib/store";
import { DEMO_TODAY } from "@/lib/time";
import { toast } from "sonner";

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

export function CustomerForm({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const db = useDb();
  const runWith = useStore((s) => s.runWith);
  const userId = useStore((s) => s.userId);
  const sales = db.users.filter((u) => u.role === "sales" || u.role === "owner");
  const districts = useMemo(() => [...new Set(db.customers.map((c) => c.district))].sort(), [db.customers]);
  const nextNo = String(db.customers.length + 1).padStart(2, "0");
  const [v, setV] = useState<CustomerInput>({
    name: "",
    code: `K${nextNo}`,
    segment: "餐廳",
    subType: "",
    ownerName: "",
    phone: "",
    contactName: "",
    onboardedAt: DEMO_TODAY,
    accountManagerId: sales.find((u) => u.id === userId)?.id ?? "u-sales",
    address: "",
    district: districts[0] ?? "",
    windowStart: "09:00",
    windowEnd: "12:00",
    settlementTerms: "daily",
    sameDaySharePct: 50,
    creditLimit: DEFAULT_CREDIT.daily,
    priceTier: "standard",
    invoiceClass: "B2C",
    taxId: "",
    carrierType: "none",
    carrierValue: "",
  });
  const [tried, setTried] = useState(false);
  const [dupOk, setDupOk] = useState(false);
  const set = <K extends keyof CustomerInput>(k: K, val: CustomerInput[K]) => setV((x) => ({ ...x, [k]: val }));

  const parsed = customerSchema.safeParse(v);
  const errs = tried && !parsed.success ? fieldErrors(parsed.error) : {};
  const dups = findCustomerDuplicates(db.customers, { name: v.name, phone: v.phone, taxId: v.invoiceClass === "B2B" ? v.taxId : undefined });
  const codeTaken = db.customers.some((c) => c.code === v.code.trim());

  const submit = () => {
    setTried(true);
    if (!parsed.success || codeTaken || (dups.length && !dupOk)) return;
    const id = runWith((d, ctx) => createCustomer(d, ctx, v));
    if (id) {
      toast.success(`已新增客戶 ${v.name}`);
      onCreated(id);
    }
  };

  return (
    <Drawer
      open
      onClose={onClose}
      width={620}
      title="新增客戶"
      sub="建檔後即可接單；LINE 綁定與地圖座標可稍後確認。"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" onClick={submit}>
            建立客戶
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        {dups.length > 0 && (
          <div className="rounded-lg border border-warn/30 bg-warn-soft px-3 py-2.5 text-[12.5px] text-warn">
            <div className="flex items-start gap-2">
              <TriangleAlert size={14} className="mt-0.5 shrink-0" />
              <div>
                可能重複：{dups.map((c) => `${c.name}（${c.code}・${c.phone}）`).join("、")}
                <label className="mt-1.5 flex items-center gap-1.5 text-ink-2">
                  <input type="checkbox" checked={dupOk} onChange={(e) => setDupOk(e.target.checked)} /> 我已確認不是同一家，仍要建立
                </label>
              </div>
            </div>
          </div>
        )}

        <Section n={1} title="基本資料">
          <div className="grid grid-cols-2 gap-3">
            <Field label="客戶名稱" required error={errs.name} className="col-span-2 sm:col-span-1">
              <Input value={v.name} onChange={(e) => set("name", e.target.value)} placeholder="例：旺角炸雞" autoFocus />
            </Field>
            <Field label="客戶代號" required error={codeTaken ? `代號 ${v.code} 已被使用` : errs.code} hint="對帳單、理貨單上顯示" className="col-span-2 sm:col-span-1">
              <Input value={v.code} onChange={(e) => set("code", e.target.value.toUpperCase())} className="num" />
            </Field>
            <Field group label="類型" required className="col-span-2 sm:col-span-1">
              <Segmented value={v.segment} onChange={(s) => setV((x) => ({ ...x, segment: s, subType: "" }))} options={[{ value: "餐廳", label: "餐廳" }, { value: "炸物店", label: "炸物店" }]} />
            </Field>
            <Field label="細分類" required error={errs.subType} className="col-span-2 sm:col-span-1">
              <Input value={v.subType} onChange={(e) => set("subType", e.target.value)} list="subtypes" placeholder={SUBTYPE_SUGGESTIONS[v.segment].join("、")} />
              <datalist id="subtypes">
                {SUBTYPE_SUGGESTIONS[v.segment].map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </Field>
            <Field label="負責人" required error={errs.ownerName}>
              <Input value={v.ownerName} onChange={(e) => set("ownerName", e.target.value)} />
            </Field>
            <Field label="聯絡電話" required error={errs.phone}>
              <Input value={v.phone} onChange={(e) => set("phone", e.target.value)} placeholder="0912-345-678" inputMode="tel" className="num" />
            </Field>
            <Field label="聯絡窗口" hint="收貨／對帳的人；空白則同負責人">
              <Input value={v.contactName} onChange={(e) => set("contactName", e.target.value)} placeholder={v.ownerName || "同負責人"} />
            </Field>
            <Field label="往來起始" required error={errs.onboardedAt}>
              <Input type="date" value={v.onboardedAt} max={DEMO_TODAY} onChange={(e) => set("onboardedAt", e.target.value)} />
            </Field>
            <Field label="負責業務" required>
              <Select value={v.accountManagerId} onChange={(e) => set("accountManagerId", e.target.value)}>
                {sales.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}（{u.title}）
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Section>

        <Section n={2} title="配送">
          <div className="grid grid-cols-2 gap-3">
            <Field label="地址" required error={errs.address} className="col-span-2">
              <Input value={v.address} onChange={(e) => set("address", e.target.value)} />
            </Field>
            <Field label="地區" required hint="地圖座標先以地區中心估算，標示「座標待確認」">
              <Select value={v.district} onChange={(e) => set("district", e.target.value)}>
                {districts.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </Select>
            </Field>
            <Field group label="收貨時段" required error={errs.windowEnd ?? errs.windowStart}>
              <div className="flex items-center gap-1.5">
                <Input type="time" value={v.windowStart} onChange={(e) => set("windowStart", e.target.value)} aria-label="收貨開始" />
                <span className="text-muted">–</span>
                <Input type="time" value={v.windowEnd} onChange={(e) => set("windowEnd", e.target.value)} aria-label="收貨結束" />
              </div>
            </Field>
          </div>
        </Section>

        <Section n={3} title="結帳與發票">
          <div className="grid grid-cols-2 gap-3">
            <Field group label="結帳方式" required className="col-span-2">
              <Segmented
                value={v.settlementTerms}
                onChange={(t) => setV((x) => ({ ...x, settlementTerms: t, creditLimit: DEFAULT_CREDIT[t] }))}
                options={[
                  { value: "daily", label: "日結（司機收款）" },
                  { value: "monthly", label: "月結" },
                  { value: "mixed", label: "混合" },
                ]}
              />
            </Field>
            {v.settlementTerms === "mixed" && (
              <Field label="送貨時收取比例 %" required error={errs.sameDaySharePct}>
                <Input type="number" min={1} max={99} value={v.sameDaySharePct} onChange={(e) => set("sameDaySharePct", Number(e.target.value))} className="num" />
              </Field>
            )}
            <Field label="信用額度（元）" required error={errs.creditLimit} hint="預設依結帳方式帶入">
              <Input type="number" min={0} step={1000} value={v.creditLimit} onChange={(e) => set("creditLimit", Number(e.target.value))} className="num" />
            </Field>
            <Field label="價格等級">
              <Select value={v.priceTier} onChange={(e) => set("priceTier", e.target.value as CustomerInput["priceTier"])}>
                <option value="standard">一般價</option>
                <option value="volume">量販價</option>
                <option value="vip">VIP 價</option>
              </Select>
            </Field>
            <Field group label="發票" required className="col-span-2">
              <Segmented
                value={v.invoiceClass}
                onChange={(c) => set("invoiceClass", c)}
                options={[
                  { value: "B2C", label: "B2C（個人／載具）" },
                  { value: "B2B", label: "B2B（統編）" },
                ]}
              />
            </Field>
            {v.invoiceClass === "B2B" ? (
              <Field label="統一編號" required error={errs.taxId} hint="8 碼，系統即時驗證檢查碼">
                <Input value={v.taxId} onChange={(e) => set("taxId", e.target.value.replace(/\D/g, "").slice(0, 8))} inputMode="numeric" className="num" />
              </Field>
            ) : (
              <>
                <Field label="載具">
                  <Select value={v.carrierType} onChange={(e) => set("carrierType", e.target.value as CustomerInput["carrierType"])}>
                    <option value="none">紙本</option>
                    <option value="mobile">手機條碼</option>
                    <option value="member">會員載具</option>
                    <option value="citizen">自然人憑證</option>
                  </Select>
                </Field>
                {v.carrierType !== "none" && (
                  <Field label="載具號碼" required error={errs.carrierValue} hint={v.carrierType === "mobile" ? "/ 加 7 碼，例 /AB12C3D" : undefined}>
                    <Input value={v.carrierValue} onChange={(e) => set("carrierValue", e.target.value.toUpperCase())} className="num" />
                  </Field>
                )}
              </>
            )}
          </div>
        </Section>
        <p className="text-[11.5px] text-muted">LINE 官方帳號：新客戶預設「未綁定」，需客戶加入官方帳號並完成綁定後才能收到對帳通知。</p>
      </div>
    </Drawer>
  );
}
