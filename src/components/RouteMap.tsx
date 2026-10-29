"use client";

import "leaflet/dist/leaflet.css";
import type { LatLngExpression, LayerGroup, Map as LeafletMap } from "leaflet";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import type { Customer, GeoPoint, RouteStop, VehicleId } from "@/lib/domain/types";
import { ROUTING } from "@/lib/domain/routing";
import { MAP_TILES, TAICHUNG_BOUNDS } from "@/lib/mapConfig";

/** Real Taichung base map with the day's routes. Lines are straight stop-to-stop — illustrative, not navigation. */
const COLORS: Record<VehicleId, string> = { A: "#d9921a", B: "#2f6f8f" };
const ll = (p: GeoPoint): LatLngExpression => [p.lat, p.lng];
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

export function RouteMap({
  stops,
  customers,
  ghost,
  highlight,
  focusVehicle,
  className,
  onSelect,
  selected,
  lateIds = [],
}: {
  stops: RouteStop[];
  customers: Map<string, Customer>;
  ghost?: RouteStop[];
  highlight?: string;
  focusVehicle?: VehicleId | "all";
  className?: string;
  onSelect?: (customerId: string) => void;
  selected?: string;
  lateIds?: string[];
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  const lib = useRef<typeof import("leaflet") | null>(null);
  const [ready, setReady] = useState(false);
  const [tilesFailed, setTilesFailed] = useState(false);
  // narrow maps show pin numbers only; names stay on the selected / highlighted stop
  const [compact, setCompact] = useState(false);
  // latest click handler without re-creating the map
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  // create the map once; Leaflet touches window, so it is loaded only in the browser
  useEffect(() => {
    let cancelled = false;
    let resize: ResizeObserver | undefined;
    import("leaflet").then((L) => {
      if (cancelled || !el.current) return;
      lib.current = L;
      const m = L.map(el.current, { maxBounds: L.latLngBounds(TAICHUNG_BOUNDS).pad(0.05), maxBoundsViscosity: 1, minZoom: 10, maxZoom: MAP_TILES.maxZoom, zoomSnap: 0.25, scrollWheelZoom: false, attributionControl: true });
      m.attributionControl.setPrefix(false);
      let errors = 0;
      L.tileLayer(MAP_TILES.url, { maxZoom: MAP_TILES.maxZoom, attribution: MAP_TILES.attribution, className: "map-tiles" })
        .on("tileerror", () => {
          errors += 1;
          if (errors >= 4) setTilesFailed(true);
        })
        .on("tileload", () => setTilesFailed(false))
        .addTo(m);
      L.control.scale({ metric: true, imperial: false, position: "bottomleft" }).addTo(m);
      // wheel zoom only after the user clicks into the map, so scrolling the page never gets trapped
      m.on("click", () => m.scrollWheelZoom.enable());
      m.on("mouseout", () => m.scrollWheelZoom.disable());
      layer.current = L.layerGroup().addTo(m);
      map.current = m;
      resize = new ResizeObserver(([entry]) => {
        m.invalidateSize();
        setCompact(entry.contentRect.width < 560);
      });
      resize.observe(el.current);
      setReady(true);
    });
    return () => {
      cancelled = true;
      resize?.disconnect();
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // draw routes and stops whenever the data changes
  useEffect(() => {
    const L = lib.current;
    const m = map.current;
    const g = layer.current;
    if (!ready || !L || !m || !g) return;
    g.clearLayers();
    const dim = (v: VehicleId) => !!focusVehicle && focusVehicle !== "all" && focusVehicle !== v;
    const route = (v: VehicleId, list: RouteStop[]) => [ROUTING.depot, ...list.filter((s) => s.vehicleId === v).sort((a, b) => a.sequence - b.sequence).map((s) => customers.get(s.customerId)!.geo), ROUTING.depot].map(ll);

    for (const v of ["A", "B"] as VehicleId[]) {
      if (ghost) L.polyline(route(v, ghost), { color: COLORS[v], weight: 3, opacity: 0.3, dashArray: "6 7", interactive: false }).addTo(g);
      // white casing keeps the line readable over busy streets
      L.polyline(route(v, stops), { color: "#ffffff", weight: 7, opacity: dim(v) ? 0.2 : 0.85, lineJoin: "round", interactive: false }).addTo(g);
      L.polyline(route(v, stops), { color: COLORS[v], weight: 3.5, opacity: dim(v) ? 0.15 : 0.95, lineJoin: "round", interactive: false }).addTo(g);
    }

    L.marker(ll(ROUTING.depot), {
      icon: L.divIcon({ className: "", iconSize: [0, 0], html: `<div class="map-depot"><span>倉</span><b>金吉利倉庫</b></div>` }),
      keyboard: false,
      zIndexOffset: 500,
    }).addTo(g);

    for (const s of stops) {
      const c = customers.get(s.customerId)!;
      const classes = ["map-stop", `map-stop-${s.vehicleId}`, highlight === s.customerId && "is-highlight", selected === s.customerId && "is-selected", lateIds.includes(s.customerId) && "is-late", dim(s.vehicleId) && "is-dim"].filter(Boolean).join(" ");
      L.marker(ll(c.geo), {
        icon: L.divIcon({ className: "", iconSize: [0, 0], html: `<div class="${classes}"><span class="map-pin">${s.vehicleId}${s.sequence}</span><span class="map-label">${esc(c.name)}</span></div>` }),
        title: `${s.vehicleId} 車第 ${s.sequence} 站・${c.name}`,
        keyboard: !!onSelectRef.current,
        zIndexOffset: highlight === s.customerId || selected === s.customerId ? 1000 : 0,
      })
        .on("click", () => onSelectRef.current?.(s.customerId))
        .addTo(g);
    }
  }, [ready, stops, ghost, customers, highlight, selected, lateIds, focusVehicle]);

  // frame the day's stops (or the focused truck's) whenever the selection of what to show changes
  const stopKey = stops.map((s) => s.customerId).join();
  useEffect(() => {
    const L = lib.current;
    const m = map.current;
    if (!ready || !L || !m) return;
    const shown = stops.filter((s) => !focusVehicle || focusVehicle === "all" || s.vehicleId === focusVehicle);
    const pts = [ROUTING.depot, ...shown.map((s) => customers.get(s.customerId)!.geo)].map(ll);
    m.fitBounds(L.latLngBounds(pts), { padding: [36, 36] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, focusVehicle, stopKey]);

  return (
    <div className={cn("relative aspect-[4/5] w-full overflow-hidden bg-[#eef0ec] sm:aspect-[3/2]", compact && "map-compact", className)}>
      <div ref={el} className="absolute inset-0 z-0" role="region" aria-label="配送路線地圖（站點間直線示意）" data-testid="route-map" />
      {!compact && <div className="pointer-events-none absolute top-2 right-2 z-[400] rounded-full bg-surface/90 px-2.5 py-0.5 text-[11px] text-muted shadow-sm">站點間直線示意・非導航</div>}
      {tilesFailed && <div className="absolute inset-x-2 bottom-8 z-[400] rounded-lg bg-warn-soft px-3 py-1.5 text-[12px] text-warn">地圖底圖無法載入（可能離線），站點與路線仍正確顯示。</div>}
    </div>
  );
}
