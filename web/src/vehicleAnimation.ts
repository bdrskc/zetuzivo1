// Client-side vehicle motion for ZET uživo.
//
// GTFS-RT arrives about every 10 s. When a new fix arrives, the marker leaves
// its current on-screen position and travels toward that fix over the next
// update interval (the gap just observed, clamped).
//
// Trams and buses are pulled onto their GTFS shape. A forward window keeps a
// loop from flipping the vehicle onto the track coming back. Motion along a
// fix is nearly steady, with only a slight ease, so the marker does not stop
// at every GPS point. If the next fix is late it coasts, then settles.

import type { RouteId, Vehicle } from "./protocol";

type Point = [number, number];

const HISTORY_POINTS = 5;
const TELEPORT_M = 800;
const STALE_SECONDS = 45;
const MIN_DURATION_S = 4;
const MAX_DURATION_S = 14;
const BEARING_MIN_M = 8;
/** After the marker reaches a fix it keeps gliding, then eases to a stop. */
const COAST_S = 3.5;
const COAST_MAX_M = 22;
/** GPS farther than this from every point of the shape is left alone. */
const MAX_SNAP_M = 90;
/** Within this distance, stay on the forward part of the route (loops). */
const LOCAL_STICK_M = 32;
const BACK_M = 35;

const REDUCED_MOTION =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function triKey(vehicle: { vehicleId: string | null; tripId: string | null }): string {
  return `${vehicle.vehicleId ?? ""}:${vehicle.tripId ?? ""}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function haversineMeters(a: Point, b: Point): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const phi1 = toRad(a[0]);
  const phi2 = toRad(b[0]);
  const dphi = phi2 - phi1;
  const dl = toRad(b[1] - a[1]);
  const h = Math.sin(dphi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dl / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Compass bearing (0 = north, 90 = east) of the vector a -> b. */
function bearingBetween(a: Point, b: Point): number {
  const dx = (b[1] - a[1]) * Math.cos((a[0] * Math.PI) / 180);
  const dy = b[0] - a[0];
  const deg = (Math.atan2(dx, dy) * 180) / Math.PI;
  return (deg + 360) % 360;
}

export interface ShapeTrack {
  lats: number[];
  lons: number[];
  cum: number[];
}

export function buildShapeTrack(lats: number[], lons: number[]): ShapeTrack {
  const cum = new Array<number>(lats.length);
  cum[0] = 0;
  for (let i = 1; i < lats.length; i++) {
    cum[i] = cum[i - 1] + haversineMeters([lats[i - 1], lons[i - 1]], [lats[i], lons[i]]);
  }
  return { lats, lons, cum };
}

interface SnapHit {
  lat: number;
  lon: number;
  arc: number;
  dist: number;
}

function nearestOnTrack(
  track: ShapeTrack,
  lat: number,
  lon: number,
  arcMin: number,
  arcMax: number,
): SnapHit | null {
  const { lats, lons, cum } = track;
  const n = lats.length;
  if (n < 2) return null;
  const mx = 111320 * Math.cos((lat * Math.PI) / 180);
  const my = 110540;
  let best: SnapHit | null = null;
  for (let i = 0; i < n - 1; i++) {
    const c0 = cum[i];
    const c1 = cum[i + 1];
    if (c1 < arcMin || c0 > arcMax) continue;
    const bx = (lons[i + 1] - lons[i]) * mx;
    const by = (lats[i + 1] - lats[i]) * my;
    const px = (lon - lons[i]) * mx;
    const py = (lat - lats[i]) * my;
    const len2 = bx * bx + by * by;
    let t = len2 > 1e-4 ? (px * bx + py * by) / len2 : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const arc = c0 + (c1 - c0) * t;
    if (arc < arcMin || arc > arcMax) continue;
    const dist = Math.hypot(px - bx * t, py - by * t);
    if (!best || dist < best.dist) {
      best = {
        lat: lats[i] + (lats[i + 1] - lats[i]) * t,
        lon: lons[i] + (lons[i + 1] - lons[i]) * t,
        arc,
        dist,
      };
    }
  }
  return best;
}

/** Nearest point on the route. Stays on the forward leg when a loop's other
 *  track is closer in a straight line. Null when the shape is too far. */
export function snapToShape(
  track: ShapeTrack,
  lat: number,
  lon: number,
  prevArc: number | null,
  movedM: number,
): SnapHit | null {
  const end = track.cum[track.cum.length - 1] ?? 0;
  const global = nearestOnTrack(track, lat, lon, 0, end + 1);
  if (!global || global.dist > MAX_SNAP_M) return null;
  if (prevArc == null) return global;
  const ahead = Math.max(180, movedM * 2 + 50);
  const local = nearestOnTrack(
    track, lat, lon,
    Math.max(0, prevArc - BACK_M),
    Math.min(end + 1, prevArc + ahead),
  );
  if (!local) return global;
  if (local.dist <= LOCAL_STICK_M) return local;
  if (global.dist + 15 < local.dist && Math.abs(global.arc - prevArc) <= ahead) return global;
  return local.dist <= MAX_SNAP_M ? local : global;
}

function pointAlong(track: ShapeTrack, arc: number): { lat: number; lon: number } {
  const { lats, lons, cum } = track;
  const last = cum.length - 1;
  if (last <= 0) return { lat: lats[0] ?? 0, lon: lons[0] ?? 0 };
  const clamped = clamp(arc, 0, cum[last]);
  let lo = 0;
  let hi = last;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= clamped) lo = mid;
    else hi = mid;
  }
  const span = cum[lo + 1] - cum[lo];
  const t = span > 0 ? (clamped - cum[lo]) / span : 0;
  return {
    lat: lats[lo] + (lats[lo + 1] - lats[lo]) * t,
    lon: lons[lo] + (lons[lo + 1] - lons[lo]) * t,
  };
}

interface SegmentFrame {
  key: string;
  vehicleId: string | null;
  tripId: string | null;
  blockId: string | null;
  routeId: RouteId;
  shapeId: string | null;
  reportDelay: number | null;
  hasInvalidTimestamp: boolean;
  timestamp: number;
  fromLat: number;
  fromLon: number;
  toLat: number;
  toLon: number;
  t0: number;
  t1: number;
  arrivedAt: number;
  bearing: number | null;
  fromBearing: number | null;
  history: Point[];
  shapeSnap: boolean;
  fromArc: number;
  toArc: number;
  speed: number;
  allowCoast: boolean;
}

function segmentU(frame: { t0: number; t1: number }, now: number): number {
  const span = frame.t1 - frame.t0;
  const raw = span > 0 ? clamp((now - frame.t0) / span, 0, 1) : 1;
  const eased = raw * raw * (3 - 2 * raw);
  // Mostly steady speed. A little ease keeps the handoff from jerking,
  // without stopping dead at each GPS point.
  return raw * 0.85 + eased * 0.15;
}

function coastDistance(speed: number, allowCoast: boolean, t1: number, now: number): number {
  if (!allowCoast || speed < 0.6) return 0;
  const overtime = now - t1;
  if (overtime <= 0) return 0;
  const t = Math.min(overtime, COAST_S);
  return Math.min(COAST_MAX_M, speed * t * (1 - t / (2 * COAST_S)));
}

function lerpAngle(a: number | null, b: number | null, u: number): number | null {
  if (b == null) return a;
  if (a == null) return b;
  const delta = ((b - a + 540) % 360) - 180;
  return (a + delta * u + 360) % 360;
}

function pose(frame: SegmentFrame, now: number): Point {
  const u = segmentU(frame, now);
  let lat = frame.fromLat + (frame.toLat - frame.fromLat) * u;
  let lon = frame.fromLon + (frame.toLon - frame.fromLon) * u;
  const extra = coastDistance(frame.speed, frame.allowCoast && !frame.shapeSnap, frame.t1, now);
  if (extra > 0 && frame.bearing != null) {
    const rad = (frame.bearing * Math.PI) / 180;
    const mLon = 111320 * Math.cos((lat * Math.PI) / 180);
    lat += (extra * Math.cos(rad)) / 110540;
    lon += (extra * Math.sin(rad)) / mLon;
  }
  return [lat, lon];
}

function arcAt(frame: SegmentFrame, now: number): number {
  const u = segmentU(frame, now);
  const base = frame.fromArc + (frame.toArc - frame.fromArc) * u;
  const extra = coastDistance(frame.speed, frame.allowCoast && frame.shapeSnap, frame.t1, now);
  if (extra <= 0) return base;
  const sign = frame.toArc >= frame.fromArc ? 1 : -1;
  return base + sign * extra;
}

export class VehicleAnimator {
  private frames = new Map<string, SegmentFrame>();
  private order: string[] = [];
  private tracks = new Map<string, ShapeTrack>();

  /** GTFS polylines, keyed by shape id. Vehicles snap on the next sample. */
  setShapes(shapes: Record<string, { lats: number[]; lons: number[] }>): void {
    this.tracks.clear();
    for (const [id, shape] of Object.entries(shapes)) {
      if (shape.lats.length >= 2 && shape.lats.length === shape.lons.length) {
        this.tracks.set(id, buildShapeTrack(shape.lats, shape.lons));
      }
    }
    for (const frame of this.frames.values()) {
      const track = this.trackFor(frame.routeId, frame.shapeId);
      if (!track) {
        frame.shapeSnap = false;
        continue;
      }
      const dest = snapToShape(track, frame.toLat, frame.toLon, null, 0);
      if (!dest) {
        frame.shapeSnap = false;
        continue;
      }
      const origin = snapToShape(track, frame.fromLat, frame.fromLon, dest.arc, 0) ?? dest;
      frame.shapeSnap = true;
      frame.fromArc = origin.arc;
      frame.toArc = dest.arc;
      frame.fromLat = origin.lat;
      frame.fromLon = origin.lon;
      frame.toLat = dest.lat;
      frame.toLon = dest.lon;
      if (Math.abs(dest.arc - origin.arc) >= BEARING_MIN_M) {
        frame.bearing = this.routeBearing(track, origin.arc);
      } else {
        frame.bearing = this.routeBearing(track, dest.arc);
      }
    }
  }

  private trackFor(_routeId: RouteId, shapeId: string | null): ShapeTrack | undefined {
    if (!shapeId) return undefined;
    return this.tracks.get(shapeId);
  }

  /** Heading along the route as it was recorded. The nose never turns around
   *  because a GPS fix landed a few metres behind. */
  private routeBearing(track: ShapeTrack, arc: number): number {
    return this.bearingOnTrack(track, arc, 1);
  }

  private bearingOnTrack(track: ShapeTrack, arc: number, dir: 1 | -1): number {
    const span = 32;
    const back = pointAlong(track, arc - dir * span);
    const fore = pointAlong(track, arc + dir * span);
    if (haversineMeters([back.lat, back.lon], [fore.lat, fore.lon]) >= 6) {
      return bearingBetween([back.lat, back.lon], [fore.lat, fore.lon]);
    }
    const here = pointAlong(track, arc);
    const step = pointAlong(track, arc + dir * 12);
    if (haversineMeters([here.lat, here.lon], [step.lat, step.lon]) >= 2) {
      return bearingBetween([here.lat, here.lon], [step.lat, step.lon]);
    }
    return dir === 1 ? 0 : 180;
  }

  /** Record a new realtime snapshot. Animation runs AFTER this call, toward
   *  the new positions, starting from wherever each marker is on screen. */
  update(vehicles: Vehicle[], feedTimestamp: number): void {
    const now = Date.now() / 1000;
    const seen = new Set<string>();
    for (const vehicle of vehicles) {
      const key = triKey(vehicle);
      seen.add(key);
      const lat = vehicle.lat[vehicle.lat.length - 1];
      const lon = vehicle.lon[vehicle.lon.length - 1];
      const prev = this.frames.get(key);
      const sameShape = prev != null && prev.shapeId === vehicle.shapeId;

      let fromLat = lat;
      let fromLon = lon;
      let duration = 0;
      let bearing = prev?.bearing ?? null;
      let history: Point[] = [];

      if (prev && !REDUCED_MOTION) {
        const gap = now - prev.arrivedAt;
        const targetDist = haversineMeters([prev.toLat, prev.toLon], [lat, lon]);
        const snap = gap > STALE_SECONDS || targetDist >= TELEPORT_M;
        if (!snap) {
          const prevTrack = sameShape ? this.trackFor(prev.routeId, prev.shapeId) : undefined;
          if (prev.shapeSnap && prevTrack) {
            const onRoute = pointAlong(prevTrack, arcAt(prev, now));
            fromLat = onRoute.lat;
            fromLon = onRoute.lon;
          } else {
            const current = pose(prev, now);
            fromLat = current[0];
            fromLon = current[1];
          }
          duration = clamp(gap, MIN_DURATION_S, MAX_DURATION_S);
          const leg = haversineMeters([fromLat, fromLon], [lat, lon]);
          if (leg >= BEARING_MIN_M) bearing = bearingBetween([fromLat, fromLon], [lat, lon]);
          history = [...prev.history, [prev.toLat, prev.toLon]];
          while (history.length > HISTORY_POINTS) history.shift();
        }
      }

      let toLat = lat;
      let toLon = lon;
      let shapeSnap = false;
      let fromArc = 0;
      let toArc = 0;
      const track = this.trackFor(vehicle.routeId, vehicle.shapeId);
      if (track) {
        const prevArc = prev?.shapeSnap && sameShape ? arcAt(prev, now) : null;
        const moved = haversineMeters([fromLat, fromLon], [lat, lon]);
        const dest = snapToShape(track, lat, lon, prevArc, moved);
        if (dest) {
          const origin = snapToShape(track, fromLat, fromLon, prevArc, 0) ?? dest;
          shapeSnap = true;
          fromArc = origin.arc;
          toArc = dest.arc;
          fromLat = origin.lat;
          fromLon = origin.lon;
          toLat = dest.lat;
          toLon = dest.lon;
          if (toArc < fromArc) {
            if (fromArc - toArc <= 80) {
              // Still on this route. A fix behind us is noise, not a U-turn.
              toArc = fromArc;
              toLat = fromLat;
              toLon = fromLon;
              duration = 0;
            } else {
              fromArc = toArc;
              fromLat = toLat;
              fromLon = toLon;
              duration = 0;
            }
          }
          bearing = this.routeBearing(track, toArc);
        }
      }

      this.frames.set(key, {
        key,
        vehicleId: vehicle.vehicleId,
        tripId: vehicle.tripId,
        blockId: vehicle.blockId,
        routeId: vehicle.routeId,
        shapeId: vehicle.shapeId,
        reportDelay: vehicle.reportDelay,
        hasInvalidTimestamp: vehicle.hasInvalidTimestamp,
        timestamp: feedTimestamp,
        fromLat,
        fromLon,
        toLat,
        toLon,
        t0: now,
        t1: now + duration,
        arrivedAt: now,
        bearing,
        fromBearing: prev?.bearing ?? bearing,
        history,
        shapeSnap,
        fromArc,
        toArc,
        speed: duration > 0 ? Math.abs(shapeSnap ? toArc - fromArc : haversineMeters([fromLat, fromLon], [toLat, toLon])) / duration : 0,
        allowCoast: duration >= MIN_DURATION_S && !REDUCED_MOTION,
      });
    }
    for (const key of [...this.frames.keys()]) {
      if (!seen.has(key)) this.frames.delete(key);
    }
    this.order = vehicles.map((v) => triKey(v));
  }

  /** Positions at wall-clock `now` (seconds), in feed order. */
  sample(now: number): Vehicle[] {
    const out: Vehicle[] = [];
    for (const key of this.order) {
      const frame = this.frames.get(key);
      if (!frame) continue;
      let lat: number;
      let lon: number;
      let bearing = frame.bearing;
      const track = frame.shapeSnap ? this.trackFor(frame.routeId, frame.shapeId) : undefined;
      if (track) {
        const arc = arcAt(frame, now);
        const p = pointAlong(track, arc);
        lat = p.lat;
        lon = p.lon;
        bearing = this.routeBearing(track, arc);
      } else {
        [lat, lon] = pose(frame, now);
        const turn = clamp((now - frame.t0) / 1.2, 0, 1);
        bearing = lerpAngle(frame.fromBearing, frame.bearing, turn);
      }
      out.push({
        vehicleId: frame.vehicleId,
        tripId: frame.tripId,
        blockId: frame.blockId,
        routeId: frame.routeId,
        shapeId: frame.shapeId,
        timestamp: frame.timestamp,
        hasInvalidTimestamp: frame.hasInvalidTimestamp,
        reportDelay: frame.reportDelay,
        directionDegrees: bearing,
        lat: [...frame.history.map((p) => p[0]), lat],
        lon: [...frame.history.map((p) => p[1]), lon],
      });
    }
    return out;
  }

  clear(): void {
    this.frames.clear();
    this.order = [];
  }
}
