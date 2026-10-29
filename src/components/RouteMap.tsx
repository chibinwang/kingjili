"use client";

import { cn } from "@/lib/cn";
import type { Customer, RouteStop, VehicleId } from "@/lib/domain/types";
import { ROUTING } from "@/lib/domain/routing";

/** Schematic map — illustrative geography only, not navigation or traffic data. */
const COLORS: Record<VehicleId, string> = { A: "#d9921a", B: "#2f6f8f" };

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
  const path = (v: VehicleId, list: RouteStop[]) => {
    const seq = list.filter((s) => s.vehicleId === v).sort((a, b) => a.sequence - b.sequence);
    const ptsArr = [ROUTING.depot, ...seq.map((s) => customers.get(s.customerId)!.geo), ROUTING.depot];
    return ptsArr.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ");
  };
  const dim = (v: VehicleId) => focusVehicle && focusVehicle !== "all" && focusVehicle !== v;
  return (
    <svg viewBox="80 60 900 600" className={cn("block h-auto w-full", className)} role="img" aria-label="配送路線示意">
      <defs>
        <pattern id="mapgrid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M40 0H0V40" fill="none" stroke="rgba(27,36,48,.035)" strokeWidth="1" />
        </pattern>
        {(["A", "B"] as VehicleId[]).map((v) => (
          <marker key={v} id={`arrow-${v}`} viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0 0 10 5 0 10z" fill={COLORS[v]} />
          </marker>
        ))}
      </defs>
      <rect x="80" y="60" width="900" height="600" fill="#f8f6f1" />
      <rect x="80" y="60" width="900" height="600" fill="url(#mapgrid)" />
      {/* districts */}
      <path d="M100 90 Q250 70 430 110 L450 300 Q300 340 120 300 Z" fill="#f1ede3" />
      <path d="M120 320 Q300 350 460 320 L470 500 Q260 520 110 480 Z" fill="#f3efe6" />
      <path d="M560 90 Q760 70 960 120 L950 280 Q760 300 560 260 Z" fill="#eef1ee" />
      <path d="M540 300 Q760 300 960 300 L955 520 Q760 540 550 500 Z" fill="#f0f2ef" />
      {/* river */}
      <path d="M480 60 C 500 180, 460 260, 520 340 S 560 520, 500 660" fill="none" stroke="#dbe9f1" strokeWidth="26" strokeLinecap="round" />
      <path d="M480 60 C 500 180, 460 260, 520 340 S 560 520, 500 660" fill="none" stroke="#cfe2ec" strokeWidth="2" strokeDasharray="1 10" strokeLinecap="round" />
      {/* main roads */}
      <g stroke="#ffffff" strokeWidth="9" fill="none" strokeLinecap="round">
        <path d="M90 230 L960 230" />
        <path d="M90 420 C 300 400, 700 440, 960 410" />
        <path d="M300 70 L300 650" />
        <path d="M700 70 C 690 300, 720 450, 700 650" />
        <path d="M500 600 L180 140" />
      </g>
      <g stroke="#e7e1d5" strokeWidth="1" fill="none">
        <path d="M90 230 L960 230" />
        <path d="M90 420 C 300 400, 700 440, 960 410" />
        <path d="M300 70 L300 650" />
        <path d="M700 70 C 690 300, 720 450, 700 650" />
        <path d="M500 600 L180 140" />
      </g>
      <g fontSize="12" fill="#b5ad9c" fontWeight="600" letterSpacing="2">
        <text x="130" y="110">西北區</text>
        <text x="130" y="470">西南區</text>
        <text x="860" y="110">東北區</text>
        <text x="860" y="510">東南區</text>
        <text x="540" y="372" fill="#a9c3d1">示範河</text>
      </g>

      {/* ghost (before) routes */}
      {ghost &&
        (["A", "B"] as VehicleId[]).map((v) => <path key={`g${v}`} d={path(v, ghost)} fill="none" stroke={COLORS[v]} strokeOpacity=".28" strokeWidth="3" strokeDasharray="6 7" />)}

      {/* active routes */}
      {(["A", "B"] as VehicleId[]).map((v) => (
        <path key={v} d={path(v, stops)} fill="none" stroke={COLORS[v]} strokeWidth="3.5" strokeLinejoin="round" strokeOpacity={dim(v) ? 0.15 : 0.9} markerMid={`url(#arrow-${v})`} />
      ))}

      {/* depot */}
      <g transform={`translate(${ROUTING.depot.x} ${ROUTING.depot.y})`}>
        <rect x="-20" y="-16" width="40" height="32" rx="9" fill="#1b2430" />
        <path d="M-8 5V-3l8-5 8 5v8" fill="none" stroke="#e0a020" strokeWidth="2" strokeLinejoin="round" />
        <text y="32" textAnchor="middle" fontSize="12" fontWeight="700" fill="#1b2430">
          金吉利倉庫
        </text>
      </g>

      {/* stops */}
      {stops.map((s) => {
        const c = customers.get(s.customerId)!;
        const isHl = highlight === s.customerId;
        const isSel = selected === s.customerId;
        const late = lateIds.includes(s.customerId);
        return (
          <g
            key={s.deliveryId}
            transform={`translate(${c.geo.x} ${c.geo.y})`}
            opacity={dim(s.vehicleId) ? 0.25 : 1}
            onClick={() => onSelect?.(s.customerId)}
            style={{ cursor: onSelect ? "pointer" : undefined }}
          >
            {isHl && <circle r="26" fill={COLORS[s.vehicleId]} opacity=".14" className="animate-pulse-soft" />}
            {late && <circle r="20" fill="none" stroke="#b4483a" strokeWidth="2" strokeDasharray="3 3" />}
            <path d="M0 6 C -14 -6, -14 -24, 0 -24 C 14 -24, 14 -6, 0 6Z" fill={COLORS[s.vehicleId]} stroke="#fff" strokeWidth={isSel ? 3 : 2} transform="translate(0 -2)" />
            <text y="-11" textAnchor="middle" fontSize="12" fontWeight="800" fill="#fff">
              {s.vehicleId}
              {s.sequence}
            </text>
            <g transform="translate(0 18)">
              <rect x={-c.name.length * 6.5 - 6} y="-10" width={c.name.length * 13 + 12} height="19" rx="6" fill="#fff" stroke={isHl || isSel ? COLORS[s.vehicleId] : "#e8e4db"} strokeWidth={isHl || isSel ? 1.5 : 1} />
              <text y="4" textAnchor="middle" fontSize="12" fill="#1b2430" fontWeight={isHl ? 700 : 500}>
                {c.name}
              </text>
            </g>
          </g>
        );
      })}
    </svg>
  );
}
