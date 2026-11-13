// MapLibre GeoJSON builders and color expressions for VozLinia vehicles.
// The upstream project renders markers with a custom WebGL atlas; VozLinia
// uses ordinary MapLibre symbol/circle layers with the same visual rules
// (see docs/DEVIATIONS.md).

import type { GeoJSONSource, Map } from "maplibre-gl";
import type { LineString, Point, FeatureCollection, Feature } from "geojson";
import type { RouteId, Vehicle } from "./protocol";

export const TRAIL_OUTPUT_LENGTH = 6;
export const STALE_FADE_START_SECONDS = 75;
export const STALE_FADE_END_SECONDS = 90;

export type Position = [number, number];

export function getEffectiveVehicleDelay(vehicle: Vehicle, feedAge: number): number {
  return Math.max(0, vehicle.reportDelay ?? 0) + Math.max(0, feedAge);
}

export function getFeedAge(feedTimestamp: number, now = Date.now() / 1000): number {
  return Math.max(0, now - feedTimestamp);
}

/** Trams have 1-2 digit/letter route ids, buses 3+ (as in upstream). */
export function isTram(routeId: RouteId): boolean {
  return routeId.toString().length < 3;
}

export function vehicleTriKey(vehicle: Vehicle): string {
  return `${vehicle.vehicleId ?? ""}:${vehicle.tripId ?? ""}`;
}

export interface VehicleFeatureProperties {
  idx: number;
  key: string;
  routeId: number;
  shapeId: string | null;
  label: string;
  delay: number;
  dir: number | null;
  tram: boolean;
  highlight: boolean;
}

const TRAM_COLOR = "hsl(207, 90%, 54%)";
const TRAM_HIGHLIGHT_COLOR = "hsl(7, 89.8%, 53.9%)";
const BUS_COLOR = "hsl(212, 80%, 42%)";
const BUS_HIGHLIGHT_COLOR = "hsl(12, 80.4%, 42%)";
const STALE_TRAM_COLOR = "hsl(210, 6%, 56%)";
const STALE_BUS_COLOR = "hsl(210, 6%, 30%)";

function markerColorExpression(): CaptureAny {
  // Fade fresh -> stale between 75s and 90s, choosing colors per vehicle type.
  const base = [
    "case",
    ["==", ["get", "highlight"], true],
    ["case", ["==", ["get", "tram"], true], TRAM_HIGHLIGHT_COLOR, BUS_HIGHLIGHT_COLOR],
    ["case", ["==", ["get", "tram"], true], TRAM_COLOR, BUS_COLOR],
  ];
  return [
    "interpolate",
    ["linear"],
    ["number", ["get", "delay"], 0],
    STALE_FADE_START_SECONDS,
    base,
    STALE_FADE_END_SECONDS,
    ["case", ["==", ["get", "tram"], true], STALE_TRAM_COLOR, STALE_BUS_COLOR],
  ];
}

type CaptureAny = Record<string, unknown> | unknown[] | string | number | boolean | null;

export function buildVehicleMarkers(
  vehicles: Vehicle[],
  feedAge: number,
): FeatureCollection<Point, VehicleFeatureProperties> {
  return {
    type: "FeatureCollection",
    features: vehicles.map((vehicle, idx) => {
      const last = [vehicle.lon[vehicle.lon.length - 1], vehicle.lat[vehicle.lat.length - 1]] as Position;
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: last },
        properties: {
          idx,
          key: vehicleTriKey(vehicle),
          routeId: vehicle.routeId,
          shapeId: vehicle.shapeId,
          label: String(vehicle.routeId),
          delay: getEffectiveVehicleDelay(vehicle, feedAge),
          dir: vehicle.directionDegrees,
          tram: isTram(vehicle.routeId),
          highlight: false,
        },
      };
    }),
  };
}

export function buildVehicleTrails(
  _vehicles: Vehicle[],
  _feedAge: number,
): FeatureCollection<LineString, VehicleFeatureProperties> {
  return { type: "FeatureCollection", features: [] };
}

export function hasMutableLayer(map: Map, id: string): boolean {
  return map.getLayer(id) !== undefined;
}

export function setSourceData(
  map: Map,
  sourceId: string,
  data: FeatureCollection<Point | LineString, VehicleFeatureProperties>,
): void {
  const source = map.getSource(sourceId) as GeoJSONSource | undefined;
  if (source) source.setData(data);
}

export function markerColorLayer(): CaptureAny {
  return markerColorExpression();
}

export function getRouteFeatureForShape(shape: {
  lats: number[];
  lons: number[];
}): Feature<LineString> {
  return {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: shape.lons.map((lon, i) => [lon, shape.lats[i]]),
    },
    properties: {},
  };
}

export function getStopsFeatures(shape: {
  stops: { lats: number[]; lons: number[] };
}): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: shape.stops.lats.map((lat, i) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [shape.stops.lons[i], lat] },
      properties: {},
    })),
  };
}
