// MapLibre layers for VozLinia vehicles (new code; see docs/DEVIATIONS.md).

import * as maplibregl from "maplibre-gl";
import type { Map } from "maplibre-gl";
import { busIcon, tramIcon, type IconPixels } from "./markers/icons";

import type { Vehicle } from "./protocol";
import {
  buildVehicleMarkers,
  buildVehicleTrails,
  getEffectiveVehicleDelay,
  markerColorLayer,
  STALE_FADE_START_SECONDS,
} from "./mapLayers";
import { formatDuration } from "./formatDuration";

export interface VehicleLayerOptions {
  onVehicleClick: (featureProperties: { key: string }) => void;
  onNothingClick: () => void;
}

export interface VehicleLayerUpdate {
  vehicles: Vehicle[];
  feedAge: number;
  highlightedRouteId: number | null;
  selectedKey: string | null;
}

export interface VehicleLayerSet {
  update(options: VehicleLayerUpdate): void;
  destroy(): void;
}

const COLLISION_PROXY_ID = "vozlinia-collision-proxy";
const TRAIL_SOURCE_ID = "vozlinia-trail-source";
const MARKER_SOURCE_ID = "vozlinia-marker-source";
export const vehicleLayerRevision = 7;

function makeArrowIcon(map: Map): void {
  if (map.hasImage("vozlinia-arrow-tram") && map.hasImage("vozlinia-arrow-bus")) return;
  const ratio = 2;
  const size = 80;
  const trace = (ctx: CanvasRenderingContext2D) => {
    ctx.beginPath();
    ctx.moveTo(40, 6);
    ctx.lineTo(70, 58);
    ctx.lineTo(40, 44);
    ctx.lineTo(10, 58);
    ctx.closePath();
  };
  const draw = (color: string, imageId: string) => {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    trace(ctx);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fill();
    if (map.hasImage(imageId)) map.removeImage(imageId);
    map.addImage(imageId, ctx.getImageData(0, 0, size, size), { pixelRatio: ratio });
  };
  draw("#1a8ce8", "vozlinia-arrow-tram");
  draw("#1566c1", "vozlinia-arrow-bus");
}

const TRAM_ICON = "vozlinia-tram-icon";
const BUS_ICON = "vozlinia-bus-icon";

function putVehicleIcon(map: Map, imageId: string, icon: IconPixels): void {
  const binary = atob(icon.raw);
  const pixels = new Uint8ClampedArray(binary.length);
  for (let i = 0; i < binary.length; i++) pixels[i] = binary.charCodeAt(i);
  if (map.hasImage(imageId)) map.removeImage(imageId);
  map.addImage(imageId, new ImageData(pixels, icon.w, icon.h), { pixelRatio: icon.ratio });
}

function makeGhostImage(map: Map): void {
  if (map.hasImage("vozlinia-ghost")) return;
  const size = 13 * Math.max(1, window.devicePixelRatio || 1);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "red";
    ctx.fillRect(0, 0, size, size);
    map.addImage("vozlinia-ghost", ctx.getImageData(0, 0, size, size) as never);
  }
}

export function createVehicleLayers(map: Map, options: VehicleLayerOptions): VehicleLayerSet {
  const emptyCollection: maplibregl.GeoJSONSourceSpecification = {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  };

  makeGhostImage(map);
  makeArrowIcon(map);
  putVehicleIcon(map, TRAM_ICON, tramIcon);
  putVehicleIcon(map, BUS_ICON, busIcon);

  map.addSource(TRAIL_SOURCE_ID, emptyCollection);
  map.addSource(MARKER_SOURCE_ID, emptyCollection);
  map.addSource(COLLISION_PROXY_ID, emptyCollection);

  map.addLayer({
    id: "vozlinia-trail",
    type: "line",
    source: TRAIL_SOURCE_ID,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": markerColorLayer() as never,
      "line-width": 2.5,
      "line-opacity": 0.55,
    },
  });

  // Top-down bus. Same zoom scaling as the tram so a city view stays readable.
  // The line number sits upright in the open middle of the body.
  map.addLayer({
    id: "vozlinia-bus",
    type: "symbol",
    source: MARKER_SOURCE_ID,
    filter: ["!", ["get", "tram"]],
    layout: {
      "icon-image": BUS_ICON,
      "icon-rotate": ["coalesce", ["get", "dir"], 0],
      "icon-rotation-alignment": "map",
      "icon-pitch-alignment": "map",
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "icon-size": [
        "interpolate", ["linear"], ["zoom"],
        9, ["*", 0.26, ["case", ["get", "highlight"], 1.06, 1]],
        12, ["*", 0.4, ["case", ["get", "highlight"], 1.06, 1]],
        14, ["*", 0.7, ["case", ["get", "highlight"], 1.06, 1]],
        16, ["*", 1, ["case", ["get", "highlight"], 1.06, 1]],
      ],
    },
    paint: {
      "icon-opacity": [
        "interpolate", ["linear"], ["number", ["get", "delay"], 0],
        STALE_FADE_START_SECONDS, 1,
        90, 0.45,
      ],
    },
  });

  // Top-down tram. Nose points up in the bitmap, then rotates with the bearing.
  // The line number is a separate upright label in the middle of the body,
  // between the two rows of windows, so it stays readable.
  map.addLayer({
    id: "vozlinia-tram",
    type: "symbol",
    source: MARKER_SOURCE_ID,
    filter: ["get", "tram"],
    layout: {
      "icon-image": TRAM_ICON,
      "icon-rotate": ["coalesce", ["get", "dir"], 0],
      "icon-rotation-alignment": "map",
      "icon-pitch-alignment": "map",
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "icon-size": [
        "interpolate", ["linear"], ["zoom"],
        9, ["*", 0.26, ["case", ["get", "highlight"], 1.06, 1]],
        12, ["*", 0.4, ["case", ["get", "highlight"], 1.06, 1]],
        14, ["*", 0.7, ["case", ["get", "highlight"], 1.06, 1]],
        16, ["*", 1, ["case", ["get", "highlight"], 1.06, 1]],
      ],
    },
    paint: {
      "icon-opacity": [
        "interpolate", ["linear"], ["number", ["get", "delay"], 0],
        STALE_FADE_START_SECONDS, 1,
        90, 0.45,
      ],
    },
  });

  map.addLayer({
    id: "vozlinia-vehicle-label",
    type: "symbol",
    source: MARKER_SOURCE_ID,
    layout: {
      "text-field": ["get", "label"],
      "text-font": ["Noto Sans Medium"],
      "text-size": [
        "interpolate", ["linear"], ["zoom"],
        10, ["case", ["get", "tram"], 7, 8],
        12, ["case", ["get", "tram"], 9, 9],
        14, ["case", ["get", "tram"], 11.5, 11],
        16, ["case", ["get", "tram"], 13, 12],
      ],
      "text-allow-overlap": true,
      "text-ignore-placement": true,
      "text-anchor": "center",
    },
    paint: {
      "text-color": "#ffffff",
      "text-halo-color": "#0b3a6e",
      "text-halo-width": 0.8,
      "text-opacity": [
        "interpolate", ["linear"], ["zoom"],
        12.2, 0,
        13.2, 1,
      ],
    },
  });

  // Smaller chevron just past the nose. Offset differs because the bus is longer.
  map.addLayer({
    id: "vozlinia-arrow",
    type: "symbol",
    source: MARKER_SOURCE_ID,
    filter: ["!=", ["get", "dir"], null],
    layout: {
      "icon-image": [
        "case",
        ["get", "tram"], "vozlinia-arrow-tram",
        "vozlinia-arrow-bus",
      ],
      "icon-rotate": ["coalesce", ["get", "dir"], 0],
      "icon-rotation-alignment": "map",
      "icon-keep-upright": false,
      "icon-size": [
        "interpolate", ["linear"], ["zoom"],
        9, 0.18,
        12, 0.28,
        14, 0.5,
        16, 0.72,
      ],
      "icon-offset": [
        "case",
        ["get", "tram"], ["literal", [0, -47]],
        ["literal", [0, -51]],
      ],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
  });

  // Ghost layer hides the map labels beneath vehicles (declutter).
  map.addLayer({
    id: COLLISION_PROXY_ID,
    type: "symbol",
    source: COLLISION_PROXY_ID,
    layout: {
      "icon-image": "vozlinia-ghost",
      "icon-size": 1,
      "icon-allow-overlap": true,
      "icon-ignore-placement": false,
    },
    paint: { "icon-opacity": 0 },
  });



  let popup: maplibregl.Popup | null = null;

  const onVehicleClick = (event: maplibregl.MapLayerMouseEvent) => {
    const feature = event.features?.[0];
    if (!feature) return;
    options.onVehicleClick({ key: String(feature.properties?.["key"]) });
  };
  const onEnter = () => {
    map.getCanvas().style.cursor = "pointer";
  };
  const onLeave = () => {
    map.getCanvas().style.cursor = "";
  };
  const onMapClick = (event: maplibregl.MapMouseEvent) => {
    const hitLayers = [
      "vozlinia-bus",
      "vozlinia-tram",
      "vozlinia-vehicle-label",
      "vozlinia-arrow",
      "vozlinia-stop-dot",
      "vozlinia-stop-label",
    ].filter((id) => map.getLayer(id));
    const hits = map.queryRenderedFeatures(event.point, { layers: hitLayers });
    if (hits.length === 0) options.onNothingClick();
  };
  map.on("click", "vozlinia-bus", onVehicleClick);
  map.on("click", "vozlinia-tram", onVehicleClick);
  map.on("mouseenter", "vozlinia-bus", onEnter);
  map.on("mouseenter", "vozlinia-tram", onEnter);
  map.on("mouseleave", "vozlinia-bus", onLeave);
  map.on("mouseleave", "vozlinia-tram", onLeave);
  map.on("click", onMapClick);

  const set: VehicleLayerSet = {
    update(update: VehicleLayerUpdate) {
      const { vehicles, feedAge, highlightedRouteId, selectedKey } = update;
      const trails = buildVehicleTrails(vehicles, feedAge);
      const markers = buildVehicleMarkers(vehicles, feedAge);
      for (const feature of markers.features) {
        feature.properties.highlight =
          feature.properties.routeId === highlightedRouteId ||
          feature.properties.key === selectedKey;
      }

      (map.getSource(TRAIL_SOURCE_ID) as maplibregl.GeoJSONSource)?.setData(trails);
      (map.getSource(MARKER_SOURCE_ID) as maplibregl.GeoJSONSource)?.setData(markers);
      (map.getSource(COLLISION_PROXY_ID) as maplibregl.GeoJSONSource)?.setData({
        type: "FeatureCollection",
        features: markers.features.map((feature) => ({
          type: "Feature",
          geometry: feature.geometry,
          properties: {},
        })),
      });

      // Delay tooltip on the selected vehicle.
      let tooltipVehicle: Vehicle | null = null;
      if (selectedKey !== null) {
        for (const vehicle of vehicles) {
          if (`${vehicle.vehicleId ?? ""}:${vehicle.tripId ?? ""}` === selectedKey) {
            tooltipVehicle = vehicle;
            break;
          }
        }
      }
      if (tooltipVehicle) {
        const delay = getEffectiveVehicleDelay(tooltipVehicle, feedAge);
        const lastLon = tooltipVehicle.lon[tooltipVehicle.lon.length - 1];
        const lastLat = tooltipVehicle.lat[tooltipVehicle.lat.length - 1];
        if (tooltipVehicle.hasInvalidTimestamp || delay > STALE_FADE_START_SECONDS) {
          if (!popup) {
            popup = new maplibregl.Popup({
              anchor: "bottom",
              closeButton: false,
              closeOnClick: false,
              className: "vehicle-delay-tooltip",
              maxWidth: "none",
            });
          }
          popup
            .setLngLat([lastLon, lastLat])
            .setText(
              tooltipVehicle.hasInvalidTimestamp
                ? "Neispravno vrijeme podataka"
                : `Podaci kasne: ${tooltipVehicle.reportDelay == null ? "najmanje " : ""}${formatDuration(Math.round(delay))}`,
            );
          if (!popup.isOpen()) popup.addTo(map);
        } else {
          popup?.remove();
          popup = null;
        }
      } else {
        popup?.remove();
        popup = null;
      }
    },
    destroy() {
      popup?.remove();
      popup = null;
      map.off("click", "vozlinia-bus", onVehicleClick);
      map.off("click", "vozlinia-tram", onVehicleClick);
      map.off("mouseenter", "vozlinia-bus", onEnter);
      map.off("mouseenter", "vozlinia-tram", onEnter);
      map.off("mouseleave", "vozlinia-bus", onLeave);
      map.off("mouseleave", "vozlinia-tram", onLeave);
      map.off("click", onMapClick);
      for (const id of ["vozlinia-vehicle-label", "vozlinia-tram", "vozlinia-bus",
        "vozlinia-arrow", "vozlinia-trail", COLLISION_PROXY_ID]) {
        if (map.getLayer(id)) map.removeLayer(id);
      }
      for (const id of [TRAIL_SOURCE_ID, MARKER_SOURCE_ID, COLLISION_PROXY_ID]) {
        if (map.getSource(id)) map.removeSource(id);
      }
    },
  };
  return set;
}
