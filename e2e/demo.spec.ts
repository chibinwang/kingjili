import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

async function fresh(page: Page, path = "/") {
  await page.goto(path);
  await page.evaluate(() => localStorage.clear());
  await page.goto(path);
  await expect(page.locator('[data-hydrated="1"]')).toBeVisible();
}

const SHOTS = "test-results/screens";

test("every navigation item renders", async ({ page }) => {
  await fresh(page);
  const labels = ["總覽", "訂單", "今日配送", "庫存與凍庫", "採購", "客戶與應收", "帳單與會計", "電子發票", "AI 工作台", "操作紀錄", "設定"];
  for (const l of labels) {
    await page.locator("aside nav").getByRole("link", { name: new RegExp(`^${l}`) }).click();
    await expect(page.locator("h1")).toBeVisible();
  }
});

test("sidebar folds to icons with an icon-only button and remembers it", async ({ page }) => {
  await fresh(page);
  const nav = page.locator("aside nav").first();
  await expect(nav.getByText("帳單與會計")).toBeVisible();
  await page.getByRole("button", { name: "收合側邊欄" }).click();
  await expect(nav.getByText("帳單與會計")).toHaveCount(0);
  await nav.getByRole("link", { name: "帳單與會計" }).click();
  await expect(page.locator("h1")).toHaveText("帳單與會計");
  await page.reload();
  await page.getByRole("button", { name: "展開側邊欄" }).click();
  await expect(nav.getByText("帳單與會計")).toBeVisible();
});

test("overview toggles to the warehouse plan", async ({ page }) => {
  await fresh(page);
  await page.getByRole("tab", { name: "倉庫配置" }).click();
  await expect(page.getByText("配置示意 / 非比例測繪")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/overview-floor.png`, fullPage: true });
});

test("route change is approved and drives pick lists", async ({ page }) => {
  await fresh(page, "/dispatch");
  await expect(page.getByText("路線 v1")).toBeVisible();
  await page.getByRole("button", { name: /預覽 AI 路線建議/ }).click();
  await expect(page.getByText("所有限制通過")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/route-compare.png` });
  await page.getByRole("button", { name: /確認調整/ }).click();
  await expect(page.getByText("路線 v2").first()).toBeVisible();
  await page.getByRole("tab", { name: "按車配送" }).click();
  const aCard = page.locator("div.rounded-\\[12px\\]", { hasText: "A 車 理貨單" }).first();
  await expect(aCard.getByText("巷口炸物")).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /下載理貨單 XLSX/ }).click()]);
  expect(download.suggestedFilename()).toContain("_v2.xlsx");
  await page.goto("/print/picklist?mode=A");
  await expect(page.getByText("車 A 理貨單")).toBeVisible();
  await expect(page.getByText("#6 巷口炸物")).toBeVisible();
});

test("LINE text becomes a draft that requires human resolution", async ({ page }) => {
  await fresh(page, "/orders");
  await page.getByRole("button", { name: /AI 解析成草稿/ }).first().click();
  const confirm = page.getByRole("button", { name: /尚有 \d 項待確認/ });
  await expect(confirm).toBeDisabled();
  await page.getByRole("button", { name: "已確認" }).first().click();
  await page.getByRole("button", { name: "確認訂單並保留庫存" }).click();
  await expect(page.getByText("訂單已確認並保留庫存")).toBeVisible();
});

test("month-end review: deterministic flags, AI explains, accountant approves", async ({ page }) => {
  await fresh(page, "/accounting?tab=review");
  // the review plays out step by step: work in progress first, findings as they turn up, then the verdict
  const box = page.getByTestId("audit-process");
  await expect(box.getByText("AI 審查進行中")).toBeVisible();
  await expect(box.getByText(/正在檢查「/)).toBeVisible();
  await expect(page.getByText("阿宏鹹酥雞 疑似重複收款").first()).toBeVisible({ timeout: 15_000 });
  await expect(box.getByText("審查完成")).toBeVisible({ timeout: 20_000 });
  await expect(box.getByText(/發現 \d+ 個需要人員確認的問題/).first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/review.png`, fullPage: true });
  await page.getByRole("button", { name: /AI 解釋與建議/ }).first().click();
  await page.getByRole("button", { name: /以會計/ }).first().click();
  await expect(page.getByText("已核准並執行")).toBeVisible();
  await expect(page.getByTestId("flag-card").filter({ hasText: "阿宏鹹酥雞 疑似重複收款" })).toHaveCount(0);
});

test("statement reconciles, flows through approvals, LINE stays simulated", async ({ page }) => {
  await fresh(page, "/accounting?customer=C01&period=2026-10");
  await expect(page.getByText(/期末 NT\$[\d,]+ ＝ 應收子帳/)).toBeVisible();
  await page.getByRole("button", { name: /鎖定快照/ }).click();
  await page.getByRole("button", { name: /會計審查/ }).click();
  await page.getByRole("button", { name: /主管核准/ }).click();
  await page.getByRole("button", { name: /排入 LINE 發送/ }).click();
  await expect(page.getByText("外部發送未啟用").first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/line-preview.png` });
  await page.getByRole("button", { name: /排入發送（模擬）/ }).click();
  await expect(page.getByText(/模擬發送/).first()).toBeVisible();
});

test("customer statement: preview, chat edits, inline edits, PDF download", async ({ page }) => {
  await fresh(page, "/accounting?customer=C01&period=2026-09");
  await page.getByRole("link", { name: /預覽／編輯對帳單/ }).click();
  await expect(page.locator("h1")).toHaveText("月結對帳單");
  await expect(page.getByText("與帳務資料一致")).toBeVisible();
  const due = page.getByTestId("amount-due");
  await expect(due).toHaveText("NT$75,783");

  const chat = page.getByRole("textbox", { name: "修改指令" });
  await chat.fill("新增一筆退貨折讓 500 元");
  await chat.press("Enter");
  await expect(due).toHaveText("NT$75,283");
  await expect(page.getByText(/與帳務 NT\$75,783 相差/)).toBeVisible();
  await chat.fill("今天天氣如何");
  await chat.press("Enter");
  await expect(page.getByText("這句我還看不懂", { exact: false })).toBeVisible();

  // preview mode is read-only; edit mode makes the page editable in place
  await expect(page.getByRole("textbox", { name: "聯絡人" })).toHaveCount(0);
  await page.getByRole("tab", { name: "編輯" }).click();
  const contact = page.getByRole("textbox", { name: "聯絡人" });
  await contact.fill("林德福先生");
  await contact.press("Enter");
  await expect(page.getByText(/已修改 2 處/)).toBeVisible();

  await page.reload();
  await expect(due).toHaveText("NT$75,283");
  await page.getByRole("button", { name: "復原" }).click();
  await page.getByRole("button", { name: "還原系統資料" }).click();
  await expect(due).toHaveText("NT$75,783");

  await page.evaluate(() => (window.print = () => document.body.setAttribute("data-printed", document.title)));
  await page.getByRole("button", { name: "下載 PDF" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-printed", "金吉利_福記炸物店_2026年9月對帳單");
  await page.screenshot({ path: `${SHOTS}/statement-editor.png`, fullPage: true });
});

test("e-invoice preflight catches the bad carrier; submission is mock only", async ({ page }) => {
  await fresh(page, "/invoices");
  await page.getByRole("button", { name: /預檢/ }).click();
  await expect(page.getByText(/手機條碼「\/LJ05M2」格式不符/)).toBeVisible();
  await page.getByRole("button", { name: /確認並模擬送出/ }).click();
  await expect(page.getByText(/尚未上傳財政部/).first()).toBeVisible();
});

test("AI 工作台: sample commands stay hidden until 試試看 is hovered", async ({ page }) => {
  await fresh(page, "/ai");
  const sample = page.getByRole("menuitem", { name: "找出10月未收款客戶" });
  await expect(sample).toHaveCount(0);
  await page.getByRole("button", { name: "試試看" }).hover();
  await expect(sample).toBeVisible();
  await sample.click();
  await expect(page.getByPlaceholder("例如：找出10月未收款客戶")).toHaveValue("找出10月未收款客戶");
});

test("automation rules: plain-language rule, simulated outcome, escalations land in the queue", async ({ page }) => {
  await fresh(page, "/ai");
  // seeded rules already hand the unusual cases to a person
  await expect(page.getByTestId("rule-escalations").getByText("阿宏鹹酥雞 疑似重複收款")).toBeVisible();
  await page.getByRole("tab", { name: /自動化規則/ }).click();
  await expect(page.getByTestId("rule-card")).toHaveCount(2);

  await page.getByRole("textbox", { name: "規則描述" }).fill("路線調整能省 10 公里以上、所有車都準時就直接套用");
  await page.getByRole("button", { name: "解析規則" }).click();
  await expect(page.getByText("可省 10 公里以上，且兩車載重、時段、工時全部符合")).toBeVisible();
  await expect(page.getByText(/巷口炸物 由 B 車改至 A 車/)).toBeVisible();
  await page.getByRole("button", { name: "啟用規則" }).click();
  await expect(page.getByTestId("rule-card")).toHaveCount(3);

  await page.getByRole("switch").first().click();
  await expect(page.getByText("已停用")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/automation-rules.png`, fullPage: true });
});

test("今日任務: collapsed on the overview, top-bar panel approves low risk inline and sends the rest to their page", async ({ page }) => {
  await fresh(page, "/");
  // the overview starts collapsed to a one-line summary
  await expect(page.getByText("其中 1 件低風險可直接核准")).toBeVisible();
  await expect(page.getByText("巷口炸物 由 B 車改至 A 車第 6 站")).toHaveCount(0);
  // one control only: the summary row expands; the late-stop banner is covered by the 換車 proposal in the list
  await expect(page.getByRole("button", { name: /展開檢視|下新指令/ })).toHaveCount(0);
  await expect(page.getByText(/站預估超出客戶收貨時段/)).toHaveCount(0);
  await page.getByRole("button", { name: /AI 建議待核准.*展開/ }).click();
  await expect(page.getByText("巷口炸物 由 B 車改至 A 車第 6 站")).toBeVisible();

  const panel = page.getByRole("dialog", { name: "今日任務" });
  await page.getByRole("button", { name: /今日任務，9 件/ }).click();
  await panel.getByRole("button", { name: "核准" }).click();
  await expect(page.getByText("已核准並執行，結果已寫入操作紀錄")).toBeVisible();
  await expect(page.getByRole("button", { name: /今日任務，8 件/ })).toBeVisible();

  await panel.getByRole("listitem").filter({ hasText: "建議補貨" }).getByRole("link", { name: /前往審核/ }).click();
  await expect(page).toHaveURL(/\/inventory|\/procurement/);
  await expect(panel).toHaveCount(0);
});

test("bell keeps only what to know; anything in 今日任務 is left out until nothing covers it", async ({ page }) => {
  await fresh(page, "/ai?tab=rules");
  const bell = page.getByRole("button", { name: "提醒" });
  const alerts = page.locator("header").getByRole("link");
  await bell.click();
  await expect(alerts.filter({ hasText: "已過期，不可配貨" })).toHaveCount(1);
  await expect(alerts.filter({ hasText: "自動化規則已處理 1 件" })).toHaveCount(1);
  for (const covered of ["對帳審查", "低於補貨點", "超出收貨時段"]) await expect(alerts.filter({ hasText: covered })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // switch off the 對帳審查 rule: its flags are no longer in 今日任務, so the bell picks them up again
  await page.getByTestId("rule-card").filter({ hasText: "對帳審查旗標" }).getByRole("switch").click();
  await bell.click();
  await expect(alerts.filter({ hasText: "本月對帳審查有 6 個旗標" })).toHaveCount(1);
});

test("AI command → proposal → approval → action log", async ({ page }) => {
  await fresh(page, "/ai");
  await page.getByRole("button", { name: /問 AI/ }).click();
  await page.getByRole("button", { name: "把冷凍薯條補貨門檻設為30箱" }).last().click();
  await expect(page.getByText("香脆薯條 補貨門檻設為 30 箱").first()).toBeVisible();
  await page.getByRole("button", { name: /核准並執行|以.+核准/ }).first().click();
  await expect(page.getByText("已核准並執行").first()).toBeVisible();
  await page.goto("/activity");
  await expect(page.getByText(/香脆薯條 補貨點 20 箱 → 30 箱/)).toBeVisible();
});

test("CRM: card/list toggle, segment filter, detail panel and a follow-up note", async ({ page }) => {
  await fresh(page, "/customers");
  await expect(page.getByRole("tab", { name: /客戶名冊/ })).toHaveAttribute("aria-selected", "true");
  const cards = page.getByTestId("crm-cards").getByRole("button", { name: /^開啟 / });
  await expect(cards).toHaveCount(12);
  const fuji = page.getByRole("button", { name: "開啟 福記炸物店" });
  await expect(fuji.getByText("林德福")).toBeVisible();
  await expect(fuji.getByText("02-0000-1101")).toBeVisible();
  await expect(fuji.getByText(/合作 7 年 7 個月/)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/crm-cards.png`, fullPage: true });

  await page.getByRole("tab", { name: /炸物店 4/ }).click();
  await expect(cards).toHaveCount(4);
  await page.getByRole("tab", { name: /列表/ }).click();
  await expect(page).toHaveURL(/view=list/);
  const table = page.getByTestId("crm-table");
  await expect(table.locator("tbody tr")).toHaveCount(4);
  await table.getByRole("button", { name: /年資/ }).click();
  await expect(table.locator("tbody tr").first()).toContainText("福記炸物店");
  await page.getByRole("tab", { name: /全部 12/ }).click();
  await page.screenshot({ path: `${SHOTS}/crm-list.png`, fullPage: true });

  // the choice survives a reload
  await page.goto("/customers?tab=crm");
  await expect(page.getByTestId("crm-table")).toBeVisible();

  await page.getByLabel("搜尋客戶").fill("江國榮");
  await page.getByTestId("crm-table").getByRole("button", { name: "好味便當" }).click();
  await expect(page.getByText(/需關注：.*有逾期帳款/)).toBeVisible();
  await page.getByRole("tab", { name: /往來紀錄/ }).click();
  await page.getByLabel("往來內容").fill("已再次提醒付款，約定 10/31 前匯款");
  await page.getByRole("button", { name: "新增紀錄" }).click();
  await expect(page.getByText("已再次提醒付款，約定 10/31 前匯款")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/crm-panel.png` });
  await page.getByRole("button", { name: "查看應收明細" }).click();
  await expect(page).toHaveURL(/tab=ar&id=C10/);
  await expect(page.getByRole("heading", { name: "好味便當" })).toBeVisible();
});

test("＋ 新增客戶: inline validation, then the new client opens in the CRM", async ({ page }) => {
  await fresh(page, "/customers");
  await page.getByRole("button", { name: "新增", exact: true }).click();
  await expect(page.getByRole("menuitem")).toHaveCount(2);
  await page.getByRole("menuitem", { name: /新增客戶/ }).click();
  const form = page.getByRole("dialog", { name: "新增客戶" });
  await form.getByRole("button", { name: "建立客戶" }).click();
  await expect(form.getByText("請輸入客戶名稱")).toBeVisible();
  await form.getByLabel(/^客戶名稱/).fill("旺角炸雞");
  await form.getByRole("tab", { name: "炸物店", exact: true }).click();
  await form.getByLabel(/^細分類/).fill("炸雞");
  await form.getByLabel(/^負責人/).fill("劉旺");
  await form.getByLabel(/^聯絡電話/).fill("0912-345-678");
  await form.getByLabel(/^地址/).fill("示範區旺角街 13 號");
  await form.getByRole("tab", { name: /B2B/ }).click();
  await form.getByLabel(/^統一編號/).fill("12345678");
  await form.getByRole("button", { name: "建立客戶" }).click();
  await expect(form.getByText("統一編號需 8 碼且檢查碼正確")).toBeVisible();
  await form.getByLabel(/^統一編號/).fill("00001145");
  await page.screenshot({ path: `${SHOTS}/add-customer.png` });
  await form.getByRole("button", { name: "建立客戶" }).click();
  await expect(page).toHaveURL(/open=C13/);
  await expect(page.getByText("地圖座標待確認")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("crm-cards").getByRole("button", { name: /^開啟 / })).toHaveCount(13);
  await expect(page.getByRole("button", { name: "開啟 旺角炸雞" }).getByText("新客戶")).toBeVisible();
});

test("＋ 手動建立訂單 for today → 待排車 → manager adds it to a truck", async ({ page }) => {
  await fresh(page, "/orders");
  await page.getByRole("button", { name: "新增", exact: true }).click();
  await page.getByRole("menuitem", { name: /手動建立訂單/ }).click();
  const form = page.getByRole("dialog", { name: "手動建立訂單" });
  await form.getByLabel(/^客戶/).selectOption({ label: "大樹早餐店（DS09）" });
  await form.getByRole("button", { name: "今天" }).click();
  await expect(form.getByText(/今日路線已排定/)).toBeVisible();
  await form.getByRole("button", { name: /帶入常購品項/ }).click();
  await form.getByLabel("第 1 列單價").fill("99");
  await form.getByRole("button", { name: "確認並保留庫存" }).click();
  await expect(form.getByText("改價需填原因")).toBeVisible();
  await form.getByLabel("第 1 列改價原因").fill("老客戶週末促銷");
  await page.screenshot({ path: `${SHOTS}/add-order.png` });
  await form.getByRole("button", { name: "確認並保留庫存" }).click();
  await expect(page.getByText(/待主任加入今日路線/)).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("SO-261024-M01");
  await page.keyboard.press("Escape");

  await page.locator("aside nav").getByRole("link", { name: /^今日配送/ }).click();
  const banner = page.getByTestId("unrouted");
  await expect(banner).toContainText("大樹早餐店");
  await page.screenshot({ path: `${SHOTS}/unrouted.png` });
  await banner.getByRole("button", { name: /加入 A 車/ }).click();
  await expect(page.getByText("路線 v2").first()).toBeVisible();
  await expect(banner).toHaveCount(0);
});

test("＋ 新增供應商 starts unapproved until the manager approves", async ({ page }) => {
  await fresh(page, "/procurement");
  await page.getByRole("button", { name: "新增", exact: true }).click();
  await page.getByRole("menuitem", { name: /新增供應商/ }).click();
  const form = page.getByRole("dialog", { name: "新增供應商" });
  await form.getByLabel(/^供應商名稱/).fill("南港冷凍");
  await form.getByLabel(/^聯絡人/).fill("梁先生");
  await form.getByLabel(/^電話/).fill("02-2222-3333");
  await form.getByRole("button", { name: "建立供應商" }).click();
  const card = page.locator("div.rounded-\\[12px\\]", { hasText: "南港冷凍" });
  await expect(card.getByText("待主管核准")).toBeVisible();
  await card.getByRole("button", { name: /核准/ }).click();
  await expect(card.getByText("核准供應商")).toBeVisible();
});

test("roles without permission see the ＋ option disabled", async ({ page }) => {
  await fresh(page, "/procurement");
  await page.getByRole("button", { name: /周筱汶/ }).click();
  await page.getByRole("button", { name: /陳建宏/ }).click();
  await page.getByRole("button", { name: "新增", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: /新增供應商/ })).toBeDisabled();
  await expect(page.getByRole("menuitem", { name: /新增供應商/ })).toContainText("需 採購／主任");
});

test("＋ 新增品項 lands in stock as a new item and LINE text recognises its nickname", async ({ page }) => {
  await fresh(page, "/inventory");
  await page.getByRole("button", { name: "新增品項" }).click();
  const form = page.getByRole("dialog", { name: "新增品項" });
  await form.getByRole("button", { name: "建立品項" }).click();
  await expect(form.getByText("請輸入品名")).toBeVisible();
  await form.getByLabel(/^品名/).fill("洋芋球");
  await form.getByLabel(/^規格/).fill("1kg／包");
  await form.getByRole("tab", { name: "凍庫 B" }).click();
  await expect(form.getByLabel(/^架位/)).toHaveValue("B-5");
  await form.getByLabel(/^一般價/).fill("110");
  await expect(form.getByLabel(/^量販價/)).toHaveValue("106");
  await form.getByLabel(/^客戶常用叫法/).fill("薯條");
  await expect(form.getByText(/已是 香脆薯條 的 LINE 名稱/)).toBeVisible();
  await form.getByLabel(/^客戶常用叫法/).fill("馬鈴薯球");
  await page.screenshot({ path: `${SHOTS}/add-product.png` });
  await form.getByRole("button", { name: "建立品項" }).click();
  await expect(page).toHaveURL(/sku=P015/);
  await expect(page.locator("tr", { hasText: "洋芋球" }).getByText("新品・尚無庫存")).toBeVisible();

  await page.locator("aside nav").getByRole("link", { name: /^訂單/ }).click();
  await page.getByRole("button", { name: "新增", exact: true }).click();
  await page.getByRole("menuitem", { name: /貼上/ }).click();
  const paste = page.getByRole("dialog", { name: /貼上/ });
  await paste.getByLabel(/^來源/).fill("福記炸物店");
  await paste.getByLabel("訊息內容").fill("明天要 馬鈴薯球3包");
  await paste.getByRole("button", { name: /轉成草稿/ }).click();
  await expect(page.getByText("洋芋球").first()).toBeVisible();
});

test("客戶與應收 shows each customer's agreed prices in cards, list and the panel", async ({ page }) => {
  await fresh(page, "/customers?tab=crm");
  const card = page.getByTestId("crm-cards").locator("div", { hasText: "長青自助餐" }).filter({ has: page.getByTestId("agreed-price-line") }).first();
  await expect(card.getByTestId("agreed-price-line")).toContainText("合約價 3 項");
  await expect(card.getByText(/低於成本 1/)).toBeVisible();
  await page.getByRole("tab", { name: /列表/ }).click();
  await expect(page.getByTestId("crm-table").locator("tr", { hasText: "福記炸物店" })).toContainText("合約價 3 項");
  await page.getByTestId("crm-table").getByRole("button", { name: "長青自助餐" }).click();
  await page.getByRole("tab", { name: /^合約價/ }).click();
  const table = page.getByTestId("agreed-price-table");
  await expect(table.locator("tr", { hasText: "黃金魚排" })).toContainText("NT$138");
  await table.getByRole("button", { name: "新增合約價" }).click();
  const editor = page.getByRole("dialog", { name: "新增合約價" });
  await editor.getByRole("combobox").selectOption("P011");
  await editor.getByRole("spinbutton").fill("95");
  await expect(editor.getByText("NT$95／包")).toBeVisible();
  await editor.getByRole("button", { name: "儲存" }).click();
  await expect(page.getByText(/蔬菜春捲 合約價已更新/)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/agreed-prices.png` });
});

test("driver screen sums today's collections per customer", async ({ page }) => {
  await fresh(page, "/driver");
  const box = page.getByTestId("driver-collections");
  await expect(box.getByText("今日應收（現場）")).toBeVisible();
  await page.getByRole("button", { name: /完成送達並登錄收款/ }).first().click();
  await page.getByRole("button", { name: "確認送達" }).click();
  await expect(box.getByText(/1／5 站已送達/)).toBeVisible();
  await box.getByRole("button", { name: /各客戶收款明細/ }).click();
  await expect(box.locator("tr", { hasText: "大樹早餐店" }).getByText("現金")).toBeVisible();
});

test("insights report: pick a topic, AI pulls ledger data, every number is verified", async ({ page }) => {
  await fresh(page, "/");
  await expect(page.getByTestId("revenue-profit-chart")).toBeVisible();
  await page.getByRole("button", { name: "問 AI" }).click();
  await page.getByRole("button", { name: "洞察報告" }).first().click();
  const launcher = page.getByTestId("insights-launcher");
  await launcher.getByRole("radio", { name: /客戶獲利/ }).click();
  await launcher.getByRole("radio", { name: "上個月" }).click();
  await launcher.getByRole("button", { name: "產生報告" }).click();
  const card = page.getByTestId("insights-card");
  await expect(card.getByText("客戶獲利洞察報告")).toBeVisible({ timeout: 10_000 });
  await expect(card.getByText("數字全數來自帳本")).toBeVisible();
  await card.getByRole("button", { name: "完整報告" }).click();
  const report = page.getByTestId("insights-report");
  await expect(report.getByText("長青自助餐 的 黃金魚排 合約價低於成本")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/insights-report.png` });
  await page.getByRole("button", { name: "關閉" }).last().click();
  await page.getByRole("button", { name: "關閉" }).first().click();
  await page.locator("aside nav").getByRole("link", { name: /^操作紀錄/ }).click();
  await expect(page.getByText(/產生洞察報告「客戶獲利洞察報告」/).first()).toBeVisible();
});

test("people without margin access never see cost or margin in the overview or the insights report", async ({ page }) => {
  await fresh(page, "/");
  await page.getByRole("button", { name: /周筱汶/ }).click();
  await page.getByRole("button", { name: /吳佩珊/ }).click();
  await expect(page.getByText("本月毛利（初估）")).toHaveCount(0);
  await expect(page.getByText("營收（近 12 週）")).toBeVisible();
  await page.getByRole("button", { name: "問 AI" }).click();
  await page.getByRole("button", { name: "洞察報告" }).first().click();
  await page.getByTestId("insights-launcher").getByRole("button", { name: "產生報告" }).click();
  const card = page.getByTestId("insights-card");
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card).not.toContainText("毛利");
  await expect(card).not.toContainText("成本");
});

test("route map shows the real Taichung base map with every stop and the depot", async ({ page }) => {
  await fresh(page, "/dispatch");
  const map = page.getByTestId("route-map");
  await expect(map.locator(".map-stop")).toHaveCount(12);
  await expect(map.locator(".map-depot")).toHaveCount(1);
  await expect(map.locator(".map-stop.is-late")).toHaveCount(1);
  await expect(map.locator(".leaflet-tile-loaded").first()).toBeVisible({ timeout: 15_000 });
  await map.locator(".map-stop", { hasText: "三味食堂" }).locator(".map-pin").click();
  await expect(map.locator(".map-stop.is-selected")).toContainText("三味食堂");
  await page.screenshot({ path: `${SHOTS}/route-map.png` });
});

test("單趟開立: each delivery prints a 證明聯 with the 交易明細 in the client's format", async ({ page }) => {
  await fresh(page, "/print/invoice?id=inv-2026-10-20-SW02");
  const slip = page.getByTestId("invoice-slip");
  await expect(slip.getByText("電子發票證明聯")).toBeVisible();
  await expect(slip.getByText("115年09-10月")).toBeVisible();
  await expect(slip.getByText("交易明細")).toBeVisible();
  await expect(slip.getByText("買受人統編 00001113")).toBeVisible();
  await expect(slip.getByText("銷售額(應稅) $3,442")).toBeVisible();
  await expect(slip.getByText("稅額 $172")).toBeVisible();
  await expect(slip.getByText("總計 $3,614")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/invoice-slip.png`, fullPage: true });
});

test("報價方式 can be switched per customer and shows 混合 when 合約價 differ", async ({ page }) => {
  await fresh(page, "/customers?tab=crm&open=C02");
  const basis = page.getByTestId("price-basis");
  await expect(basis.getByText(/混合/)).toBeVisible();
  await basis.getByRole("tab", { name: "含稅報價" }).click();
  await expect(page.getByText("三味食堂 改為含稅報價")).toBeVisible();
});
