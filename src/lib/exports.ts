import type { PickLine } from "./domain/picking";
import type { Vehicle } from "./domain/types";
import { formatDate } from "./time";

/**
 * Pick-list workbook matching PICK_LIST_SAMPLE.xlsx: sheet 按凍庫理貨 + one sheet per truck,
 * same title rows and column order, with 位置／批號／備註 appended.
 */
export async function downloadPickWorkbook(lines: PickLine[], vehicles: Vehicle[], date: string, routeVersion: number, confirmed: Record<string, { qtyBase: number }>) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Everyse Demo";
  const title = `金吉利食品｜${formatDate(date, { year: true })} 今日理貨單（示範資料）`;
  const border = { style: "thin" as const, color: { argb: "FFD9D3C6" } };
  const styleHeader = (row: import("exceljs").Row) => {
    row.font = { bold: true, color: { argb: "FF1B2430" } };
    row.eachCell((c) => {
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFCF3DD" } };
      c.border = { top: border, bottom: border, left: border, right: border };
      c.alignment = { vertical: "middle" };
    });
  };
  const lotText = (l: PickLine) => l.lots.map((x) => `${x.lot}／${x.expiry}`).join("、");

  const zone = wb.addWorksheet("按凍庫理貨");
  zone.addRow([title]).font = { bold: true, size: 13 };
  zone.addRow([`配送車次 A / B｜依凍庫 A→D 依序揀貨；實際交付須逐車核對｜路線 v${routeVersion}`]).font = { color: { argb: "FF6F7782" } };
  styleHeader(zone.addRow(["凍庫", "SKU", "商品", "需揀數量", "單位", "車輛", "配送客戶", "實揀數量", "批號／效期", "位置", "訂單", "備註"]));
  const sorted = [...lines].sort((a, b) => a.zone.localeCompare(b.zone) || a.shelf.localeCompare(b.shelf) || a.sku.localeCompare(b.sku) || a.vehicleId.localeCompare(b.vehicleId) || a.stopSequence - b.stopSequence);
  for (const l of sorted) {
    const conf = confirmed[l.orderLineId];
    zone.addRow([l.zone, l.sku, l.productName, l.qty, l.unit, l.vehicleId, l.customerName, conf ? (l.unit === "箱" ? conf.qtyBase / (l.qtyBase / l.qty) : conf.qtyBase) : "", lotText(l), l.shelf, l.orderNo, l.note ?? ""]);
  }
  zone.columns = [{ width: 7 }, { width: 8 }, { width: 14 }, { width: 10 }, { width: 6 }, { width: 6 }, { width: 14 }, { width: 10 }, { width: 24 }, { width: 7 }, { width: 16 }, { width: 14 }];

  for (const v of vehicles) {
    const ws = wb.addWorksheet(`司機 ${v.id} 車`);
    styleHeader(ws.addRow(["凍庫", "SKU", "商品", "需揀數量", "單位", "客戶", "確認", "站序", "位置", "批號／效期", "備註"]));
    const mine = lines.filter((l) => l.vehicleId === v.id).sort((a, b) => a.zone.localeCompare(b.zone) || a.sku.localeCompare(b.sku) || a.stopSequence - b.stopSequence);
    for (const l of mine) ws.addRow([l.zone, l.sku, l.productName, l.qty, l.unit, l.customerName, confirmed[l.orderLineId] ? "☑" : "□", l.stopSequence, l.shelf, lotText(l), l.note ?? ""]);
    ws.addRow([]);
    ws.addRow([`${v.name}｜${v.plate}｜司機 ${v.driverName}｜路線 v${routeVersion}｜示範資料`]).font = { color: { argb: "FF6F7782" } };
    ws.columns = [{ width: 7 }, { width: 8 }, { width: 14 }, { width: 10 }, { width: 6 }, { width: 14 }, { width: 6 }, { width: 6 }, { width: 7 }, { width: 24 }, { width: 14 }];
  }

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `金吉利理貨單_${date}_v${routeVersion}.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
