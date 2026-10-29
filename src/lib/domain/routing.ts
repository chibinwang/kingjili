import { hhmm, minutesOf } from "../time";
import { orderVolumeL, orderWeightKg } from "./orders";
import type { Customer, GeoPoint, Product, RouteStop, SalesOrder, Vehicle, VehicleId } from "./types";

/**
 * Illustrative routing over real coordinates. Distances are great-circle × road factor,
 * NOT a routing engine or live traffic. Used only to compare before/after assignments.
 */
export const ROUTING = {
  /** 金吉利冷凍倉 — placeholder near the 南區／大里 border until the real address is confirmed. */
  depot: { lat: 24.0905, lng: 120.6795 } as GeoPoint,
  roadFactor: 1.35,
  speedKmh: 28,
  serviceMin: 12,
  loadMin: 0,
  returnBy: "14:00",
  dieselLPerKm: 0.13,
};

export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  return haversineKm(a, b) * ROUTING.roadFactor;
}

/** Straight-line (great-circle) distance in km. */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export interface StopEta {
  customerId: string;
  orderId: string;
  deliveryId: string;
  sequence: number;
  arriveMin: number;
  startMin: number;
  departMin: number;
  windowStart: number;
  windowEnd: number;
  late: boolean;
  legKm: number;
}

export interface RouteMetrics {
  vehicleId: VehicleId;
  stops: StopEta[];
  distanceKm: number;
  driveMin: number;
  shiftMin: number;
  returnMin: number;
  loadKg: number;
  loadL: number;
}

export interface RoutingContext {
  customers: Map<string, Customer>;
  orders: Map<string, SalesOrder>;
  products: Map<string, Product>;
  vehicles: Map<VehicleId, Vehicle>;
}

export function computeRoute(vehicleId: VehicleId, stops: RouteStop[], ctx: RoutingContext): RouteMetrics {
  const vehicle = ctx.vehicles.get(vehicleId)!;
  const ordered = stops.filter((s) => s.vehicleId === vehicleId).sort((a, b) => a.sequence - b.sequence);
  let clock = minutesOf(vehicle.departAt) + ROUTING.loadMin;
  let pos = ROUTING.depot;
  let km = 0;
  let loadKg = 0;
  let loadL = 0;
  const etas: StopEta[] = [];
  ordered.forEach((s, i) => {
    const c = ctx.customers.get(s.customerId)!;
    const o = ctx.orders.get(s.orderId)!;
    loadKg += orderWeightKg(o, ctx.products);
    loadL += orderVolumeL(o, ctx.products);
    const leg = distanceKm(pos, c.geo);
    km += leg;
    const arrive = clock + (leg / ROUTING.speedKmh) * 60;
    const ws = minutesOf(c.window.start);
    const we = minutesOf(c.window.end);
    const start = Math.max(arrive, ws);
    const depart = start + ROUTING.serviceMin;
    etas.push({
      customerId: c.id,
      orderId: o.id,
      deliveryId: s.deliveryId,
      sequence: i + 1,
      arriveMin: arrive,
      startMin: start,
      departMin: depart,
      windowStart: ws,
      windowEnd: we,
      late: start > we,
      legKm: leg,
    });
    clock = depart;
    pos = c.geo;
  });
  const back = distanceKm(pos, ROUTING.depot);
  km += ordered.length ? back : 0;
  const returnMin = ordered.length ? clock + (back / ROUTING.speedKmh) * 60 : minutesOf(vehicle.departAt);
  return {
    vehicleId,
    stops: etas,
    distanceKm: km,
    driveMin: (km / ROUTING.speedKmh) * 60,
    shiftMin: returnMin - minutesOf(vehicle.departAt),
    returnMin,
    loadKg,
    loadL,
  };
}

export interface ConstraintResult {
  id: "capacity_kg" | "capacity_l" | "time_window" | "frozen" | "shift" | "return";
  label: string;
  pass: boolean;
  detail: string;
}

export function checkConstraints(metrics: RouteMetrics, ctx: RoutingContext): ConstraintResult[] {
  const v = ctx.vehicles.get(metrics.vehicleId)!;
  const late = metrics.stops.filter((s) => s.late);
  const frozenIssues = metrics.stops.flatMap((s) =>
    ctx.orders
      .get(s.orderId)!
      .lines.map((l) => ctx.products.get(l.productId)!)
      .filter((p) => !v.frozen || p.tempC < -25),
  );
  return [
    {
      id: "capacity_kg",
      label: "載重",
      pass: metrics.loadKg <= v.capacityKg,
      detail: `${Math.round(metrics.loadKg)} / ${v.capacityKg} kg`,
    },
    {
      id: "capacity_l",
      label: "容積",
      pass: metrics.loadL <= v.capacityL,
      detail: `${Math.round(metrics.loadL)} / ${v.capacityL} L`,
    },
    {
      id: "time_window",
      label: "客戶收貨時段",
      pass: late.length === 0,
      detail: late.length ? `${late.length} 站超出時段` : `${metrics.stops.length} 站皆在時段內`,
    },
    {
      id: "frozen",
      label: "冷凍溫層相容",
      pass: frozenIssues.length === 0,
      detail: frozenIssues.length ? `${frozenIssues.length} 品項溫層不符` : "全車 −18°C 以下",
    },
    {
      id: "shift",
      label: "司機工時",
      pass: metrics.shiftMin <= v.maxShiftMin,
      detail: `${Math.round(metrics.shiftMin / 6) / 10} / ${v.maxShiftMin / 60} 小時`,
    },
    {
      id: "return",
      label: "回倉時間",
      pass: metrics.returnMin <= minutesOf(ROUTING.returnBy),
      detail: `預估 ${hhmm(metrics.returnMin)} 回倉（需 ${ROUTING.returnBy} 前）`,
    },
  ];
}

function resequence(stops: RouteStop[]): RouteStop[] {
  const out: RouteStop[] = [];
  for (const v of ["A", "B"] as VehicleId[]) {
    stops
      .filter((s) => s.vehicleId === v)
      .sort((a, b) => a.sequence - b.sequence)
      .forEach((s, i) => out.push({ ...s, sequence: i + 1 }));
  }
  return out;
}

/** Move one stop to another vehicle at a given position (1-based), returning a new resequenced plan. */
export function moveStop(stops: RouteStop[], deliveryId: string, to: VehicleId, position: number): RouteStop[] {
  const moving = stops.find((s) => s.deliveryId === deliveryId)!;
  const rest = stops.filter((s) => s.deliveryId !== deliveryId);
  const target = rest.filter((s) => s.vehicleId === to).sort((a, b) => a.sequence - b.sequence);
  target.splice(position - 1, 0, { ...moving, vehicleId: to });
  const others = rest.filter((s) => s.vehicleId !== to);
  return resequence([...others, ...target.map((s, i) => ({ ...s, sequence: i + 1 }))]);
}

export interface PlanEvaluation {
  routes: Record<VehicleId, RouteMetrics>;
  constraints: Record<VehicleId, ConstraintResult[]>;
  totalKm: number;
  totalShiftMin: number;
  feasible: boolean;
}

export function evaluatePlan(stops: RouteStop[], ctx: RoutingContext): PlanEvaluation {
  const A = computeRoute("A", stops, ctx);
  const B = computeRoute("B", stops, ctx);
  const cA = checkConstraints(A, ctx);
  const cB = checkConstraints(B, ctx);
  return {
    routes: { A, B },
    constraints: { A: cA, B: cB },
    totalKm: A.distanceKm + B.distanceKm,
    totalShiftMin: A.shiftMin + B.shiftMin,
    feasible: [...cA, ...cB].every((c) => c.pass),
  };
}

export interface RouteSuggestion {
  deliveryId: string;
  customerId: string;
  from: VehicleId;
  to: VehicleId;
  position: number;
  before: PlanEvaluation;
  after: PlanEvaluation;
  stops: RouteStop[];
  savedKm: number;
  savedMin: number;
  nearestNeighbor?: { customerId: string; km: number };
}

/**
 * Single-stop reassignment search: try moving each stop to the other vehicle at every position,
 * keep only candidates where all hard constraints pass, pick the largest distance saving.
 */
export function suggestReassignment(stops: RouteStop[], ctx: RoutingContext, minSavingKm = 1): RouteSuggestion | null {
  const before = evaluatePlan(stops, ctx);
  let best: RouteSuggestion | null = null;
  for (const s of stops) {
    const to: VehicleId = s.vehicleId === "A" ? "B" : "A";
    const targetCount = stops.filter((x) => x.vehicleId === to).length;
    for (let pos = 1; pos <= targetCount + 1; pos++) {
      const candidate = moveStop(stops, s.deliveryId, to, pos);
      const after = evaluatePlan(candidate, ctx);
      if (!after.feasible) continue;
      const savedKm = before.totalKm - after.totalKm;
      if (savedKm < minSavingKm) continue;
      if (!best || savedKm > best.savedKm) {
        best = {
          deliveryId: s.deliveryId,
          customerId: s.customerId,
          from: s.vehicleId,
          to,
          position: pos,
          before,
          after,
          stops: candidate,
          savedKm,
          savedMin: before.totalShiftMin - after.totalShiftMin,
        };
      }
    }
  }
  if (best) {
    const me = ctx.customers.get(best.customerId)!;
    const neighbors = stops
      .filter((x) => x.vehicleId === best!.to)
      .map((x) => ({ customerId: x.customerId, km: distanceKm(me.geo, ctx.customers.get(x.customerId)!.geo) }))
      .sort((a, b) => a.km - b.km);
    best.nearestNeighbor = neighbors[0];
  }
  return best;
}

export interface InsertionOption {
  vehicleId: VehicleId;
  stops: RouteStop[];
  /** This vehicle's own hard constraints after the insertion. */
  feasible: boolean;
  failed: string[];
  addedKm: number;
  addedMin: number;
}

/** Cheapest position for one new stop on a given vehicle; judged on that vehicle's constraints only. */
export function bestInsertion(stops: RouteStop[], stop: Omit<RouteStop, "vehicleId" | "sequence">, vehicleId: VehicleId, ctx: RoutingContext): InsertionOption {
  const before = computeRoute(vehicleId, stops, ctx);
  const own = stops.filter((s) => s.vehicleId === vehicleId).sort((a, b) => a.sequence - b.sequence);
  const rest = stops.filter((s) => s.vehicleId !== vehicleId);
  let best: InsertionOption | null = null;
  for (let pos = 0; pos <= own.length; pos++) {
    const seq = [...own.slice(0, pos), { ...stop, vehicleId, sequence: 0 }, ...own.slice(pos)].map((s, i) => ({ ...s, sequence: i + 1 }));
    const next = [...rest, ...seq];
    const m = computeRoute(vehicleId, next, ctx);
    const failed = checkConstraints(m, ctx).filter((c) => !c.pass).map((c) => c.label);
    const cand = { vehicleId, stops: next, feasible: failed.length === 0, failed, addedKm: m.distanceKm - before.distanceKm, addedMin: m.shiftMin - before.shiftMin };
    if (!best || (cand.feasible && !best.feasible) || (cand.feasible === best.feasible && cand.addedKm < best.addedKm)) best = cand;
  }
  return best!;
}
