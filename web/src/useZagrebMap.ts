import { useEffect, useRef, useState, type MutableRefObject, type RefObject } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import type { RealTimeState, Vehicle } from "./protocol";
import { createVehicleLayers, vehicleLayerRevision, type VehicleLayerSet } from "./vehicleLayers";
import { createStopLayers, type StopLayerSet } from "./stops";
import { triKey } from "./vehicleAnimation";
import { readLocationTracking, writeLocationTracking } from "./filterState";
import type { Theme } from "./theme";

const LIGHT_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const DARK_STYLE = "https://tiles.openfreemap.org/styles/dark";

function styleFor(theme: Theme): string {
  return theme === "dark" ? DARK_STYLE : LIGHT_STYLE;
}

export interface MapHandlers {
  vehiclesRef: RefObject<RealTimeState | null>;
  onVehicle: (vehicle: Vehicle) => void;
  onStop: (stop: { id: string; name: string }) => void;
  onEmpty: () => void;
  refreshStops: () => void;
}

/** Full-screen Zagreb map, geolocation, and the vehicle/stop layer shells. */
export function useZagrebMap(handlersRef: MutableRefObject<MapHandlers>, theme: Theme) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const layersRef = useRef<VehicleLayerSet | null>(null);
  const stopLayerSetRef = useRef<StopLayerSet | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const appliedStyle = useRef(styleFor(theme));

  const attachLayers = (map: maplibregl.Map) => {
    stopLayerSetRef.current?.destroy();
    layersRef.current?.destroy();
    const handlers = handlersRef.current;
    stopLayerSetRef.current = createStopLayers(map, (stop) => {
      handlersRef.current.onStop(stop);
    }, themeRef.current);
    layersRef.current = createVehicleLayers(map, {
      onVehicleClick: (featureProperties: { key: string }) => {
        const state = handlersRef.current.vehiclesRef.current;
        if (!state) return;
        const vehicle = state.vehicles.find((v) => triKey(v) === featureProperties.key);
        if (vehicle) handlersRef.current.onVehicle(vehicle);
      },
      onNothingClick: () => handlersRef.current.onEmpty(),
    });
    handlers.refreshStops();
  };

  useEffect(() => {
    let isUnmounted = false;
    let map: maplibregl.Map | null = null;
    try {
      map = new maplibregl.Map({
        container: mapContainer.current!,
        style: appliedStyle.current,
        center: [15.9819, 45.815],
        zoom: 12,
        minZoom: 9,
        maxZoom: 18,
        maxBounds: [
          [15.9819 - 0.5, 45.815 - 0.27],
          [15.9819 + 0.5, 45.815 + 0.22],
        ],
        dragRotate: false,
        pitchWithRotate: false,
        rollEnabled: false,
        boxZoom: false,
      });
    } catch {
      setMapError(
        "webgl",
      );
      return;
    }
    mapRef.current = map;
    map.on("moveend", () => handlersRef.current.refreshStops());
    map.on("zoomend", () => handlersRef.current.refreshStops());

    const geolocate = new maplibregl.GeolocateControl({
      fitBoundsOptions: { maxZoom: 13 },
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
    });
    map.addControl(geolocate, "bottom-left");
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "bottom-left");

    let restoreAttempts = 0;
    const restoreTracking = () => {
      if (isUnmounted) return;
      const restored = geolocate.trigger();
      if (!restored && restoreAttempts++ < 60) requestAnimationFrame(restoreTracking);
    };
    geolocate.on("trackuserlocationstart", () => writeLocationTracking(true));
    geolocate.on("trackuserlocationend", () => writeLocationTracking(false));
    geolocate.on("userlocationlostfocus", () => {});
    if (readLocationTracking()) {
      navigator.permissions
        ?.query({ name: "geolocation" })
        .then((perm) => {
          if (!isUnmounted && perm.state === "granted") restoreTracking();
        })
        .catch(() => {});
    }

    map.on("load", () => {
      if (isUnmounted) return;
      try {
        attachLayers(map);
      } catch {
        setMapError("webgl");
      }
    });

    return () => {
      isUnmounted = true;
      stopLayerSetRef.current?.destroy();
      stopLayerSetRef.current = null;
      map?.remove();
      mapRef.current = null;
      layersRef.current = null;
    };
  }, [handlersRef, vehicleLayerRevision]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const next = styleFor(theme);
    if (appliedStyle.current === next) return;

    let cancelled = false;
    const swap = () => {
      if (cancelled || !mapRef.current) return;
      const want = styleFor(themeRef.current);
      if (appliedStyle.current === want) return;
      appliedStyle.current = want;
      stopLayerSetRef.current?.destroy();
      layersRef.current?.destroy();
      stopLayerSetRef.current = null;
      layersRef.current = null;
      map.setStyle(want);
      map.once("style.load", () => {
        if (cancelled) return;
        if (styleFor(themeRef.current) !== want) {
          swap();
          return;
        }
        try {
          attachLayers(map);
        } catch {
          setMapError("webgl");
        }
      });
    };
    // Glyph 404s keep isStyleLoaded() false forever, so swap as soon as a style exists.
    if (map.getStyle()) swap();
    else map.once("load", swap);
    return () => {
      cancelled = true;
    };
  }, [theme]);

  return { mapContainer, mapRef, layersRef, stopLayerSetRef, mapError };
}
