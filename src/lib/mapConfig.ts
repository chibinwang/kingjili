/**
 * Base map tiles. The demo uses the public OpenStreetMap tiles (no key, attribution required, light use only).
 * Production should point NEXT_PUBLIC_MAP_TILE_URL at a keyed or self-hosted tile service (e.g. MapTiler, a self-hosted
 * OpenFreeMap) — only the tile images come from there; customer data never leaves the app.
 */
export const MAP_TILES = {
  url: process.env.NEXT_PUBLIC_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION || '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> 貢獻者',
  maxZoom: 18,
};

/** The map never pans outside Taichung City; it opens on the stops of the day. */
export const TAICHUNG_BOUNDS: [[number, number], [number, number]] = [
  [23.99, 120.46],
  [24.45, 121.45],
];
