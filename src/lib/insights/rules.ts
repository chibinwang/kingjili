import { TOPIC_LABEL, type Fact, type InsightsDataset, type ReportDraft } from "./types";

/**
 * Offline composer: deterministic rules that read the dataset and write a draft in the same shape (and with the same
 * [[fact.id]] citations) the AI model must produce. It is the demo's default and the fallback when the model is unavailable.
 */

type Finding = ReportDraft["findings"][number];
type Rec = ReportDraft["recommendations"][number];

const T = (id: string) => `[[${id}]]`;

export function composeWithRules(d: InsightsDataset): ReportDraft {
  const facts = new Map(d.facts.map((f) => [f.id, f]));
  const has = (id: string) => facts.has(id);
  const val = (id: string) => facts.get(id)?.value ?? 0;
  const cname = new Map(d.entities.customers.map((c) => [c.id, c.name]));
  const pname = new Map(d.entities.products.map((p) => [p.id, p.name]));
  const byPrefix = (re: RegExp) => d.facts.filter((f) => re.test(f.id));
  const idOf = (f: Fact) => f.id.split(".")[1];
  const m = d.includesMargin;
  const topic = d.request.topic;

  const findings: (Finding & { rank: number; topics: string[] })[] = [];
  const recs: (Rec & { rank: number; topics: string[] })[] = [];
  const finding = (rank: number, topics: string[], f: Omit<Finding, "customerId" | "productId"> & { customerId?: string; productId?: string }) =>
    findings.push({ customerId: null, productId: null, ...f, rank, topics });
  const rec = (rank: number, topics: string[], r: Rec) => recs.push({ ...r, rank, topics });

  /* ── revenue & margin ── */
  if (has("rev.change")) {
    const up = val("rev.change") >= 0;
    finding(up ? 40 : 75, ["overview"], {
      severity: up ? "good" : val("rev.change") <= -10 ? "warn" : "info",
      title: up ? "營收較對照期間成長" : "營收較對照期間下滑",
      detail: `期間營收 ${T("rev.now")}，對照期間 ${T("rev.prev")}，變化 ${T("rev.change")}。`,
      factIds: ["rev.now", "rev.prev", "rev.change"],
    });
  }
  if (m && has("gm.change") && val("gm.change") <= -1) {
    finding(80, ["overview", "products"], { severity: "warn", title: "毛利率下滑", detail: `毛利率 ${T("gm.now")}，較對照期間 ${T("gm.change")}。營收成長若來自低毛利品項或合約價客戶，毛利不會同步成長。`, factIds: ["gm.now", "gm.change"] });
  }
  if (has("uncosted.now")) {
    finding(30, ["overview", "products"], { severity: "info", title: "部分品項缺標準成本", detail: `${T("uncosted.now")} 的營收來自尚未設定成本的品項，這部分沒有計入毛利率。`, factIds: ["uncosted.now"] });
    rec(30, ["overview", "products"], { priority: "low", text: `補齊缺成本品項的標準成本（目前 ${T("uncosted.now")} 營收無法計算毛利），毛利數字才完整。`, factIds: ["uncosted.now"] });
  }

  /* ── customers ── */
  if (has("share.top3") && val("share.top3") >= 45) {
    finding(55, ["overview", "customers"], { severity: "warn", title: "營收集中在少數客戶", detail: `前三大客戶占營收 ${T("share.top3")}，其中最大客戶占 ${T("share.top1")}。任何一家減少叫貨都會明顯影響營收。`, factIds: ["share.top3", "share.top1"] });
  }
  const changes = byPrefix(/^cust\.[^.]+\.change$/).sort((a, b) => a.value - b.value);
  const falling = changes.filter((f) => f.value <= -15);
  for (const f of falling.slice(0, 3)) {
    const id = idOf(f);
    finding(70 + Math.min(20, -f.value / 2), ["overview", "customers"], {
      severity: f.value <= -30 ? "risk" : "warn",
      title: `${cname.get(id)} 叫貨明顯減少`,
      detail: `營收 ${T(`cust.${id}.rev`)}，較對照期間 ${T(f.id)}。`,
      factIds: [`cust.${id}.rev`, f.id],
      customerId: id,
    });
  }
  if (falling.length) {
    const ids = falling.slice(0, 3).map(idOf);
    rec(85, ["overview", "customers"], { priority: "high", text: `本週由業務聯絡 ${ids.map((id) => cname.get(id)).join("、")}，了解叫貨減少的原因（${ids.map((id) => T(`cust.${id}.change`)).join("、")}），並在往來紀錄留下追蹤日。`, factIds: ids.map((id) => `cust.${id}.change`) });
  }
  for (const f of changes.filter((x) => x.value >= 15).slice(-2)) {
    const id = idOf(f);
    finding(35, ["customers"], { severity: "good", title: `${cname.get(id)} 叫貨成長`, detail: `營收 ${T(`cust.${id}.rev`)}，較對照期間 ${T(f.id)}。`, factIds: [`cust.${id}.rev`, f.id], customerId: id });
  }
  for (const f of byPrefix(/^cust\.[^.]+\.rev_prev_only$/)) {
    const id = idOf(f);
    finding(78, ["overview", "customers"], { severity: "risk", title: `${cname.get(id)} 本期沒有出貨`, detail: `對照期間有 ${T(f.id)} 的營收，本期間沒有任何出貨。`, factIds: [f.id], customerId: id });
  }
  if (m && has("gm.now")) {
    const total = val("gm.now");
    const low = byPrefix(/^cust\.[^.]+\.gm$/)
      .filter((f) => f.value <= total - 4)
      .sort((a, b) => a.value - b.value);
    for (const f of low.slice(0, 2)) {
      const id = idOf(f);
      const contract = has(`price.${id}.count`);
      finding(60, ["overview", "customers"], {
        severity: "warn",
        title: `${cname.get(id)} 毛利率偏低`,
        detail: `毛利率 ${T(f.id)}，低於整體 ${T("gm.now")}${contract ? `；這家有 ${T(`price.${id}.count`)} 合約價，平均折扣 ${T(`price.${id}.discount`)}` : ""}。`,
        factIds: [f.id, "gm.now", ...(contract ? [`price.${id}.count`, `price.${id}.discount`] : [])],
        customerId: id,
      });
    }
    if (low.length) {
      const id = idOf(low[0]);
      rec(60, ["customers"], { priority: "medium", text: `檢視 ${cname.get(id)} 的合約價與叫貨組合（毛利率 ${T(low[0].id)}），下次議價時以整體毛利率 ${T("gm.now")} 為參考。`, factIds: [low[0].id, "gm.now"] });
    }
  }

  /* ── agreed prices below cost ── */
  if (m) {
    for (const f of byPrefix(/^price\.[^.]+\.[^.]+\.price$/)) {
      const [, cid, pid] = f.id.split(".");
      const cost = `price.${cid}.${pid}.cost`;
      finding(90, ["overview", "customers", "products"], {
        severity: "risk",
        title: `${cname.get(cid)} 的 ${pname.get(pid)} 合約價低於成本`,
        detail: `合約價 ${T(f.id)}，標準成本 ${T(cost)}，每出貨一次都在虧損。`,
        factIds: [f.id, cost],
        customerId: cid,
        productId: pid,
      });
      rec(92, ["overview", "customers", "products"], { priority: "high", text: `與 ${cname.get(cid)} 重新議定 ${pname.get(pid)} 的價格：目前合約價 ${T(f.id)} 低於成本 ${T(cost)}。`, factIds: [f.id, cost] });
    }
  }

  /* ── products ── */
  const prodRev = byPrefix(/^prod\.[^.]+\.rev$/).sort((a, b) => b.value - a.value);
  if (prodRev.length) {
    const id = idOf(prodRev[0]);
    finding(25, ["products"], { severity: "info", title: `${pname.get(id)} 是營收最高的品項`, detail: `營收 ${T(prodRev[0].id)}，銷量 ${T(`prod.${id}.qty`)}${m && has(`prod.${id}.gm`) ? `，毛利率 ${T(`prod.${id}.gm`)}` : ""}。`, factIds: [prodRev[0].id, `prod.${id}.qty`] });
  }
  if (m) {
    const gms = byPrefix(/^prod\.[^.]+\.gm$/).sort((a, b) => a.value - b.value);
    if (gms.length > 1) {
      const lo = idOf(gms[0]);
      finding(45, ["products"], { severity: "info", title: `${pname.get(lo)} 毛利率最低`, detail: `毛利率 ${T(gms[0].id)}，營收 ${T(`prod.${lo}.rev`)}。`, factIds: [gms[0].id, `prod.${lo}.rev`], productId: lo });
    }
  }
  for (const f of byPrefix(/^prod\.[^.]+\.change$/).filter((x) => x.value <= -20).slice(0, 2)) {
    const id = idOf(f);
    finding(50, ["products"], { severity: "warn", title: `${pname.get(id)} 銷售下滑`, detail: `營收 ${T(`prod.${id}.rev`)}，較對照期間 ${T(f.id)}。`, factIds: [f.id, `prod.${id}.rev`], productId: id });
  }
  const mix = byPrefix(/^cat\.[^.]+\.share$/).sort((a, b) => b.value - a.value);
  if (mix.length) {
    finding(20, ["products", "overview"], { severity: "info", title: "品類營收組成", detail: mix.map((f) => `${f.label.replace(" 營收占比", "")} ${T(f.id)}`).join("、") + "。", factIds: mix.map((f) => f.id) });
  }

  /* ── stock ── */
  const covers = byPrefix(/^stock\.[^.]+\.cover$/);
  const short = covers.filter((f) => f.value < 5).sort((a, b) => a.value - b.value);
  const heavy = covers.filter((f) => f.value > 45).sort((a, b) => b.value - a.value);
  for (const f of short.slice(0, 3)) {
    const id = idOf(f);
    finding(72, ["overview", "inventory"], { severity: "warn", title: `${pname.get(id)} 庫存撐不久`, detail: `目前庫存 ${T(`stock.${id}.closing`)}，依期間日均出貨只夠 ${T(f.id)}。`, factIds: [f.id, `stock.${id}.closing`], productId: id });
  }
  if (short.length) rec(80, ["overview", "inventory"], { priority: "high", text: `確認 ${short.slice(0, 3).map((f) => pname.get(idOf(f))).join("、")} 的叫貨單是否已在途（可用天數 ${short.slice(0, 3).map((f) => T(f.id)).join("、")}）。`, factIds: short.slice(0, 3).map((f) => f.id) });
  for (const f of heavy.slice(0, 2)) {
    const id = idOf(f);
    finding(40, ["inventory"], { severity: "info", title: `${pname.get(id)} 庫存偏多`, detail: `目前庫存 ${T(`stock.${id}.closing`)}，以期間出貨速度約可用 ${T(f.id)}，留意效期。`, factIds: [f.id, `stock.${id}.closing`], productId: id });
  }
  if (heavy.length) rec(40, ["inventory"], { priority: "low", text: `${pname.get(idOf(heavy[0]))} 暫緩叫貨，並優先推給常叫的客戶（可用 ${T(heavy[0].id)}）。`, factIds: [heavy[0].id] });
  if (has("stock.inconsistent")) finding(35, ["inventory"], { severity: "info", title: "部分品項帳實不符", detail: `${T("stock.inconsistent")} 的期初庫存倒推為負，建議盤點後再看這些品項的數字。`, factIds: ["stock.inconsistent"] });
  if (m && has("stock.closing_value")) finding(22, ["inventory"], { severity: "info", title: "庫存與進出貨金額", detail: `目前庫存成本 ${T("stock.closing_value")}；期間進貨 ${T("stock.in_value")}、出貨成本 ${T("stock.out_value")}。`, factIds: ["stock.closing_value", "stock.in_value", "stock.out_value"] });

  /* ── receivables ── */
  const overdue = byPrefix(/^ar\.[^.]+\.overdue$/).filter((f) => f.id.split(".").length === 3).sort((a, b) => b.value - a.value);
  if (overdue.length) {
    const long = val("ar.bucket.61+") > 0 || val("ar.bucket.31-60") > 0;
    finding(long ? 85 : 65, ["overview", "receivables"], {
      severity: long ? "risk" : "warn",
      title: "有逾期未收帳款",
      detail: `逾期合計 ${T("ar.overdue")}（${T("ar.overdue_customers")}），最多的是 ${cname.get(idOf(overdue[0]))} ${T(overdue[0].id)}。`,
      factIds: ["ar.overdue", "ar.overdue_customers", overdue[0].id],
      customerId: idOf(overdue[0]),
    });
    rec(long ? 88 : 70, ["overview", "receivables"], { priority: long ? "high" : "medium", text: `由會計聯絡 ${overdue.slice(0, 2).map((f) => `${cname.get(idOf(f))}（${T(f.id)}）`).join("、")} 確認付款日；逾期期間長的客戶，暫停月結、改為送貨收現。`, factIds: overdue.slice(0, 2).map((f) => f.id) });
  }
  for (const f of byPrefix(/^ar\.[^.]+\.credit$/)) {
    finding(50, ["receivables"], { severity: "warn", title: `${cname.get(idOf(f))} 有溢收`, detail: `帳上多收 ${T(f.id)}，可能是重複登錄收款，請會計核對。`, factIds: [f.id], customerId: idOf(f) });
  }
  if (topic === "receivables" && has("ar.open")) finding(20, ["receivables"], { severity: "info", title: "應收總覽", detail: `應收未收 ${T("ar.open")}，其中逾期 ${T("ar.overdue")}。`, factIds: ["ar.open", "ar.overdue"] });

  /* ── assemble per topic ── */
  const pick = <X extends { rank: number; topics: string[] }>(xs: X[], n: number) =>
    xs
      .filter((x) => x.topics.includes(topic))
      .sort((a, b) => b.rank - a.rank)
      .slice(0, n)
      .map(({ rank: _r, topics: _t, ...rest }) => rest);

  const kpis: Record<typeof topic, string[]> = {
    overview: ["rev.now", "rev.change", "gp.now", "gm.now", "ar.overdue", "deliveries.now"],
    customers: ["rev.now", "customers.active", "share.top3", "gm.now", "ticket.avg"],
    products: ["rev.now", "gm.now", "uncosted.now", "cat.fried.share"],
    inventory: ["stock.closing_value", "stock.in_value", "stock.out_value", "stock.inconsistent"],
    receivables: ["ar.open", "ar.overdue", "ar.overdue_customers", "ar.bucket.61+"],
  };
  const headline: Record<typeof topic, string> = {
    overview: `營收 ${T("rev.now")}${has("rev.change") ? `，較對照期間 ${T("rev.change")}` : ""}${m && has("gm.now") ? `；毛利率 ${T("gm.now")}${has("gm.change") ? `（${T("gm.change")}）` : ""}` : ""}。逾期未收 ${T("ar.overdue")}。`,
    customers: `${T("customers.active")}有出貨，前三大客戶占營收 ${T("share.top3")}${m && has("gm.now") ? `，整體毛利率 ${T("gm.now")}` : ""}。`,
    products: `營收 ${T("rev.now")}${m && has("gm.now") ? `，毛利率 ${T("gm.now")}` : ""}；冷凍炸物占 ${T("cat.fried.share")}。`,
    inventory: short.length ? `${short.length > 1 ? "有幾個" : "有一個"}品項庫存撐不久，最短的 ${pname.get(idOf(short[0]))} 只剩 ${T(short[0].id)}。` : "目前沒有庫存不足的品項。",
    receivables: `應收未收 ${T("ar.open")}，逾期 ${T("ar.overdue")}（${T("ar.overdue_customers")}）。`,
  };
  const sections: Record<typeof topic, ReportDraft["sections"]> = {
    overview: [
      { title: m ? "營收與毛利趨勢" : "營收趨勢", body: `近十二週每週營收${m ? "與毛利" : ""}。期間營收 ${T("rev.now")}，出貨 ${T("deliveries.now")}。`, chart: "weekly_pnl", table: null },
      { title: "客戶", body: `前三大客戶占 ${T("share.top3")}。`, chart: "customer_revenue", table: "customers" },
      { title: "收款", body: `應收未收 ${T("ar.open")}，逾期 ${T("ar.overdue")}。`, chart: "ar_aging", table: null },
    ],
    customers: [
      { title: "客戶營收排行", body: `最大客戶占 ${T("share.top1")}，前三大占 ${T("share.top3")}；平均每趟 ${T("ticket.avg")}。`, chart: "customer_revenue", table: "customers" },
      { title: "合約價", body: "合約價客戶的折扣與毛利，對照等級價計算。", chart: null, table: "agreements" },
    ],
    products: [
      { title: "品類組成", body: `冷凍炸物占營收 ${T("cat.fried.share")}。`, chart: "category_mix", table: null },
      { title: "品項明細", body: m && has("gm.now") ? `整體毛利率 ${T("gm.now")}。` : "依營收排序。", chart: null, table: "products" },
    ],
    inventory: [
      { title: "可用天數", body: "以期間日均出貨量估算現有庫存可用幾天。", chart: "stock_cover", table: null },
      { title: "進銷存明細", body: "期初＋進－銷±調整＝期末。", chart: null, table: "stock" },
    ],
    receivables: [
      { title: "帳齡", body: `逾期 ${T("ar.overdue")}，依逾期天數分布。`, chart: "ar_aging", table: null },
      { title: "客戶應收", body: "依逾期金額排序。", chart: null, table: "receivables" },
    ],
  };

  // drop any sentence that cites a fact this dataset does not have (e.g. no comparison period, no margin permission)
  const clean = (text: string) =>
    text
      .split(/(?<=。)/)
      .filter((sentence) => [...sentence.matchAll(/\[\[([^\]]+)\]\]/g)].every((x) => has(x[1])))
      .join("");
  return {
    title: `${TOPIC_LABEL[topic]}洞察報告`,
    headline: clean(headline[topic]) || "此期間資料不足，無法產生摘要。",
    kpiFactIds: kpis[topic].filter(has),
    sections: sections[topic].map((x) => ({ ...x, body: clean(x.body) })),
    findings: pick(findings, 6),
    recommendations: pick(recs, 4),
    caveats: ["此報告由規則引擎產生，只陳述資料中可驗證的事實；原因需由人員判斷。"],
  };
}
