// Interactive stop layer for VozLinia (new code).
//
// All stops come from static GTFS (stops.txt) as identity payload
// `/static/stops/v1/<key>`. Visibility is decided by the caller (zoomed out:
// only stops of the selected vehicle's route or of filter-enabled routes;
// street level: everything in view; the selected stop is always drawn). The
// map keeps a small neutral dot; the name appears only at street level or for
// the selected stop. Tram stops get a slightly amber tint, bus stops gray —
// no icon legend required.

import * as maplibregl from "maplibre-gl";
import type { Map } from "maplibre-gl";
import type { FeatureCollection, Point } from "geojson";
import type { RouteId } from "./protocol";

export interface StopInfo {
  id: string;
  name: string;
  lat: number;
  lon: number;
  routeIds: RouteId[];
  /** Empty when the stop runs today. Otherwise "sutra", "vikendom", or a weekday. */
  when: string;
}

export type StopsLayerPayload = {
  date: string;
  stops: [string, string, number, number, RouteId[], string?][];
};

export function parseStopsPayload(payload: StopsLayerPayload): StopInfo[] {
  return payload.stops.map(([id, name, lat, lon, routeIds, when]) => ({
    id, name, lat, lon, routeIds, when: when ?? "",
  }));
}

export interface StopFeatureProperties {
  id: string;
  name: string;
  tram: boolean;
  selected: boolean;
  when: string;
}

export function buildStopFeatures(
  stops: StopInfo[],
  selectedId: string | null,
  isVisible: (stop: StopInfo) => boolean,
): FeatureCollection<Point, StopFeatureProperties> {
  return {
    type: "FeatureCollection",
    features: stops
      .filter((stop) => stop.id === selectedId || isVisible(stop))
      .map((stop) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [stop.lon, stop.lat] },
        properties: {
          id: stop.id,
          name: stop.name,
          tram: isTramStop(stop),
          selected: stop.id === selectedId,
          when: stop.when,
        },
      })),
  };
}

/** A stop is a tram stop when any serving route is (short) numeric. */
export function isTramStop(stop: StopInfo): boolean {
  return stop.routeIds.some((routeId) => routeId.toString().length < 3);
}

export interface StopLayerSet {
  update(features: FeatureCollection<Point, StopFeatureProperties>): void;
  destroy(): void;
}

export function createStopLayers(
  map: Map,
  onStopClick: (stop: { id: string; name: string }) => void,
  theme: "light" | "dark" = "light",
): StopLayerSet {
  const empty: FeatureCollection<Point, StopFeatureProperties> = {
    type: "FeatureCollection",
    features: [],
  };

  map.addSource("vozlinia-stops", { type: "geojson", data: empty });

  // Neutral dot; a slightly amber tint marks tram stops, gray marks bus stops.
  map.addLayer({
    id: "vozlinia-stop-dot",
    type: "circle",
    source: "vozlinia-stops",
    paint: {
      "circle-radius": [
        "interpolate", ["linear"], ["zoom"],
        13, ["case", ["get", "selected"], 12, 9],
        15, ["case", ["get", "selected"], 15, 12],
        17, ["case", ["get", "selected"], 18, 14],
      ],
      "circle-color": [
        "case",
        ["!=", ["get", "when"], ""],
        theme === "dark" ? "#243044" : "#f4f7fb",
        ["get", "tram"], "#d9a13b",
        theme === "dark" ? "#c5d0de" : "#7b8494",
      ],
      "circle-stroke-color": [
        "case",
        ["get", "selected"], "#0b2b52",
        ["!=", ["get", "when"], ""], "#d9a13b",
        theme === "dark" ? "#0e1624" : "#ffffff",
      ],
      "circle-stroke-width": [
        "case", ["get", "selected"], 4, 2.25,
      ],
    },
  });

  // Pointer cursor over clickable stops.
  const onEnter = () => {
    map.getCanvas().style.cursor = "pointer";
  };
  const onLeave = () => {
    map.getCanvas().style.cursor = "";
  };
  const onClick = (event: maplibregl.MapLayerMouseEvent) => {
    const feature = event.features?.[0];
    if (!feature) return;
    const props = feature.properties as StopFeatureProperties;
    onStopClick({ id: props.id, name: props.name });
  };
  map.on("mouseenter", "vozlinia-stop-dot", onEnter);
  map.on("mouseleave", "vozlinia-stop-dot", onLeave);
  map.on("click", "vozlinia-stop-dot", onClick);

  // Names only at street level (or always for the selected stop).
  map.addLayer({
    id: "vozlinia-stop-label",
    type: "symbol",
    source: "vozlinia-stops",
    minzoom: 13.5,
    layout: {
      "text-field": [
        "case",
        ["!=", ["get", "when"], ""],
        ["concat", ["get", "name"], " · ", ["get", "when"]],
        ["get", "name"],
      ],
      "text-font": ["Noto Sans Regular"],
      "text-size": 12,
      "text-variable-anchor": ["top"],
      "text-radial-offset": 1.15,
    },
    paint: {
      "text-color": theme === "dark" ? "#e8eef6" : "#33415c",
      "text-halo-color": theme === "dark" ? "#0e1624" : "#ffffff",
      "text-halo-width": 1.5,
    },
  });

  return {
    update(features) {
      const source = map.getSource("vozlinia-stops") as maplibregl.GeoJSONSource;
      if (source) source.setData(features);
    },
    destroy() {
      map.off("mouseenter", "vozlinia-stop-dot", onEnter);
      map.off("mouseleave", "vozlinia-stop-dot", onLeave);
      map.off("click", "vozlinia-stop-dot", onClick);
      for (const id of ["vozlinia-stop-label", "vozlinia-stop-dot"]) {
        if (map.getLayer(id)) map.removeLayer(id);
      }
      if (map.getSource("vozlinia-stops")) map.removeSource("vozlinia-stops");
    },
  };
}
