// VozLinia realtime protocol types and decompression.
// New code reproducing the observable upstream format (see docs/PROTOCOL.md).

export type ShapeId = string;
export type RouteId = number;

export interface Vehicle {
  vehicleId: string | null;
  tripId: string | null;
  blockId: string | null;
  routeId: RouteId;
  shapeId: ShapeId | null;
  lat: number[];
  lon: number[];
  timestamp: number;
  hasInvalidTimestamp: boolean;
  reportDelay: number | null;
  directionDegrees: number | null;
}

export interface StopTimeUpdate {
  stopId: string;
  seq?: number | null;
  arrivalTime?: number | null;
  arrivalDelay?: number | null;
  departureTime?: number | null;
  departureDelay?: number | null;
}

export interface TripUpdateInfo {
  tripId: string;
  delay?: number | null;
  timestamp?: number | null;
  stopTimeUpdates: StopTimeUpdate[];
}

export interface RealTimeState {
  vehicles: Vehicle[];
  tripUpdates?: TripUpdateInfo[];
  timestamp: number;
  activeStaticKey: string | null;
}

export interface CompressedVehicles {
  vehicleIds: (string | null)[];
  tripIds: (string | null)[];
  blockIds: (string | null)[];
  routeIds: RouteId[];
  shapeIds: (ShapeId | null)[];
  timestamps: number[];
  reportDelays?: (number | null)[];
  compressedLats: number[][];
  compressedLons: number[][];
  directionDegrees: number[];
}

export interface CompressedRealTimeState {
  vehicles: CompressedVehicles;
  timestamp: number;
  activeStaticKey?: string | null;
  latestStaticKey?: string | null;
  tripUpdates?: TripUpdateInfo[];
}

export interface Stops {
  lats: number[];
  lons: number[];
}

export interface Shape {
  id: ShapeId;
  lats: number[];
  lons: number[];
  stops: Stops;
}

export interface BigStaticData {
  shapes: Record<ShapeId, Shape>;
}

export interface SmallStaticData {
  routeIds: RouteId[];
}

export interface CompressedShape {
  ids: ShapeId[];
  compressedLats: number[][];
  compressedLons: number[][];
  stopIndexDeltas: number[][];
}

export interface CompressedBigStaticData {
  shapes: CompressedShape;
  stops: { latDeltas: number[]; lonDeltas: number[] };
}

class RefSystem {
  constructor(
    private coordNumDigits: number,
    private refLat: number,
    private refLon: number,
  ) {}

  decompressLats(coords: number[]): number[] {
    return this._decompress(this.refLat, coords);
  }

  decompressLons(coords: number[]): number[] {
    return this._decompress(this.refLon, coords);
  }

  private _decompress(ref: number, coords: number[]): number[] {
    const inv = Math.pow(10, -this.coordNumDigits);
    return decodeDeltas(coords).map((offset) => ref + offset * inv);
  }
}

const STATIC_REFERENCE_SYSTEM = new RefSystem(6, 45.815, 15.9819);
const FUTURE_TIMESTAMP_TOLERANCE_SECONDS = 3;
function decodeDeltas(deltas: number[]): number[] {
  let value = 0;
  return deltas.map((delta) => (value += delta));
}

function decompressVehicles(data: CompressedVehicles, refTimestamp: number): Vehicle[] {
  const vehicles: Vehicle[] = [];
  for (let i = 0, n = data.routeIds.length; i < n; ++i) {
    const timestamp = refTimestamp - data.timestamps[i];
    vehicles.push({
      vehicleId: data.vehicleIds[i],
      tripId: data.tripIds[i],
      blockId: data.blockIds[i],
      routeId: data.routeIds[i],
      shapeId: data.shapeIds[i],
      lat: STATIC_REFERENCE_SYSTEM.decompressLats(data.compressedLats[i]),
      lon: STATIC_REFERENCE_SYSTEM.decompressLons(data.compressedLons[i]),
      timestamp,
      hasInvalidTimestamp:
        !Number.isFinite(timestamp) ||
        timestamp <= 0 ||
        data.timestamps[i] < -FUTURE_TIMESTAMP_TOLERANCE_SECONDS,
      reportDelay: data.reportDelays?.[i] ?? null,
      directionDegrees: data.directionDegrees[i],
    });
  }
  return vehicles;
}

export function decompressRealTimeState(data: CompressedRealTimeState): RealTimeState {
  return {
    vehicles: decompressVehicles(data.vehicles, data.timestamp),
    tripUpdates: data.tripUpdates,
    timestamp: data.timestamp,
    activeStaticKey: data.activeStaticKey ?? data.latestStaticKey ?? null,
  };
}

export function decompressBigStaticData(data: CompressedBigStaticData): BigStaticData {
  const stopLats = STATIC_REFERENCE_SYSTEM.decompressLats(data.stops.latDeltas);
  const stopLons = STATIC_REFERENCE_SYSTEM.decompressLons(data.stops.lonDeltas);
  const shapes: Record<ShapeId, Shape> = {};
  for (let i = 0, n = data.shapes.ids.length; i < n; ++i) {
    const shapeId = data.shapes.ids[i];
    const stopIndices = decodeDeltas(data.shapes.stopIndexDeltas[i]);
    shapes[shapeId] = {
      id: shapeId,
      stops: {
        lats: stopIndices.map((index) => stopLats[index]),
        lons: stopIndices.map((index) => stopLons[index]),
      },
      lats: STATIC_REFERENCE_SYSTEM.decompressLats(data.shapes.compressedLats[i]),
      lons: STATIC_REFERENCE_SYSTEM.decompressLons(data.shapes.compressedLons[i]),
    };
  }
  return { shapes };
}

export function decompressSmallStaticData(data: { routes: { ids: RouteId[] } }): SmallStaticData {
  return { routeIds: data.routes.ids };
}
