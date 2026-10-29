"use client";

import { ArrowLeft, Download, Eye, PencilLine, RotateCcw, Undo2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { StatementChat } from "@/components/statement/StatementChat";
import { StatementTemplate } from "@/components/statement/StatementTemplate";
import { Badge, Button, Card, PageHeader, Segmented, Select } from "@/components/ui";
import { cn } from "@/lib/cn";
import { TERMS_LABEL } from "@/lib/domain/ar";
import { applyStatementCommand } from "@/lib/domain/statementCommands";
import { buildStatementDoc, changedFields, docTotals, type StatementDoc } from "@/lib/domain/statementDoc";
import { buildStatement, snapshotHash } from "@/lib/domain/statements";
import { formatTWD } from "@/lib/money";
import { draftKey, useStatementDrafts } from "@/lib/statementDrafts";
import { useDb } from "@/lib/store";
import { DEMO_TODAY, formatPeriod, periodOf } from "@/lib/time";

const PERIODS = ["2026-10", "2026-09", "2026-08"];
const DOC_WIDTH = 794;

export default function StatementEditorPage() {
  return (
    <Suspense>
      <Editor />
    </Suspense>
  );
}

function Editor() {
  const db = useDb();
  const params = useSearchParams();
  const router = useRouter();
  const customers = db.customers;
  const customer = customers.find((c) => c.id === params.get("customer")) ?? customers.find((c) => c.settlementTerms === "monthly") ?? customers[0];
  const period = PERIODS.includes(params.get("period") ?? "") ? params.get("period")! : periodOf(DEMO_TODAY);
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const go = (customerId: string, p: string) => router.replace(`/accounting/statement?customer=${customerId}&period=${p}`, { scroll: false });

  const key = draftKey(customer.id, period);
  const draft = useStatementDrafts((s) => s.drafts[key]);
  const messages = useStatementDrafts((s) => s.chats[key]);
  const { save, undo, discard, say } = useStatementDrafts.getState();

  const { base, ledgerClosing } = useMemo(() => {
    const st = buildStatement(customer, period, db.arDocs, db.payments, db.allocations, db.invoices);
    const locked = db.statements.filter((s) => s.customerId === customer.id && s.period === period && s.status !== "superseded").sort((a, b) => b.version - a.version)[0];
    const fresh = locked && snapshotHash(st.lines) === locked.snapshotHash;
    const name = (role: string) => db.users.find((u) => u.role === role)?.name ?? "";
    const people = { salesName: db.users.find((u) => u.id === customer.accountManagerId)?.name ?? name("sales"), preparedBy: name("accounting"), approvedBy: name("owner") };
    const source = fresh ? { ...st, lines: locked.lines, totals: locked.totals, version: locked.version } : st;
    return { base: buildStatementDoc(customer, source, db.arDocs, people), ledgerClosing: source.totals.closingCents };
  }, [customer, period, db]);

  const doc = draft?.doc ?? base;
  const changed = useMemo(() => changedFields(base, doc), [base, doc]);
  const closing = docTotals(doc).closingCents;
  const diff = closing - ledgerClosing;

  const commit = (next: StatementDoc) => {
    if (changedFields(base, next).size === 0) discard(key);
    else save(key, next, doc);
  };

  const onCommand = (text: string) => {
    say(key, { role: "user", text });
    const r = applyStatementCommand(doc, base, text, period);
    if (!r.ok) return say(key, { role: "agent", text: r.reply, ok: false });
    commit(r.doc);
    const after = docTotals(r.doc).closingCents;
    const tail = after !== closing ? `\n本期應付 ${formatTWD(closing)} → ${formatTWD(after)}。` : "";
    say(key, { role: "agent", text: r.reply + tail, ok: true, changes: r.changes });
  };

  const download = () => {
    const prev = document.title;
    // browsers use the page title as the suggested PDF file name
    document.title = `金吉利_${doc.customer.name}_${formatPeriod(period).replace(/\s/g, "")}對帳單`;
    window.addEventListener("afterprint", () => (document.title = prev), { once: true });
    window.print();
  };

  // scale the A4 page down to fit narrower screens
  const frameRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setZoom(Math.min(1, (e.contentRect.width - 8) / DOC_WIDTH)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="animate-rise">
      <div className="no-print">
        <PageHeader
          eyebrow="BILLING · STATEMENT"
          title="月結對帳單"
          sub="預覽寄給客戶的對帳單。切到「編輯」可直接點文字修改，或在右側用一句話請助理調整；修改只影響這份文件，不會改動帳務。"
          right={
            <Link href={`/accounting?period=${period}`}>
              <Button variant="ghost">
                <ArrowLeft size={14} /> 回帳單與會計
              </Button>
            </Link>
          }
        />

        <Card className="mb-4 flex flex-wrap items-center gap-3 px-4 py-3">
          <Select value={customer.id} onChange={(e) => go(e.target.value, period)} className="w-[220px]" aria-label="客戶">
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}（{TERMS_LABEL[c.settlementTerms]}）
              </option>
            ))}
          </Select>
          <Segmented size="sm" value={period} onChange={(p) => go(customer.id, p)} options={PERIODS.map((p) => ({ value: p, label: formatPeriod(p) }))} />
          <Segmented
            size="sm"
            value={mode}
            onChange={setMode}
            options={[
              { value: "preview", label: <><Eye size={13} /> 預覽</> },
              { value: "edit", label: <><PencilLine size={13} /> 編輯</> },
            ]}
          />
          <label className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
            <input type="checkbox" checked={doc.showItems} onChange={(e) => commit({ ...doc, showItems: e.target.checked })} /> 品項明細
          </label>
          <label className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
            <input type="checkbox" checked={doc.showInvoice} onChange={(e) => commit({ ...doc, showInvoice: e.target.checked })} /> 發票號碼
          </label>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" disabled={!draft?.history.length} onClick={() => undo(key)}>
              <Undo2 size={13} /> 復原
            </Button>
            <Button variant="ghost" size="sm" disabled={!draft} onClick={() => discard(key)}>
              <RotateCcw size={13} /> 還原系統資料
            </Button>
            <Button variant="primary" onClick={download}>
              <Download size={14} /> 下載 PDF
            </Button>
          </div>
        </Card>

        <div className="mb-3 flex flex-wrap items-center gap-2 text-[12.5px]">
          {changed.size === 0 ? (
            <Badge tone="ok" dot>
              與帳務資料一致
            </Badge>
          ) : (
            <Badge tone="amber" dot>
              已修改 {changed.size} 處・畫面上以底色標示，下載時不會印出
            </Badge>
          )}
          {diff !== 0 && (
            <span className="rounded-full bg-bad-soft px-2.5 py-[1px] text-[11.5px] font-medium text-bad">
              本期應付 {formatTWD(closing)} 與帳務 {formatTWD(ledgerClosing)} 相差 {formatTWD(diff, { sign: true })}；寄出前請確認是否要在帳務開立折讓／調整單
            </span>
          )}
        </div>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div ref={frameRef} className={cn("min-w-0 overflow-x-auto pb-2 print:overflow-visible", mode === "edit" && "pr-8 print:pr-0")}>
          <div className="[zoom:var(--doc-zoom)] print:[zoom:1]" style={{ "--doc-zoom": zoom } as React.CSSProperties}>
            <StatementTemplate doc={doc} period={period} changed={changed} editable={mode === "edit"} onChange={(next) => commit(next)} />
          </div>
        </div>
        <div className="xl:sticky xl:top-[76px] xl:h-[calc(100vh-100px)]">
          <StatementChat customerName={doc.customer.name} messages={messages ?? []} onSend={onCommand} />
        </div>
      </div>
    </div>
  );
}
