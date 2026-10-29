"use client";

import { AlertTriangle, Snowflake, Thermometer, Truck } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { daysToExpiry, isExpired } from "@/lib/domain/inventory";
import type { ZoneId } from "@/lib/domain/types";
import { pickLines, stockPositions } from "@/lib/selectors";
import { useDb } from "@/lib/store";
import { DEMO_TODAY } from "@/lib/time";
import { Badge, Button } from "./ui";

/**
 * Schematic axonometric warehouse — proportions approximate, NOT a survey.
 * Plan units: x → right (0..40), y → front (0..26). Rotated θ and tilted k for a light 3D read.
 */
const S = 13.5;
const TH = (24 * Math.PI) / 180;
const K = 0.58;
const ZK = 0.95;
const OX = 205;
const OY = 58;

function P(x: number, y: number, z = 0): [number, number] {
  return [OX + (x * Math.cos(TH) - y * Math.sin(TH)) * S, OY + (x * Math.sin(TH) + y * Math.cos(TH)) * S * K - z * S * ZK];
}
const pts = (...p: [number, number][]) => p.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(" ");

/** SVG matrix that lays plan-space drawing onto the horizontal plane at height z. */
function planeMatrix(z: number) {
  const a = Math.cos(TH) * S;
  const b = Math.sin(TH) * S * K;
  const c = -Math.sin(TH) * S;
  const d = Math.cos(TH) * S * K;
  return `matrix(${a} ${b} ${c} ${d} ${OX} ${OY - z * S * ZK})`;
}

/** Lays drawing onto the right-hand side face (x = const). u runs rear→front along −y so text reads left→right; v runs down (−z). */
function sideMatrix(x: number) {
  const [e, f] = P(x, 0, 0);
  return `matrix(${Math.sin(TH) * S} ${-Math.cos(TH) * S * K} 0 ${S * ZK} ${e} ${f})`;
}
/** Lays drawing onto a front face (y = const). u = x, v = −z. */
function frontMatrix(y: number) {
  const [e, f] = P(0, y, 0);
  return `matrix(${Math.cos(TH) * S} ${Math.sin(TH) * S * K} 0 ${S * ZK} ${e} ${f})`;
}

function Box({ x0, y0, x1, y1, z0 = 0, h, top, front, side, stroke = "rgba(27,36,48,.18)", className, opacity = 1 }: { x0: number; y0: number; x1: number; y1: number; z0?: number; h: number; top: string; front: string; side: string; stroke?: string; className?: string; opacity?: number }) {
  return (
    <g className={className} opacity={opacity}>
      <polygon points={pts(P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, h), P(x0, y1, h))} fill={front} stroke={stroke} strokeWidth={0.6} />
      <polygon points={pts(P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, h), P(x1, y0, h))} fill={side} stroke={stroke} strokeWidth={0.6} />
      <polygon points={pts(P(x0, y0, h), P(x1, y0, h), P(x1, y1, h), P(x0, y1, h))} fill={top} stroke={stroke} strokeWidth={0.6} />
    </g>
  );
}

const ROOMS: { zone: ZoneId; y0: number; y1: number; label: string; tint: [string, string, string] }[] = [
  { zone: "A", y0: 0.6, y1: 6.6, label: "凍庫 A", tint: ["#e7f1f7", "#c9dbe6", "#b5cbd8"] },
  { zone: "B", y0: 6.9, y1: 12.9, label: "凍庫 B", tint: ["#e5f0f6", "#c6d9e5", "#b2c8d6"] },
  { zone: "C", y0: 13.2, y1: 19.2, label: "凍庫 C", tint: ["#e3eff5", "#c4d7e3", "#afc6d4"] },
  { zone: "D", y0: 19.5, y1: 25.5, label: "凍庫 D", tint: ["#e1edf4", "#c1d5e1", "#acc3d2"] },
];
const RX0 = 27.2;
const RX1 = 39.4;
const RH = 3.1;

type TruckSel = "truck-A" | "truck-B";
type Sel = ZoneId | "pick" | "office" | TruckSel | null;
const isZone = (s: Sel): s is ZoneId => s === "A" || s === "B" || s === "C" || s === "D";

const TRUCK_PAINT = {
  A: { top: "#f1c063", front: "#e0a020", side: "#c4820f", dark: "#9c6508" },
  B: { top: "#86b2c6", front: "#3b7d9c", side: "#2f6f8f", dark: "#1f5069" },
} as const;

interface TruckState {
  id: "A" | "B";
  plate: string;
  driver: string;
  loadKg: number;
  capacityKg: number;
  stops: number;
  picks: number;
  picked: number;
}

/** Refrigerated box truck parked rear-first against the dock. Plan coords: x0 = left edge, rear at y = 27.2, cab toward +y. */
function IsoTruck({ t, x0, on, compact, bind }: { t: TruckState; x0: number; on: boolean; compact?: boolean; bind: React.SVGProps<SVGGElement> }) {
  const paint = TRUCK_PAINT[t.id];
  const W = 4.4;
  const x1 = x0 + W;
  const yR = 27.2; // rear of cargo box
  const yC = 33.5; // cargo / cab joint
  const yF = 36.3; // cab front face
  const zF = 0.95; // floor of the body above the chassis
  const zTop = 3.75; // cargo roof
  const loading = t.picked < t.picks;
  const loadPct = Math.min(1, t.loadKg / t.capacityKg);
  const glass = "#2b3a48";
  const wheel = (y: number, dual = false) => (
    <g transform={sideMatrix(x1 - 0.05)} key={y}>
      <circle cx={-y} cy={-0.62} r={0.74} fill="#3a3f45" />
      <circle cx={-y} cy={-0.6} r={0.6} fill="#23272c" />
      <circle cx={-y} cy={-0.6} r={0.3} fill={dual ? "#b9bec4" : "#d3d7db"} stroke="#8d939a" strokeWidth={0.06} />
      <circle cx={-y} cy={-0.6} r={0.08} fill="#6f757c" />
    </g>
  );
  return (
    <g {...bind} aria-label={`${t.id} 車 ${t.plate}`}>
      <title>{`${t.id} 車・${t.plate}・司機 ${t.driver}\n載重 ${t.loadKg}／${t.capacityKg} kg・${t.stops} 站・已揀 ${t.picked}/${t.picks} 行`}</title>
      {/* ground shadow */}
      <polygon points={pts(P(x0 - 0.2, yR + 0.2, 0), P(x1 + 0.9, yR + 0.2, 0), P(x1 + 0.9, yF + 0.9, 0), P(x0 - 0.2, yF + 0.9, 0))} fill="rgba(27,36,48,.13)" />
      {/* dock leveller bridging the dock edge while loading */}
      {loading && <polygon points={pts(P(x0 + 0.7, 25.95, 0.9), P(x1 - 0.7, 25.95, 0.9), P(x1 - 0.7, yR, zF), P(x0 + 0.7, yR, zF))} fill="#b9bfc5" stroke="#8d949b" strokeWidth={0.5} />}
      {/* chassis rail + rear bumper */}
      <Box x0={x0 + 0.35} y0={yR + 0.1} x1={x1 - 0.35} y1={yF - 0.2} z0={0.45} h={zF} top="#4a5058" front="#353a40" side="#2c3035" stroke="rgba(0,0,0,.25)" />
      {/* insulated cargo box */}
      <Box x0={x0} y0={yR} x1={x1} y1={yC} z0={zF} h={zTop} top={on ? "#ffffff" : "#f7f8f8"} front="#e6e9eb" side="#e9ecee" stroke={on ? "#e0a020" : "rgba(27,36,48,.22)"} />
      {/* panel seams, colour band and livery on the visible side */}
      <g transform={sideMatrix(x1)}>
        {[1, 2, 3, 4, 5].map((i) => (
          <line key={i} x1={-(yR + i * ((yC - yR) / 6))} y1={-zTop + 0.1} x2={-(yR + i * ((yC - yR) / 6))} y2={-zF - 0.1} stroke="rgba(27,36,48,.07)" strokeWidth={0.05} />
        ))}
        <rect x={-yC + 0.15} y={-1.75} width={yC - yR - 0.3} height={0.42} fill={paint.front} />
        <rect x={-yC + 0.15} y={-1.33} width={yC - yR - 0.3} height={0.1} fill={paint.dark} />
        {!compact && (
          <>
            <text x={-(yR + yC) / 2} y={-2.25} fontSize={0.95} textAnchor="middle" fill="#1b2430" fontWeight={800} letterSpacing={0.04}>
              金吉利冷凍
            </text>
          </>
        )}
        {/* rear door hinge edge */}
        <rect x={-yR - 0.32} y={-zTop + 0.15} width={0.12} height={zTop - zF - 0.3} fill="rgba(27,36,48,.18)" />
      </g>
      {/* refrigeration unit on the front wall, above the cab */}
      <Box x0={x0 + 0.7} y0={yC} x1={x1 - 0.7} y1={yC + 0.55} z0={2.95} h={3.6} top="#d7dbdf" front="#bcc2c8" side="#aab1b8" stroke="rgba(0,0,0,.2)" />
      <g transform={frontMatrix(yC + 0.55)}>
        {[0, 1, 2, 3].map((i) => (
          <line key={i} x1={x0 + 0.95} y1={-3.05 - i * 0.13} x2={x1 - 0.95} y2={-3.05 - i * 0.13} stroke="#8c949c" strokeWidth={0.05} />
        ))}
      </g>
      {/* cab: lower body, set-back cabin, raked windscreen */}
      <Box x0={x0 + 0.1} y0={yC + 0.05} x1={x1 - 0.1} y1={yF} z0={zF} h={2.15} top={paint.top} front={paint.front} side={paint.side} stroke="rgba(0,0,0,.18)" />
      <Box x0={x0 + 0.1} y0={yC + 0.05} x1={x1 - 0.1} y1={yF - 0.75} z0={2.15} h={3.2} top={paint.top} front={paint.front} side={paint.side} stroke="rgba(0,0,0,.18)" />
      <polygon points={pts(P(x0 + 0.1, yF - 0.75, 3.2), P(x1 - 0.1, yF - 0.75, 3.2), P(x1 - 0.1, yF, 2.15), P(x0 + 0.1, yF, 2.15))} fill={glass} stroke="rgba(0,0,0,.3)" strokeWidth={0.5} />
      <polygon points={pts(P(x0 + 0.5, yF - 0.68, 3.08), P(x0 + 1.5, yF - 0.68, 3.08), P(x0 + 1.1, yF - 0.1, 2.3), P(x0 + 0.35, yF - 0.1, 2.3))} fill="rgba(255,255,255,.16)" />
      <polygon points={pts(P(x1 - 0.1, yF - 0.75, 2.15), P(x1 - 0.1, yF - 0.75, 3.2), P(x1 - 0.1, yF, 2.15))} fill={paint.side} stroke="rgba(0,0,0,.18)" strokeWidth={0.5} />
      <g transform={sideMatrix(x1 - 0.1)}>
        {/* side window + door line + handle */}
        <polygon points={`${-(yF - 0.85)},-2.35 ${-(yC + 0.45)},-2.35 ${-(yC + 0.45)},-3.05 ${-(yF - 0.85)},-3.05`} fill={glass} />
        <line x1={-(yC + 0.3)} y1={-1.05} x2={-(yC + 0.3)} y2={-3.15} stroke="rgba(0,0,0,.22)" strokeWidth={0.05} />
        <line x1={-(yF - 0.35)} y1={-1.05} x2={-(yF - 0.35)} y2={-2.15} stroke="rgba(0,0,0,.22)" strokeWidth={0.05} />
        <rect x={-(yC + 0.75)} y={-2.0} width={0.32} height={0.08} rx={0.03} fill={paint.dark} />
        {/* wheel arches */}
        <path d={`M ${-(yF - 0.45)} ${-zF} a 0.82 0.82 0 0 0 -1.64 0 Z`} fill="#1d2126" />
        <path d={`M ${-(yR + 1.15)} ${-zF} a 0.82 0.82 0 0 0 -1.64 0 Z`} fill="#1d2126" />
        <path d={`M ${-(yR + 2.6)} ${-zF} a 0.82 0.82 0 0 0 -1.64 0 Z`} fill="#1d2126" />
      </g>
      {/* mirror */}
      {!compact && <polygon points={pts(P(x1 + 0.05, yF - 0.6, 2.75), P(x1 + 0.45, yF - 0.6, 2.75), P(x1 + 0.45, yF - 0.6, 2.05), P(x1 + 0.05, yF - 0.6, 2.05))} fill="#2f353b" />}
      {/* front: grille, headlights, bumper, plate */}
      <g transform={frontMatrix(yF)}>
        <rect x={x0 + 1.25} y={-1.95} width={W - 2.5} height={0.55} rx={0.08} fill={paint.dark} />
        <rect x={x0 + 0.35} y={-1.9} width={0.7} height={0.38} rx={0.08} fill="#fff6d6" stroke="rgba(0,0,0,.2)" strokeWidth={0.04} />
        <rect x={x1 - 1.05} y={-1.9} width={0.7} height={0.38} rx={0.08} fill="#fff6d6" stroke="rgba(0,0,0,.2)" strokeWidth={0.04} />
      </g>
      <Box x0={x0} y0={yF} x1={x1} y1={yF + 0.22} z0={0.6} h={1.15} top="#5b6168" front="#3d4248" side="#33373c" stroke="rgba(0,0,0,.25)" />
      {!compact && (
        <g transform={frontMatrix(yF + 0.22)}>
          <rect x={(x0 + x1) / 2 - 0.62} y={-1.08} width={1.24} height={0.42} rx={0.05} fill="#f7f7f2" stroke="#1b2430" strokeWidth={0.04} />
          <text x={(x0 + x1) / 2} y={-0.76} fontSize={0.3} textAnchor="middle" fill="#1b2430" fontWeight={700}>
            {t.plate}
          </text>
        </g>
      )}
      {/* wheels (visible side): dual rear axle + steer axle */}
      {wheel(yR + 1.97, true)}
      {wheel(yR + 3.42, true)}
      {wheel(yF - 1.27)}
      {/* roof: vehicle letter, cold-chain mark, load gauge */}
      <g transform={planeMatrix(zTop)}>
        <circle cx={x0 + W / 2} cy={yR + 2.3} r={1.25} fill={paint.front} />
        <text x={x0 + W / 2} y={yR + 2.82} fontSize={1.5} textAnchor="middle" fill="#fff" fontWeight={800}>
          {t.id}
        </text>
        {!compact && (
          <>
            <text x={x0 + W / 2} y={yR + 4.55} fontSize={0.55} textAnchor="middle" fill="#3b6a9a" fontWeight={600}>
              ❄ −18°C
            </text>
            <rect x={x0 + 0.5} y={yC - 1.15} width={W - 1} height={0.38} rx={0.19} fill="#dfe3e6" />
            <rect x={x0 + 0.5} y={yC - 1.15} width={Math.max(0.38, (W - 1) * loadPct)} height={0.38} rx={0.19} fill={loadPct > 0.9 ? "#b4483a" : paint.front} />
          </>
        )}
      </g>
      {/* status tag above the truck */}
      {!compact &&
        (() => {
          const [tx, ty] = P(x0 + W / 2 + 0.6, yF + 2.4, 0);
          const label = loading ? `裝貨中 ${t.picked}/${t.picks}` : "裝載完成";
          return (
            <g>
              <rect x={tx - 30} y={ty - 10} width={60} height={17} rx={8.5} fill={loading ? "#fffaf0" : "#e6f3ec"} stroke={loading ? "#e0a020" : "#2f7d5b"} strokeWidth={0.8} />
              <text x={tx} y={ty + 2.5} fontSize="9.5" textAnchor="middle" fill={loading ? "#b47a0c" : "#2f7d5b"} fontWeight={700}>
                {label}
              </text>
            </g>
          );
        })()}
    </g>
  );
}

export function WarehouseIso({ compact }: { compact?: boolean }) {
  const db = useDb();
  const [hover, setHover] = useState<Sel>(null);
  const [sel, setSel] = useState<Sel>("A");
  const lines = pickLines(db);
  const pos = stockPositions(db);

  const zoneInfo = useMemo(() => {
    const out = {} as Record<ZoneId, { skus: number; units: number; picks: number; pickedLines: number; alerts: string[] }>;
    for (const r of ROOMS) {
      const prods = db.products.filter((p) => p.zone === r.zone);
      const zl = lines.filter((l) => l.zone === r.zone);
      const alerts: string[] = [];
      for (const p of prods) {
        const s = pos.get(p.id)!;
        if (s.expired) alerts.push(`${p.name} ${s.expired}${p.baseUnit} 過期（已鎖定）`);
        if (s.belowReorder) alerts.push(`${p.name} 低於補貨點`);
        const near = db.lots.find((l) => l.productId === p.id && !isExpired(l, DEMO_TODAY) && daysToExpiry(l, DEMO_TODAY) <= 14 && l.qtyOnHand > 0);
        if (near) alerts.push(`${p.name} 批號 ${near.lot} ${daysToExpiry(near, DEMO_TODAY)} 天內到期（FEFO 優先）`);
      }
      out[r.zone] = {
        skus: prods.length,
        units: prods.reduce((a, p) => a + pos.get(p.id)!.onHand, 0),
        picks: zl.length,
        pickedLines: zl.filter((l) => db.pickConfirmations[l.orderLineId]).length,
        alerts,
      };
    }
    return out;
  }, [db, lines, pos]);

  const trucks = useMemo<TruckState[]>(
    () =>
      db.vehicles.map((v) => {
        const vl = lines.filter((l) => l.vehicleId === v.id);
        const grams = vl.reduce((a, l) => a + l.qtyBase * (db.products.find((p) => p.id === l.productId)?.weightGramPerBase ?? 0), 0);
        return { id: v.id, plate: v.plate, driver: v.driverName, loadKg: Math.round(grams / 1000), capacityKg: v.capacityKg, stops: new Set(vl.map((l) => l.customerId)).size, picks: vl.length, picked: vl.filter((l) => db.pickConfirmations[l.orderLineId]).length };
      }),
    [db, lines],
  );

  const totalPicks = lines.length;
  const doneAll = lines.filter((l) => db.pickConfirmations[l.orderLineId]).length;

  const hl = (z: Sel) => hover === z || sel === z;
  const bind = (z: Sel) => ({
    onMouseEnter: () => setHover(z),
    onMouseLeave: () => setHover(null),
    onClick: () => setSel(z),
    style: { cursor: "pointer" },
  });

  // racks in picking area: rows along x
  const racks: { x0: number; y0: number; x1: number; y1: number }[] = [];
  for (let r = 0; r < 3; r++) racks.push({ x0: 1.5, y0: 1.6 + r * 4.2, x1: 15.5, y1: 2.9 + r * 4.2 });
  const pallets: [number, number][] = [
    [18, 2],
    [21, 2],
    [18, 6],
    [21.5, 6.2],
    [18.5, 10.5],
  ];

  return (
    <div className={cn("grid gap-5", compact ? "" : "xl:grid-cols-[1fr_330px]")}>
      <div className="relative overflow-hidden rounded-[14px] border border-line bg-[radial-gradient(120%_90%_at_30%_10%,#fffdf8_0%,#f3efe6_70%)]">
        <div className="absolute top-3 left-4 z-10 flex items-center gap-2">
          <Badge tone="mock">配置示意 / 非比例測繪</Badge>
          <span className="text-[11.5px] text-faint">點選區域查看品項與待揀</span>
        </div>
        <svg viewBox="0 0 720 470" className="block h-auto w-full" role="img" aria-label="倉庫配置示意圖">
          <defs>
            <pattern id="floorgrid" width="1" height="1" patternUnits="userSpaceOnUse">
              <path d="M1 0H0V1" fill="none" stroke="rgba(27,36,48,.06)" strokeWidth=".04" />
            </pattern>
            <linearGradient id="frost" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#f4f9fc" />
              <stop offset="1" stopColor="#dbe9f2" />
            </linearGradient>
            <filter id="soft" x="-10%" y="-10%" width="120%" height="140%">
              <feDropShadow dx="0" dy="6" stdDeviation="6" floodColor="#1b2430" floodOpacity=".12" />
            </filter>
          </defs>

          {/* building slab */}
          <g filter="url(#soft)">
            <Box x0={0} y0={0} x1={40} y1={26} h={0.35} top="#fbfaf6" front="#e2ddd2" side="#d8d2c5" stroke="rgba(27,36,48,.12)" />
          </g>
          <g transform={planeMatrix(0.35)}>
            <rect x="0" y="0" width="40" height="26" fill="url(#floorgrid)" />
            {/* picking zone floor */}
            <rect x="0.6" y="0.6" width="25.6" height="14.6" rx=".3" fill={hl("pick") ? "#fcefd0" : "#fbf4e2"} stroke={hl("pick") ? "#e0a020" : "#ecdcb5"} strokeWidth=".09" {...bind("pick")} />
            {/* aisle / staging */}
            <rect x="12.6" y="15.8" width="14" height="9.6" rx=".3" fill="#f2efe8" stroke="#e3ddd0" strokeWidth=".06" strokeDasharray=".3 .25" />
            <text x="19.6" y="21.2" fontSize=".95" textAnchor="middle" fill="#9aa1aa">出貨暫存・A/B 車分區</text>
            <rect x="13.4" y="16.6" width="5.6" height="3.4" rx=".2" fill="none" stroke="#d9921a" strokeWidth=".09" strokeDasharray=".35 .2" />
            <text x="16.2" y="18.6" fontSize=".8" textAnchor="middle" fill="#b47a0c" fontWeight="600">A 車暫存</text>
            <rect x="20.2" y="16.6" width="5.6" height="3.4" rx=".2" fill="none" stroke="#2f6f8f" strokeWidth=".09" strokeDasharray=".35 .2" />
            <text x="23" y="18.6" fontSize=".8" textAnchor="middle" fill="#2f6f8f" fontWeight="600">B 車暫存</text>
            {/* office floor */}
            <rect x="0.6" y="15.8" width="11.4" height="9.6" rx=".3" fill={hl("office") ? "#eef0f3" : "#f1f1ef"} stroke="#dcdcd6" strokeWidth=".06" {...bind("office")} />
            {/* zone labels on floor */}
            <text x="2" y="14.4" fontSize="1.05" fill="#b47a0c" fontWeight="700" letterSpacing=".05">理貨區</text>
            <text x="9" y="14.4" fontSize=".8" fill="#b9a374">貨架・棧板・揀貨動線</text>
          </g>

          {/* racks with cartons */}
          {racks.map((r, i) => (
            <g key={i} {...bind("pick")}>
              <Box x0={r.x0} y0={r.y0} x1={r.x1} y1={r.y1} h={1.9} top="#e9e3d6" front="#cfc6b3" side="#bfb6a2" opacity={0.95} />
              {Array.from({ length: 6 }).map((_, j) => {
                const bx = r.x0 + 0.4 + j * 2.3;
                const filled = (i * 6 + j) % 5 !== 3;
                return filled ? <Box key={j} x0={bx} y0={r.y0 + 0.15} x1={bx + 1.8} y1={r.y1 - 0.15} h={1.9 + 0.9 + ((i + j) % 2) * 0.35} top="#f3d58f" front="#e2b65c" side="#cf9f45" stroke="rgba(120,80,10,.22)" /> : null;
              })}
            </g>
          ))}
          {pallets.map(([x, y], i) => (
            <g key={i} {...bind("pick")}>
              <Box x0={x} y0={y} x1={x + 2.4} y1={y + 2.2} h={0.35} top="#d8c3a0" front="#bfa67e" side="#ae956d" />
              <Box x0={x + 0.2} y0={y + 0.2} x1={x + 2.2} y1={y + 2} h={0.35 + 1.2 + (i % 2) * 0.6} top="#f6e2b0" front="#e7c57a" side="#d6b064" stroke="rgba(120,80,10,.2)" />
            </g>
          ))}

          {/* office */}
          <g {...bind("office")}>
            <Box x0={0.6} y0={15.8} x1={12} y1={16.05} h={2.2} top="#fafafa" front="#e6e7e5" side="#d9dad7" />
            <Box x0={11.75} y0={15.8} x1={12} y1={25.4} h={2.2} top="#fafafa" front="#e6e7e5" side="#d9dad7" />
            <Box x0={2} y0={18} x1={6} y1={19.6} h={1} top="#ffffff" front="#e9e9e6" side="#dededa" />
            <Box x0={7} y0={18} x1={10.5} y1={19.6} h={1} top="#ffffff" front="#e9e9e6" side="#dededa" />
            <Box x0={0.6} y0={25.15} x1={12} y1={25.4} h={1.1} top="#f6f6f4" front="#e3e4e1" side="#d6d7d3" opacity={0.85} />
            <g transform={planeMatrix(1.2)}>
              <text x="6.2" y="22.8" fontSize="1.05" textAnchor="middle" fill="#3c4654" fontWeight="600">辦公室</text>
            </g>
          </g>

          {/* cold rooms (back to front) */}
          {ROOMS.map((r) => {
            const on = hl(r.zone);
            const info = zoneInfo[r.zone];
            const lift = on ? 0.35 : 0;
            return (
              <g key={r.zone} {...bind(r.zone)} className="transition-transform">
                <Box x0={RX0} y0={r.y0} x1={RX1} y1={r.y1} h={RH + lift} top={on ? "#f7fbfd" : "url(#frost)"} front={r.tint[1]} side={r.tint[2]} stroke={on ? "#e0a020" : "rgba(47,111,143,.35)"} />
                {/* door on front face */}
                <polygon points={pts(P(RX0 + 1.2, r.y1, 0), P(RX0 + 3.6, r.y1, 0), P(RX0 + 3.6, r.y1, 2.4), P(RX0 + 1.2, r.y1, 2.4))} fill="#9fbccd" stroke="rgba(47,111,143,.45)" strokeWidth={0.6} />
                <g transform={planeMatrix(RH + lift)}>
                  <rect x={RX0 + 0.5} y={r.y0 + 0.5} width={RX1 - RX0 - 1} height={r.y1 - r.y0 - 1} rx=".35" fill="none" stroke={on ? "#e0a020" : "rgba(47,111,143,.22)"} strokeWidth=".07" strokeDasharray={on ? "" : ".25 .2"} />
                  <text x={RX0 + 1.1} y={r.y0 + 2.2} fontSize="1.45" fill="#1b2430" fontWeight="700">
                    {r.label}
                  </text>
                  <text x={RX0 + 1.1} y={r.y0 + 3.6} fontSize=".85" fill="#3b6a9a">
                    冷庫 {["A", "B", "C", "D"].indexOf(r.zone) + 1} ・{info.skus} 品項
                  </text>
                  <text x={RX0 + 1.1} y={r.y0 + 4.9} fontSize=".85" fill={info.picks ? "#b47a0c" : "#9aa1aa"} fontWeight="600">
                    今日待揀 {info.picks - info.pickedLines}／{info.picks} 行
                  </text>
                  {info.alerts.length > 0 && (
                    <g>
                      <circle cx={RX1 - 1.4} cy={r.y0 + 1.6} r=".75" fill="#b4483a" />
                      <text x={RX1 - 1.4} y={r.y0 + 1.95} fontSize=".9" textAnchor="middle" fill="#fff" fontWeight="700">
                        {info.alerts.length}
                      </text>
                    </g>
                  )}
                </g>
              </g>
            );
          })}

          {/* plastic curtain along the front dock opening */}
          <g>
            {Array.from({ length: 22 }).map((_, i) => {
              const x = 12.8 + i * 0.62;
              return <polygon key={i} points={pts(P(x, 25.95, 0.35), P(x + 0.55, 25.95, 0.35), P(x + 0.55, 25.95, 2.7), P(x, 25.95, 2.7))} fill={i % 2 ? "rgba(170,205,222,.42)" : "rgba(190,220,232,.32)"} stroke="rgba(47,111,143,.25)" strokeWidth={0.4} />;
            })}
            <polygon points={pts(P(12.6, 25.95, 2.7), P(26.6, 25.95, 2.7), P(26.6, 25.95, 2.95), P(12.6, 25.95, 2.95))} fill="#9fb4c0" />
          </g>
          {(() => {
            const [lx, ly] = P(19.6, 27.6, 0);
            return (
              <text x={lx} y={ly + 6} fontSize="11" textAnchor="middle" fill="#6f7782">
                塑膠簾布・進出貨口
              </text>
            );
          })()}
          {/* refrigerated trucks at the dock (A behind B) */}
          {trucks.map((t, i) => (
            <IsoTruck key={t.id} t={t} x0={13.6 + i * 6.6} on={hl(`truck-${t.id}`)} compact={compact} bind={bind(`truck-${t.id}`)} />
          ))}
        </svg>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-line bg-surface/70 px-4 py-2.5 text-[11.5px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[3px] bg-[#f3d58f]" /> 理貨區（貨架／棧板）
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[3px] bg-[#c9dbe6]" /> 凍庫 A–D（對應示意圖 1–4）
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[3px] bg-[#e6e7e5]" /> 辦公室
          </span>
          <span className="ml-auto num">
            今日揀貨進度 {doneAll}/{totalPicks}
          </span>
        </div>
      </div>

      {!compact && (
        <ZonePanel
          sel={sel}
          info={isZone(sel) ? zoneInfo[sel] : undefined}
          truck={sel === "truck-A" || sel === "truck-B" ? trucks.find((t) => `truck-${t.id}` === sel) : undefined}
          rows={isZone(sel) ? db.products.filter((p) => p.zone === sel).map((p) => ({ p, s: pos.get(p.id)!, picks: lines.filter((l) => l.productId === p.id) })) : []}
          pickSummary={{ total: totalPicks, done: doneAll, customers: new Set(lines.map((l) => l.customerId)).size }}
          onSelect={setSel}
        />
      )}
    </div>
  );
}

function ZonePanel({
  sel,
  info,
  truck,
  rows,
  pickSummary,
  onSelect,
}: {
  sel: Sel;
  truck?: TruckState;
  info?: { skus: number; units: number; picks: number; pickedLines: number; alerts: string[] };
  rows: { p: { id: string; sku: string; name: string; baseUnit: string; packSize: number; packUnit: string; shelf: string }; s: { onHand: number; reserved: number; projected: number; belowReorder: boolean; expired: number }; picks: { qtyBase: number }[] }[];
  pickSummary: { total: number; done: number; customers: number };
  onSelect: (s: Sel) => void;
}) {
  return (
    <div className="rounded-[14px] border border-line bg-surface">
      <div className="flex gap-1 border-b border-line p-2">
        {(["A", "B", "C", "D"] as const).map((z) => (
          <button key={z} onClick={() => onSelect(z)} className={cn("flex-1 rounded-[8px] py-1.5 text-[12.5px] font-semibold", sel === z ? "bg-frost text-info" : "text-muted hover:bg-sunk")}>
            凍庫 {z}
          </button>
        ))}
        <button onClick={() => onSelect("pick")} className={cn("flex-1 rounded-[8px] py-1.5 text-[12.5px] font-semibold", sel === "pick" ? "bg-amber-soft text-amber-deep" : "text-muted hover:bg-sunk")}>
          理貨
        </button>
        {(["A", "B"] as const).map((v) => (
          <button key={v} onClick={() => onSelect(`truck-${v}`)} className={cn("flex-1 rounded-[8px] py-1.5 text-[12.5px] font-semibold", sel === `truck-${v}` ? (v === "A" ? "bg-amber-soft text-amber-deep" : "bg-truck-b-soft text-truck-b") : "text-muted hover:bg-sunk")}>
            {v} 車
          </button>
        ))}
      </div>
      {truck ? (
        <div className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[15px] font-semibold">
              <Truck size={16} className={truck.id === "A" ? "text-truck-a" : "text-truck-b"} /> {truck.id} 車・冷凍貨車
            </div>
            <span className="num text-[12px] text-muted">{truck.plate}</span>
          </div>
          <div className="mt-1 text-[12.5px] text-muted">司機 {truck.driver}・{truck.stops} 站</div>
          <div className="mt-3">
            <div className="flex justify-between text-[12px]">
              <span className="text-muted">今日載重（依理貨單估算）</span>
              <span className="num font-medium">
                {truck.loadKg}／{truck.capacityKg} kg
              </span>
            </div>
            <div className="mt-1.5 h-2 rounded-full bg-sunk">
              <div className={cn("h-2 rounded-full", truck.id === "A" ? "bg-truck-a" : "bg-truck-b")} style={{ width: `${Math.min(100, (truck.loadKg / truck.capacityKg) * 100)}%` }} />
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-center">
            <div className="rounded-[10px] bg-sunk py-2">
              <div className="num text-[17px] font-semibold">
                {truck.picked}/{truck.picks}
              </div>
              <div className="text-[11px] text-muted">已揀行數</div>
            </div>
            <div className={cn("rounded-[10px] py-2", truck.picked < truck.picks ? "bg-amber-wash" : "bg-ok-soft")}>
              <div className={cn("text-[15px] font-semibold", truck.picked < truck.picks ? "text-amber-deep" : "text-ok")}>{truck.picked < truck.picks ? "裝貨中" : "裝載完成"}</div>
              <div className="text-[11px] text-muted">停靠出貨口</div>
            </div>
          </div>
          <Link href="/dispatch?tab=vehicle" className="mt-3 block">
            <Button variant="outline" size="sm" className="w-full">
              開啟 {truck.id} 車理貨單
            </Button>
          </Link>
        </div>
      ) : info && isZone(sel) ? (
        <div className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[15px] font-semibold">
              <Snowflake size={16} className="text-info" /> 凍庫 {sel}
            </div>
            <span className="inline-flex items-center gap-1 text-[11.5px] text-muted" title="未接溫度感測器，顯示為設定值">
              <Thermometer size={13} /> 設定 −18°C・未接感測器
            </span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-[10px] bg-sunk py-2">
              <div className="num text-[17px] font-semibold">{info.skus}</div>
              <div className="text-[11px] text-muted">品項</div>
            </div>
            <div className="rounded-[10px] bg-sunk py-2">
              <div className="num text-[17px] font-semibold">{info.units}</div>
              <div className="text-[11px] text-muted">在庫（基本單位）</div>
            </div>
            <div className="rounded-[10px] bg-amber-wash py-2">
              <div className="num text-[17px] font-semibold text-amber-deep">
                {info.picks - info.pickedLines}
              </div>
              <div className="text-[11px] text-muted">今日待揀行</div>
            </div>
          </div>
          {info.alerts.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {info.alerts.map((a, i) => (
                <div key={i} className="flex items-start gap-2 rounded-[8px] bg-bad-soft/60 px-2.5 py-1.5 text-[12px] text-bad">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {a}
                </div>
              ))}
            </div>
          )}
          <table className="tbl mt-3 text-[12.5px]">
            <thead>
              <tr>
                <th>品項</th>
                <th className="r">在庫</th>
                <th className="r">今日需揀</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ p, s, picks }) => (
                <tr key={p.id}>
                  <td>
                    <div className="font-medium text-ink">{p.name}</div>
                    <div className="text-[11px] text-faint">
                      {p.sku}・架位 {p.shelf}
                    </div>
                  </td>
                  <td className="r num">
                    {s.onHand}
                    <span className="text-faint"> {p.baseUnit}</span>
                    {s.belowReorder && <div className="text-[10.5px] text-warn">低於補貨點</div>}
                  </td>
                  <td className="r num font-medium">{picks.reduce((a, l) => a + l.qtyBase, 0) || <span className="text-faint">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Link href="/dispatch?tab=zone" className="mt-3 block">
            <Button variant="outline" size="sm" className="w-full">
              開啟按凍庫揀貨單
            </Button>
          </Link>
        </div>
      ) : (
        <div className="p-4 text-[13px] text-ink-2">
          <div className="text-[15px] font-semibold">{sel === "office" ? "辦公室" : "理貨區"}</div>
          <p className="mt-2 text-muted">
            {sel === "office" ? "會計、業務作業區；月結對帳與 LINE 訂單審核在此完成。" : "冷凍品依凍庫 A→D 順序取出後，在理貨區依車次分區暫存，司機逐車核對裝車。"}
          </p>
          {sel !== "office" && (
            <div className="mt-3 grid grid-cols-2 gap-2 text-center">
              <div className="rounded-[10px] bg-sunk py-2">
                <div className="num text-[17px] font-semibold">
                  {pickSummary.done}/{pickSummary.total}
                </div>
                <div className="text-[11px] text-muted">已揀行數</div>
              </div>
              <div className="rounded-[10px] bg-sunk py-2">
                <div className="num text-[17px] font-semibold">{pickSummary.customers}</div>
                <div className="text-[11px] text-muted">今日配送客戶</div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
