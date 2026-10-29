# DB_preparation_list — 資料庫架構建議

> **單純建議，非絕對。** 這是依示範版資料模型（`src/lib/domain/types.ts`、`src/lib/db.ts`）與電子發票研究（`docs/invoice_research.md`，請先讀）整理的起點，給後端工程師參考。表名、欄位、型別、拆分方式都可依實際架構與 ORM 調整。
> 以 PostgreSQL 為例撰寫；用其他資料庫時請找對應型別。

---

## 0. 通用原則（建議）

- **金額不用浮點數。** 整數元／分用 `BIGINT`（示範版是「分」）；電子發票 7 位小數欄位用 `NUMERIC(22,7)`。
- **時間**：`TIMESTAMPTZ`，業務日期（開立日、送貨日）用 `DATE`，時區以 Asia/Taipei 解讀。
- **已開立的發票不可修改**：用權限或觸發器擋 `UPDATE`／`DELETE`；更正一律新增作廢、折讓紀錄。
- **取號要在交易中鎖定號段**（`SELECT … FOR UPDATE`），確保不重複、不跳號。
- **所有寫入都留事件紀錄**（append-only），誰、何時、改了什麼、原因、關聯 ID。
- **憑證與金鑰不放資料庫明文**：工商憑證、QR 加密金鑰、加值中心 API 金鑰放祕密管理服務，資料庫只存參照。
- 主鍵建議 `UUID` 或 `BIGSERIAL`；對外單號（訂單號、發票號）另設唯一欄位。

---

## 1. 主檔

### `sellers`（賣方設定；多公司時才需要多筆）
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | uuid PK | |
| tax_id | char(8) UNIQUE | 金吉利統編 |
| name | text | 證明聯抬頭 |
| address | text | |
| einvoice_channel | text | `turnkey` / `vac`（加值中心） |
| channel_config_ref | text | 指向祕密管理的參照（不存明文） |
| qr_key_ref | text | QR 加密金鑰參照 |

### `customers`
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | uuid PK | |
| code | text UNIQUE | 客戶代號 |
| name | text | |
| invoice_class | text CHECK IN ('B2B','B2C') | |
| tax_id | char(8) NULL | B2B 必填；檢查碼「可被 5 整除」規則 |
| carrier_type / carrier_value | text NULL | B2C 載具 |
| donate_code | text NULL | 捐贈碼（**待確認是否需要**） |
| **price_basis** | text CHECK IN ('excluded','included') DEFAULT 'excluded' | **報價方式**（客戶預設） |
| price_tier | text | 一般／量販／VIP |
| settlement_terms | text | 日結／月結／混合 |
| …其他 CRM 欄位 | | 沿用示範版 |

### `products`
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | uuid PK | |
| sku | text UNIQUE | 證明聯品名前印的代碼（照片上的 `03F05001`） |
| name | text | 證明聯品名（**注意 MIG 品名長度上限，待查**） |
| base_unit / pack_unit / pack_size | | 包／箱換算 |
| tax_type | text CHECK IN ('TX','TZ','TF') DEFAULT 'TX' | 課稅別（應稅／零稅率／免稅；代號待查） |
| standard_cost | bigint NULL | |
| price_standard / price_volume / price_vip | bigint | 等級價（**未稅**） |
| price_incl_standard … | bigint NULL | **建議**：若金吉利有正式含稅價目表，另存，避免用 ×1.05 推算 |

### `customer_prices`（合約價，只增不改）
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | uuid PK | |
| customer_id / product_id | FK | |
| effective_from | date | 生效日；同客戶同品項取 ≤ 交易日的最新一筆 |
| quoted_amount | bigint | 報價金額（原樣保存） |
| quoted_unit | text CHECK IN ('base','pack') | 每包或每箱 |
| **quoted_tax_included** | boolean | **此品項是否含稅報價**（與客戶預設不同 → 混合） |
| price_ex_tax | bigint NULL | NULL = 停用合約價 |
| note / created_by / created_at | | |
| INDEX (customer_id, product_id, effective_from DESC) | | |

---

## 2. 交易

### `sales_orders` / `order_lines`
`order_lines` 重點欄位：
| 欄位 | 型別 | 說明 |
|---|---|---|
| qty / unit / qty_base | | 下單數量與基本單位數量 |
| **price_basis** | text | 建單當時的報價方式（**快照**，之後改設定不影響） |
| unit_price_quoted | bigint | 依報價方式的單價（含稅或未稅，原樣） |
| unit_price_ex_tax | bigint | 分析用，含稅時為推算值 |
| price_override_reason | text NULL | 改價原因 |

### `deliveries`、`pick_confirmations`
沿用示範版。**開立依「實際送達數量」**（短揀要降量），所以發票明細從送達後的應收單據產生，而非訂單。

### `ar_documents` / `ar_line_items`（應收）
| 欄位 | 型別 | 說明 |
|---|---|---|
| type | text | charge／debit_note／credit_note／write_off |
| **price_basis** | text | excluded／included／mixed |
| ex_tax / tax / total | bigint | 依第 4 節規則計算 |
| source_delivery_id | FK NULL | |
| corrects_doc_id | FK NULL | 更正單指向原單 |

`ar_line_items`：`price_basis`、`amount_quoted`（依報價方式的金額）、`ex_tax_share`（**尾差調整後**的未稅分攤，加總 = 單據 ex_tax）。

---

## 3. 電子發票

### `invoice_number_ranges`（字軌號段）
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | uuid PK | |
| seller_id | FK | |
| period | char(7) | 雙月期別，例 `2026-09`（115年09-10月） |
| track | char(2) | 字軌英文 |
| start_no / end_no | int | 起訖 |
| next_no | int | 下一個可用號碼（**取號時 FOR UPDATE**） |
| invoice_type | text | 07 一般稅額（**待查其他類別**） |
| channel | text | 授權給 turnkey／哪一家加值中心 |
| status | text | active／closed／returned |
| source | text | 平台取號、匯入 |
| CHECK (next_no BETWEEN start_no AND end_no + 1) | | |

### `invoices`
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | uuid PK | |
| seller_id / customer_id | FK | |
| source | text | per_delivery／monthly（歷史彙開） |
| invoice_class | text | B2B／B2C |
| invoice_no | char(10) NULL UNIQUE | 開立後才有 |
| random_number | char(4) NULL | 隨機碼 |
| period | char(7) | 雙月期別 |
| issue_date | date | 開立日（上傳期限起算） |
| issued_at | timestamptz NULL | 實際開立時間 |
| buyer_tax_id / buyer_name | | 開立當下的快照（客戶改名不影響） |
| carrier_type / carrier_value / donate_code | | B2C |
| print_mark | boolean | 是否列印證明聯 |
| **price_basis** | text | excluded／included／mixed |
| sales_amount / tax_amount / total_amount | bigint | 整數元（或分） |
| tax_type / tax_rate | | 單一課稅別或混合（**待查 MIG 規則**） |
| **issue_status** | text | draft／preflight_failed／issued／voided／cancelled |
| **upload_status** | text | pending／uploading／uploaded／failed |
| upload_due_on | date | B2B +7、B2C +2 |
| preflight_errors | jsonb NULL | |
| CHECK (sales_amount + tax_amount = total_amount) | | |
| INDEX (upload_status, upload_due_on) | | 期限監控 |

> 示範版把開立與上傳混在一個 `providerStatus` 欄位，**正式版建議拆成 `issue_status` 與 `upload_status`**。

### `invoice_lines`
| 欄位 | 型別 | 說明 |
|---|---|---|
| invoice_id | FK | |
| seq | int | 序號 |
| product_id / sku | | |
| description | text | 品名 |
| qty | numeric(22,7) | MIG 允許小數（示範版為整數） |
| unit | text | 包／箱 |
| price_basis | text | 此行報價方式 |
| unit_price_quoted | bigint | 原報價單價 |
| amount_quoted | bigint | 原報價金額 |
| **unit_price_ex** | **numeric(22,7)** | **MIG 單價，未稅，小數 7 位** |
| **amount_ex** | **numeric(22,7)** | **MIG 金額，未稅，小數 7 位** |
| tax_type | text | TX／TZ／TF |
| PRIMARY KEY (invoice_id, seq) | | |

### `invoice_voids`（作廢／註銷）
invoice_id、type（void／cancel_reissue）、reason、voided_at、replacement_invoice_id、upload_status、upload_due_on。

### `allowances` / `allowance_lines`（折讓，**賣方開立**）
allowance_no、invoice_id（原發票）、issue_date、sales_amount、tax_amount、reason、upload_status、upload_due_on、voided_at；明細對應原發票行與金額（`numeric(22,7)`）。

### `einvoice_messages`（每一次上傳／回應，只增不改）
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | uuid PK | |
| entity_type / entity_id | | invoice／void／allowance |
| message_type | text | F0401／F0501／F0701／G0401／G0501／E0402… |
| channel | text | turnkey／vac 名稱 |
| payload | text 或物件儲存參照 | 送出的 XML／JSON |
| response | jsonb | 回應或 ProcessResult |
| status | text | queued／sent／accepted／rejected／error |
| attempt | int | 重送次數 |
| created_at / sent_at / responded_at | | |
| idempotency_key | text UNIQUE | 避免重複上傳 |

### `blank_track_reports`（空白未使用字軌回報）
period、range_id、unused_from／unused_to、reported_at、message_id。

---

## 4. 稽核與作業

- `action_events`：沿用示範版 `ActionEvent`（actor、feature、entity、action、before／after、reason、correlation_id、status），**只增不改**。
- `jobs`：上傳排程、期限提醒、空白字軌回報、與加值中心或 Turnkey 的同步；需要冪等、重試、dead-letter。
- 報表用檢視（view／materialized view）：每期銷項（銷售額、稅額，依課稅別）給 401 申報；發票總額 ↔ 應收總額的核對。

---

## 5. 從示範版搬遷時的對照

| 示範版（`src/lib/domain/types.ts`） | 建議表 |
|---|---|
| `Customer.priceBasis` | `customers.price_basis` |
| `CustomerPrice.quoted.taxIncluded` | `customer_prices.quoted_tax_included` |
| `OrderLine.priceBasis`、`unitPriceInclTaxCents` | `order_lines.price_basis`、`unit_price_quoted` |
| `ArDocument.priceBasis`、`ArLineItem.amountCents/exTaxCents` | `ar_documents.price_basis`、`ar_line_items.amount_quoted/ex_tax_share` |
| `TaxInvoice` + `InvoiceLine` | `invoices` + `invoice_lines` |
| `TaxInvoice.providerStatus`／`govUploadStatus` | 拆成 `issue_status`／`upload_status` |
| `InvoiceNumberRange` | `invoice_number_ranges` |
| 金額單位「分」(`Cents`) | `bigint`；7 位小數字串 → `numeric(22,7)` |

再次提醒：**以上皆為建議，非絕對**；以 MIG 最新規格、會計師意見與實際系統架構為準。
