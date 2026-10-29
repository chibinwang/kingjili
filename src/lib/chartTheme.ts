/**
 * Chart colours in one place (Recharts needs literal values, not CSS variables).
 * Text and axes reuse the globals.css tokens; the cost/profit pair was checked with the dataviz palette validator
 * (lightness band, chroma, CVD separation and 3:1 contrast on the white card surface).
 */
export const CHART = {
  grid: "#efebe3",
  axis: "#6f7782",
  tick: "#9aa1aa",
  border: "#e8e4db",
  surface: "#ffffff",
  cursor: "rgba(224,160,32,.08)",
  /** Single-series revenue (brand amber). */
  revenue: "#e0a020",
  cost: "#3f78b5",
  profit: "#c4850e",
  /** Revenue whose cost is unknown — deliberately neutral, it is a gap in the data, not a series. */
  unknown: "#d9d3c6",
} as const;
