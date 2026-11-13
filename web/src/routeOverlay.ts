import type * as maplibregl from "maplibre-gl";
import type { Shape } from "./protocol";

export function routeFeature(shape: Shape): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: shape.lons.map((lon, i) => [lon, shape.lats[i]]),
    },
    properties: {},
  };
}

/** Draw or clear the highlighted trip shape. */
export function syncRouteLayers(map: maplibregl.Map | null, shape: Shape | null): void {
  if (!map) return;
  const hasSource = map.getSource("vozlinia-route-source") !== undefined;
  if (!shape) {
    if (hasSource) {
      if (map.getLayer("vozlinia-route")) map.removeLayer("vozlinia-route");
      if (map.getSource("vozlinia-route-source")) map.removeSource("vozlinia-route-source");
    }
    return;
  }
  if (!hasSource) {
    map.addSource("vozlinia-route-source", {
      type: "geojson",
      data: routeFeature(shape),
    });
    map.addLayer({
      id: "vozlinia-route",
      type: "line",
      source: "vozlinia-route-source",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#e2294f", "line-width": 3, "line-opacity": 0.9 },
    });
    return;
  }
  (map.getSource("vozlinia-route-source") as maplibregl.GeoJSONSource)?.setData(
    routeFeature(shape),
  );
}
