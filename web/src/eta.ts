// Stop arrival computation for VozLinia.
//
// For each trip that calls at the selected stop and still has a vehicle
// upstream (at most 10 stops back):
//   1. live — TripUpdate time for this stop, if it still agrees with where
//      the vehicle actually is (a stale "already arrived" or a huge delay
//      is dropped),
//   2. live — trip-level delay on the scheduled time, same check,
//   3. procjena — metres along the stop sequence (not the GTFS shape, which
//      loops and needs the giant shapes file) divided by a speed blended
//      from the last GPS samples and the scheduled pace. A vehicle sitting
//      at a light no longer predicts a half-hour wait.
// The timetable alone is never shown.

import type { RouteId, ShapeId, TripUpdateInfo, Vehicle } from "./protocol.ts";

export interface StopTimeRow {
  stopId: string;
  seq: number;
  arrival: number | null; // seconds of day (Europe/Zagreb)
  departure: number | null;
}

export interface StopServiceTrip {
  tripId: string;
  routeId: RouteId;
  headsign: string | null;
  directionId: number | null;
  shapeId: ShapeId | null;
  times: StopTimeRow[];
}

export interface StopServices {
  stopId: string;
  name: string;
  lat: number;
  lon: number;
  services: StopServiceTrip[];
}

export interface StopDestination {
  name: string;
  tripIds: string[];
}

export interface StopLineDests {
  routeId: RouteId;
  destinations: StopDestination[];
}

/** Distinct destinations (headsigns) per line that calls at a stop, trams
 *  (short route ids) first, then buses. `tripIds` say which of those trips
 *  are on the road right now. */
export function stopDestinations(services: StopServices): StopLineDests[] {
  const byRoute = new Map<RouteId, Map<string, string[]>>();
  for (const svc of services.services) {
    if (!svc.headsign) continue;
    const byName = byRoute.get(svc.routeId) ?? new Map<string, string[]>();
    const trips = byName.get(svc.headsign) ?? [];
    trips.push(svc.tripId);
    byName.set(svc.headsign, trips);
    byRoute.set(svc.routeId, byName);
  }
  const lines = [...byRoute.entries()].map(([routeId, byName]) => ({
    routeId,
    destinations: [...byName.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], "hr"))
      .map(([name, tripIds]) => ({ name, tripIds })),
  }));
  lines.sort((a, b) =>
    (a.routeId.toString().length < 3) === (b.routeId.toString().length < 3)
      ? a.routeId - b.routeId
      : a.routeId.toString().length < 3 ? -1 : 1,
  );
  return lines;
}

/** Server payload uses compact rows [stopId, seq, arrivalSec, departureSec]. */
export function normalizeStopServices(raw: {
  stopId: string;
  name: string;
  lat: number;
  lon: number;
  services: {
    tripId: string;
    routeId: RouteId;
    headsign?: string | null;
    directionId?: number | null;
    shapeId?: ShapeId | null;
    times: (StopTimeRow | [string, number, number | null, number | null])[];
  }[];
}): StopServices {
  return {
    stopId: raw.stopId,
    name: raw.name,
    lat: raw.lat,
    lon: raw.lon,
    services: raw.services.map((s) => ({
      tripId: s.tripId,
      routeId: s.routeId,
      headsign: s.headsign ?? null,
      directionId: s.directionId ?? null,
      shapeId: s.shapeId ?? null,
      times: s.times.map((t) =>
        Array.isArray(t)
          ? { stopId: t[0], seq: t[1], arrival: t[2] ?? null, departure: t[3] ?? null }
          : t,
      ),
    })),
  };
}

export type ArrivalKind = "live" | "procjena" | "vozni red";

export interface StopDepartureRow {
  tripId: string;
  routeId: RouteId;
  headsign: string | null;
  kind: ArrivalKind;
  /** Estimated seconds until arrival; null for cleared timetable rows. */
  seconds: number | null;
  /** Scheduled clock time (Europe/Zagreb). */
  clock: string | null;
  /** Seconds late against the timetable. Negative means early. */
  late: number | null;
}

export interface RecentSample {
  ts: number; // epoch seconds
  lat: number;
  lon: number;
}

export interface StopDepartureInputs {
  services: StopServices;
  stopsById: Record<string, { lat: number; lon: number }>;
  vehicles: Vehicle[]; // newest realtime snapshot
  tripUpdates: TripUpdateInfo[] | undefined;
  shapesById: Record<string, { lats: number[]; lons: number[] }>;
  samplesByTrip: Record<string, RecentSample[]>;
  now: number; // snapshot feed timestamp (epoch seconds)
}

/** "sada" under a minute, otherwise rounded-up minutes ("3 min"). */
export function minutesText(seconds: number, nowWord = "sada"): string {
  if (!Number.isFinite(seconds) || seconds < 0) return nowWord;
  if (seconds < 60) return nowWord;
  return `${Math.ceil(seconds / 60)} min`;
}

/** Seconds of day in Europe/Zagreb for the given instant. */
export function zagrebSecondsOfDay(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Zagreb",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get("hour") * 3600 + get("minute") * 60 + get("second");
}

export function formatClock(secondsOfDay: number): string {
  const h = Math.floor(secondsOfDay / 3600) % 24;
  const m = Math.floor((secondsOfDay % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function haversineMeters(latA: number, lonA: number, latB: number, lonB: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dphi = rad(latB - latA);
  const dl = rad(lonB - lonA);
  const h =
    Math.sin(dphi / 2) ** 2 +
    Math.cos(rad(latA)) * Math.cos(rad(latB)) * Math.sin(dl / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Cumulative distance (m) of the projection of `point` onto `polyline`. */
export function projectCumulative(
  lat: number,
  lon: number,
  polyline: { lat: number; lon: number }[],
): { cum: number; total: number } {
  const pts = polyline;
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; ++i) {
    cum.push(cum[i - 1] + haversineMeters(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon));
  }
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i + 1 < pts.length; ++i) {
    const a = pts[i];
    const b = pts[i + 1];
    const ax = (b.lon - a.lon) * Math.cos((a.lat * Math.PI) / 180);
    const ay = b.lat - a.lat;
    const len2 = ax * ax + ay * ay;
    const px = (lon - a.lon) * Math.cos((a.lat * Math.PI) / 180);
    const py = lat - a.lat;
    let t = len2 === 0 ? 0 : (px * ax + py * ay) / len2;
    t = Math.max(0, Math.min(1, t));
    const dist = haversineMeters(
      lat, lon,
      a.lat + (b.lat - a.lat) * t,
      a.lon + (b.lon - a.lon) * t,
    );
    if (dist < bestDist) {
      bestDist = dist;
      best = cum[i] + t * (cum[i + 1] - cum[i]);
    }
  }
  return { cum: best, total: cum[cum.length - 1] };
}

const MAX_OFF_STOP_M = 280;
const MIN_SAMPLE_MOVE_M = 8;
const MIN_SPEED = 2.4;
const MAX_SPEED = 16;
/** Drop only broken feeds. A long suburban run is still shown. */
const MAX_ETA_SECONDS = 120 * 60;

function scheduledStopIndex(times: StopTimeRow[], nowSecs: number): number {
  let idx = 0;
  for (let i = 0; i < times.length; ++i) {
    const at = times[i].arrival ?? times[i].departure;
    if (at != null && at <= nowSecs + 45) idx = i;
  }
  return idx;
}

function segmentT(
  lat: number,
  lon: number,
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const ax = (b.lon - a.lon) * Math.cos((a.lat * Math.PI) / 180);
  const ay = b.lat - a.lat;
  const len2 = ax * ax + ay * ay;
  if (len2 === 0) return 0;
  const px = (lon - a.lon) * Math.cos((a.lat * Math.PI) / 180);
  const py = lat - a.lat;
  return Math.max(0, Math.min(1, (px * ax + py * ay) / len2));
}

function nearestStopIndex(
  lat: number,
  lon: number,
  times: StopTimeRow[],
  stopsById: Record<string, { lat: number; lon: number }>,
  from: number,
  to: number,
): { index: number; dist: number } | null {
  let bestI = -1;
  let bestDist = Infinity;
  for (let i = from; i <= to; ++i) {
    const stop = stopsById[times[i].stopId];
    if (!stop) continue;
    const dist = haversineMeters(lat, lon, stop.lat, stop.lon);
    if (dist < bestDist) {
      bestDist = dist;
      bestI = i;
    }
  }
  if (bestI < 0 || bestDist > MAX_OFF_STOP_M) return null;
  return { index: bestI, dist: bestDist };
}

/** Where the vehicle is along this trip. The timetable neighbourhood wins
 *  when the vehicle is near it, so a loop does not match the other end.
 *  Otherwise the closest stop on the whole trip is used. */
function routeProgressIndex(
  lat: number,
  lon: number,
  times: StopTimeRow[],
  stopsById: Record<string, { lat: number; lon: number }>,
  nowSecs: number,
): number | null {
  const anchor = scheduledStopIndex(times, nowSecs);
  const from = Math.max(0, anchor - 3);
  const to = Math.min(times.length - 1, anchor + 8);
  const hit = nearestStopIndex(lat, lon, times, stopsById, from, to)
    ?? nearestStopIndex(lat, lon, times, stopsById, 0, times.length - 1);
  if (!hit) return null;
  const bestI = hit.index;
  if (bestI + 1 < times.length) {
    const a = stopsById[times[bestI].stopId];
    const b = stopsById[times[bestI + 1].stopId];
    if (a && b) {
      const t = segmentT(lat, lon, a, b);
      const midLat = a.lat + (b.lat - a.lat) * t;
      const midLon = a.lon + (b.lon - a.lon) * t;
      if (t >= 0.5 && haversineMeters(lat, lon, midLat, midLon) <= MAX_OFF_STOP_M) {
        return bestI + 1;
      }
    }
  }
  return bestI;
}

function nearestUpstream(
  tripVehicles: Vehicle[],
  times: StopTimeRow[],
  stopsById: Record<string, { lat: number; lon: number }>,
  targetIdx: number,
  nowSecs: number,
): { vehicle: Vehicle; index: number; gap: number } | null {
  let best: { vehicle: Vehicle; index: number; gap: number } | null = null;
  for (const vehicle of tripVehicles) {
    const index = routeProgressIndex(
      vehicle.lat[vehicle.lat.length - 1],
      vehicle.lon[vehicle.lon.length - 1],
      times,
      stopsById,
      nowSecs,
    );
    if (index == null) continue;
    const gap = targetIdx - index;
    if (gap < 0) continue;
    if (best == null || gap < best.gap) best = { vehicle, index, gap };
  }
  return best;
}

function liveSecondsBelievable(seconds: number, gap: number): boolean {
  if (!Number.isFinite(seconds) || seconds > MAX_ETA_SECONDS) return false;
  if (seconds < -90) return false;
  if (seconds < -30 && gap >= 1) return false;
  return true;
}

type ShapeLine = { lats: number[]; lons: number[] };

function shapeLength(shape: ShapeLine): number[] {
  const cum = [0];
  for (let i = 1; i < shape.lats.length; ++i) {
    cum.push(cum[i - 1] + haversineMeters(
      shape.lats[i - 1], shape.lons[i - 1], shape.lats[i], shape.lons[i]));
  }
  return cum;
}

const shapeCumCache = new WeakMap<object, number[]>();
const shapeStopCache = new WeakMap<object, Map<string, number[] | null>>();

function cachedShapeCum(shape: ShapeLine): number[] {
  let cum = shapeCumCache.get(shape);
  if (!cum) {
    cum = shapeLength(shape);
    shapeCumCache.set(shape, cum);
  }
  return cum;
}

/** Cumulative metres of each trip stop along the GTFS shape, in order.
 *  Each stop is matched only forward of the previous one, so a loop does not
 *  snap to the other end. Null when the shape does not follow this stop list. */
function stopMetresOnShape(
  times: StopTimeRow[],
  stopsById: Record<string, { lat: number; lon: number }>,
  shape: ShapeLine,
): number[] | null {
  let byTrip = shapeStopCache.get(shape);
  if (!byTrip) {
    byTrip = new Map();
    shapeStopCache.set(shape, byTrip);
  }
  const key = times.map((row) => row.stopId).join("|");
  const cached = byTrip.get(key);
  if (cached !== undefined) return cached;

  const cum = cachedShapeCum(shape);
  const out: number[] = [];
  let from = 0;
  let ok = true;
  for (const row of times) {
    const stop = stopsById[row.stopId];
    if (!stop) { ok = false; break; }
    let best = from;
    let bestDist = Infinity;
    for (let i = from; i < shape.lats.length; ++i) {
      const dist = haversineMeters(stop.lat, stop.lon, shape.lats[i], shape.lons[i]);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
      if (bestDist < 45 && dist > bestDist + 300) break;
    }
    if (bestDist > 140) { ok = false; break; }
    out.push(cum[best]);
    from = best;
  }
  const value = ok && out.length === times.length ? out : null;
  byTrip.set(key, value);
  return value;
}

function shapeRemainingMeters(
  lat: number,
  lon: number,
  times: StopTimeRow[],
  stopsById: Record<string, { lat: number; lon: number }>,
  fromIdx: number,
  targetIdx: number,
  shape: ShapeLine | undefined,
): number | null {
  if (!shape || shape.lats.length < 2) return null;
  const stopCum = stopMetresOnShape(times, stopsById, shape);
  if (!stopCum) return null;
  const target = stopCum[targetIdx];
  if (fromIdx >= targetIdx) {
    const here = stopsById[times[targetIdx].stopId];
    return here ? haversineMeters(lat, lon, here.lat, here.lon) : 0;
  }
  const cum = cachedShapeCum(shape);
  const start = stopCum[fromIdx];
  const end = stopCum[Math.min(fromIdx + 1, stopCum.length - 1)];
  let best = start;
  let bestDist = Infinity;
  for (let i = 0; i < cum.length; ++i) {
    if (cum[i] < start - 40) continue;
    if (cum[i] > end + 40) break;
    const dist = haversineMeters(lat, lon, shape.lats[i], shape.lons[i]);
    if (dist < bestDist) {
      bestDist = dist;
      best = cum[i];
    }
  }
  const travelled = bestDist <= MAX_OFF_STOP_M ? best : start;
  return Math.max(0, target - travelled);
}

function alongStopsMeters(
  times: StopTimeRow[],
  stopsById: Record<string, { lat: number; lon: number }>,
  fromIdx: number,
  toIdx: number,
  shape?: ShapeLine,
): number {
  if (shape) {
    const stopCum = stopMetresOnShape(times, stopsById, shape);
    if (stopCum && toIdx > fromIdx) return Math.max(0, stopCum[toIdx] - stopCum[fromIdx]);
  }
  let meters = 0;
  for (let i = fromIdx; i < toIdx; ++i) {
    const a = stopsById[times[i].stopId];
    const b = stopsById[times[i + 1].stopId];
    if (a && b) meters += haversineMeters(a.lat, a.lon, b.lat, b.lon);
  }
  return meters;
}

function remainingMeters(
  lat: number,
  lon: number,
  times: StopTimeRow[],
  stopsById: Record<string, { lat: number; lon: number }>,
  fromIdx: number,
  targetIdx: number,
  shape?: ShapeLine,
): number {
  const along = shapeRemainingMeters(lat, lon, times, stopsById, fromIdx, targetIdx, shape);
  if (along != null) return along;
  const target = stopsById[times[targetIdx].stopId];
  if (fromIdx >= targetIdx) {
    return target ? haversineMeters(lat, lon, target.lat, target.lon) : Infinity;
  }
  const next = stopsById[times[fromIdx + 1].stopId];
  let meters = next
    ? haversineMeters(lat, lon, next.lat, next.lon)
    : (target ? haversineMeters(lat, lon, target.lat, target.lon) : Infinity);
  meters += alongStopsMeters(times, stopsById, fromIdx + 1, targetIdx);
  return meters;
}

function chooseSpeed(
  samples: RecentSample[] | undefined,
  times: StopTimeRow[],
  stopsById: Record<string, { lat: number; lon: number }>,
  fromIdx: number,
  targetIdx: number,
  now: number,
  routeId: RouteId,
  gap: number,
  shape?: ShapeLine,
): number {
  let observed: number | null = null;
  if (samples && samples.length >= 2) {
    const recent = samples.filter((s) => now - s.ts <= 90);
    const span = recent.length >= 2 ? recent : samples.slice(-2);
    const s0 = span[0];
    const s1 = span[span.length - 1];
    const dt = s1.ts - s0.ts;
    if (now - s1.ts <= 90 && dt >= 1) {
      const moved = haversineMeters(s0.lat, s0.lon, s1.lat, s1.lon);
      const speed = moved / dt;
      if (moved >= MIN_SAMPLE_MOVE_M && speed >= 0.8 && speed <= 25) observed = speed;
    }
  }
  const fromAt = times[fromIdx].arrival ?? times[fromIdx].departure;
  const toAt = times[targetIdx].arrival ?? times[targetIdx].departure;
  let pace: number | null = null;
  if (fromAt != null && toAt != null && toAt - fromAt >= 30) {
    const meters = alongStopsMeters(times, stopsById, fromIdx, targetIdx, shape);
    const candidate = meters / (toAt - fromAt);
    if (candidate >= 1.5 && candidate <= 18) pace = candidate;
  }
  const fallback = routeId.toString().length < 3 ? 5.0 : 6.2;
  let speed = observed ?? pace ?? fallback;
  if (observed != null && pace != null) {
    const gps = gap <= 2 ? 0.75 : gap >= 8 ? 0.3 : 0.5;
    speed = observed * gps + pace * (1 - gps);
  }
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed));
}

export function computeStopDepartures(inputs: StopDepartureInputs): StopDepartureRow[] {
  const {
    services, stopsById, vehicles, tripUpdates, shapesById, samplesByTrip, now,
  } = inputs;
  const targetStopId = services.stopId;
  const nowSecsOfDay = zagrebSecondsOfDay(new Date(now * 1000));
  const tripUpdateByTrip = new Map<string, TripUpdateInfo>();
  for (const update of tripUpdates ?? []) tripUpdateByTrip.set(update.tripId, update);

  const vehiclesByTrip = new Map<string, Vehicle[]>();
  for (const vehicle of vehicles) {
    if (!vehicle.tripId) continue;
    const list = vehiclesByTrip.get(vehicle.tripId);
    if (list) list.push(vehicle);
    else vehiclesByTrip.set(vehicle.tripId, [vehicle]);
  }

  const rows: StopDepartureRow[] = [];

  for (const service of services.services) {
    const times = service.times;
    const targetIdx = times.findIndex((row) => row.stopId === targetStopId);
    if (targetIdx < 0) continue;
    const scheduledAtStop = times[targetIdx].arrival;
    const clock = scheduledAtStop != null ? formatClock(scheduledAtStop) : null;
    const shape = service.shapeId ? shapesById[service.shapeId] : undefined;

    const tripVehicles = vehiclesByTrip.get(service.tripId) ?? [];
    const place = nearestUpstream(tripVehicles, times, stopsById, targetIdx, nowSecsOfDay);
    const tu = tripUpdateByTrip.get(service.tripId);
    const stu = tu?.stopTimeUpdates.find((s) => s.stopId === targetStopId);

    let liveEmitted = false;

    const lateness = (seconds: number): number | null => {
      if (scheduledAtStop == null) return null;
      const scheduledEpoch = now - nowSecsOfDay + scheduledAtStop;
      return Math.round(now + Math.max(0, seconds) - scheduledEpoch);
    };

    const pushLive = (seconds: number) => {
      if (!place || !liveSecondsBelievable(seconds, place.gap)) return false;
      rows.push({
        tripId: service.tripId,
        routeId: service.routeId,
        headsign: service.headsign,
        kind: "live",
        seconds: Math.max(0, seconds),
        clock,
        late: lateness(seconds),
      });
      return true;
    };

    if (stu) {
      let arrivalEpoch: number | null | undefined = stu.arrivalTime;
      if (arrivalEpoch == null && scheduledAtStop != null) {
        arrivalEpoch = now - nowSecsOfDay + scheduledAtStop + (stu.arrivalDelay ?? 0);
      }
      if (typeof arrivalEpoch === "number") {
        liveEmitted = pushLive(arrivalEpoch - now);
      }
    }

    if (!liveEmitted && tu && tu.delay != null && scheduledAtStop != null) {
      const arrivalEpoch = now - nowSecsOfDay + scheduledAtStop + tu.delay;
      liveEmitted = pushLive(arrivalEpoch - now);
    }

    if (!liveEmitted && place) {
      const lat = place.vehicle.lat[place.vehicle.lat.length - 1];
      const lon = place.vehicle.lon[place.vehicle.lon.length - 1];
      const remaining = remainingMeters(
        lat, lon, times, stopsById, place.index, targetIdx, shape);
      const speed = chooseSpeed(
        samplesByTrip[service.tripId],
        times,
        stopsById,
        place.index,
        targetIdx,
        now,
        service.routeId,
        place.gap,
        shape,
      );
      if (Number.isFinite(remaining) && speed > 0) {
        const seconds = remaining / speed;
        if (seconds <= MAX_ETA_SECONDS) {
          rows.push({
            tripId: service.tripId,
            routeId: service.routeId,
            headsign: service.headsign,
            kind: "procjena",
            seconds: Math.max(0, seconds),
            clock,
            late: lateness(seconds),
          });
        }
      }
    }
  }

  return rows;
}

