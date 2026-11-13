import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type * as maplibregl from "maplibre-gl";

import {
  decompressBigStaticData,
  type RealTimeState,
  type Shape,
  type Vehicle,
} from "./protocol";
import { fetchJson } from "./fetchJson";
import { getHttpUrl } from "./url";
import {
  buildStopFeatures,
  parseStopsPayload,
  type StopInfo,
  type StopLayerSet,
  type StopsLayerPayload,
} from "./stops";
import {
  computeStopDepartures,
  normalizeStopServices,
  stopDestinations,
  type RecentSample,
  type StopDepartureRow,
  type StopServices,
} from "./eta";
import type { FilterState } from "./filterState";
import { findSelectedVehicle, selectionFromVehicle, type Selection } from "./selection";
import { syncRouteLayers } from "./routeOverlay";

const STREET_ZOOM = 14;

interface StopBoardArgs {
  mapRef: RefObject<maplibregl.Map | null>;
  stopLayerSetRef: RefObject<StopLayerSet | null>;
  vehiclesRef: RefObject<RealTimeState | null>;
  samplesByTripRef: RefObject<Record<string, RecentSample[]>>;
  selectionRef: { current: Selection | null };
  filterStateRef: RefObject<FilterState>;
  activeStaticKey: string | null;
}

/** Stop layer, per-stop arrivals, the selected trip shape, and search lookups. */
export function useStopBoard(args: StopBoardArgs) {
  const {
    mapRef,
    stopLayerSetRef,
    vehiclesRef,
    samplesByTripRef,
    selectionRef,
    filterStateRef,
    activeStaticKey,
  } = args;

  const activeStaticKeyRef = useRef<string | null>(null);
  activeStaticKeyRef.current = activeStaticKey;
  const stopsDataRef = useRef<StopInfo[] | null>(null);
  const [stopsData, setStopsData] = useState<StopInfo[] | null>(null);
  const stopServicesRef = useRef<{ key: string; byStopId: Record<string, StopServices> } | null>(null);
  const stopSelectionRef = useRef<{ id: string; name: string } | null>(null);
  const lastSelectedKindRef = useRef<"vehicle" | "stop" | null>(null);
  const [selectedStopMeta, setSelectedStopMeta] = useState<{ id: string; name: string } | null>(null);
  const [selectedStopDepartures, setSelectedStopDepartures] = useState<StopDepartureRow[] | null>(null);
  const [stopLoading, setStopLoading] = useState(false);
  const [sheetKind, setSheetKind] = useState<"vehicle" | "stop" | null>(null);
  const [vehicleDestination, setVehicleDestination] = useState<string | null>(null);
  const destinationCacheRef = useRef<Record<string, string | null>>({});
  const selectedShapeRef = useRef<Shape | null>(null);
  const loadedShapeIdRef = useRef<string | null>(null);
  const bigStaticCacheRef = useRef<{ key: string; shapes: Record<string, Shape> } | null>(null);

  const refreshStopLayer = useCallback(() => {
    const stops = stopsDataRef.current;
    const set = stopLayerSetRef.current;
    const map = mapRef.current;
    if (!stops || !set || !map) return;
    const selected = stopSelectionRef.current;
    const filter = filterStateRef.current;
    const vehicleSelection = selectionRef.current;
    const street = map.getZoom() >= STREET_ZOOM;
    let west = -180;
    let east = 180;
    let south = -90;
    let north = 90;
    if (street) {
      const bounds = map.getBounds();
      west = bounds.getWest() - 0.004;
      east = bounds.getEast() + 0.004;
      south = bounds.getSouth() - 0.004;
      north = bounds.getNorth() + 0.004;
    }
    set.update(buildStopFeatures(stops, selected?.id ?? null, (stop) => {
      if (street) {
        return stop.lon >= west && stop.lon <= east && stop.lat >= south && stop.lat <= north;
      }
      if (filter && filter.enabled && filter.selection.size > 0) {
        return stop.routeIds.some((id) => filter.selection.has(id));
      }
      if (vehicleSelection) return stop.routeIds.includes(vehicleSelection.routeId);
      return false;
    }));
  }, [filterStateRef, mapRef, selectionRef, stopLayerSetRef]);

  const ensureStops = useCallback(async (staticKey: string) => {
    if (stopsDataRef.current !== null && activeStaticKeyRef.current === staticKey) return;
    const payload = await fetchJson<StopsLayerPayload>(
      getHttpUrl(`static/stops/v1/${staticKey}`));
    stopsDataRef.current = parseStopsPayload(payload);
    setStopsData(stopsDataRef.current);
    stopServicesRef.current = { key: staticKey, byStopId: {} };
    stopSelectionRef.current = null;
    refreshStopLayer();
  }, [refreshStopLayer]);

  const ensureStopServices = useCallback(async (
    staticKey: string,
    stopId: string,
  ): Promise<StopServices | null> => {
    if (stopServicesRef.current?.key !== staticKey) {
      stopServicesRef.current = { key: staticKey, byStopId: {} };
    }
    const cached = stopServicesRef.current.byStopId[stopId];
    if (cached) return cached;
    const payload = await fetchJson<StopServices>(
      getHttpUrl(`static/stop/v1/${staticKey}/${encodeURIComponent(stopId)}`));
    const normalized = normalizeStopServices(payload);
    if (stopServicesRef.current?.key === staticKey) {
      stopServicesRef.current.byStopId[stopId] = normalized;
    }
    return normalized;
  }, []);

  const resolveStopLines = useCallback(async (stopId: string) => {
    const staticKey = activeStaticKeyRef.current;
    if (!staticKey) return [];
    const services = await ensureStopServices(staticKey, stopId);
    return services ? stopDestinations(services) : [];
  }, [ensureStopServices]);

  const ensureBigStatic = useCallback(async () => {
    const staticKey = activeStaticKeyRef.current;
    if (!staticKey) return null;
    if (bigStaticCacheRef.current?.key === staticKey) return bigStaticCacheRef.current.shapes;
    const url = getHttpUrl(`static/big/v1/${staticKey}`);
    const compressed = (await fetchJson(url)) as never;
    const data = decompressBigStaticData(compressed);
    bigStaticCacheRef.current = { key: staticKey, shapes: data.shapes };
    return data.shapes;
  }, []);

  const loadShape = useCallback(async (shapeId: string | null) => {
    const staticKey = activeStaticKeyRef.current;
    if (!shapeId || !staticKey) return;
    if (loadedShapeIdRef.current === shapeId &&
        bigStaticCacheRef.current?.key === staticKey) {
      return;
    }
    try {
      const shapes = await ensureBigStatic();
      if (!shapes) return;
      loadedShapeIdRef.current = shapeId;
      selectedShapeRef.current = shapes[shapeId] ?? null;
      syncRouteLayers(mapRef.current, selectedShapeRef.current);
    } catch (error) {
      console.error("Could not load route and stops:", error);
    }
  }, [ensureBigStatic, mapRef]);

  const recomputeStopDepartures = useCallback(() => {
    const selectionNow = stopSelectionRef.current;
    const state = vehiclesRef.current;
    if (!selectionNow || !state) return;
    void (async () => {
      const staticKey = activeStaticKeyRef.current;
      if (!staticKey) return;
      try {
        await ensureStops(staticKey);
        const services = await ensureStopServices(staticKey, selectionNow.id);
        if (!services || stopSelectionRef.current?.id !== selectionNow.id) return;
        const stopsById: Record<string, { lat: number; lon: number }> = {};
        for (const stop of stopsDataRef.current ?? []) {
          stopsById[stop.id] = { lat: stop.lat, lon: stop.lon };
        }
        const shapesById: Record<string, { lats: number[]; lons: number[] }> = {};
        try {
          const shapes = await ensureBigStatic();
          if (shapes) {
            for (const service of services.services) {
              const shape = service.shapeId ? shapes[service.shapeId] : undefined;
              if (service.shapeId && shape) {
                shapesById[service.shapeId] = { lats: shape.lats, lons: shape.lons };
              }
            }
          }
        } catch (error) {
          console.error("Could not load shapes for the estimate:", error);
        }
        const now = Date.now() / 1000;
        const rows = computeStopDepartures({
          services,
          stopsById,
          vehicles: state.vehicles,
          tripUpdates: state.tripUpdates,
          shapesById,
          samplesByTrip: samplesByTripRef.current ?? {},
          now,
        });
        if (stopSelectionRef.current?.id === selectionNow.id) {
          setSelectedStopDepartures(rows);
          setStopLoading(false);
        }
      } catch (error) {
        console.error("Could not load stop departures:", error);
        setStopLoading(false);
      }
    })();
  }, [ensureBigStatic, ensureStopServices, ensureStops, samplesByTripRef, vehiclesRef]);

  const selectStop = useCallback((stop: { id: string; name: string }) => {
    stopSelectionRef.current = stop;
    lastSelectedKindRef.current = "stop";
    setSheetKind("stop");
    setSelectedStopMeta(stop);
    setSelectedStopDepartures(null);
    setStopLoading(true);
    refreshStopLayer();
    recomputeStopDepartures();
  }, [recomputeStopDepartures, refreshStopLayer]);

  const deselectAll = useCallback(() => {
    selectionRef.current = null;
    stopSelectionRef.current = null;
    lastSelectedKindRef.current = null;
    setSheetKind(null);
    selectedShapeRef.current = null;
    loadedShapeIdRef.current = null;
    setSelectedStopMeta(null);
    setSelectedStopDepartures(null);
    setStopLoading(false);
    setVehicleDestination(null);
    syncRouteLayers(mapRef.current, null);
    refreshStopLayer();
  }, [mapRef, refreshStopLayer, selectionRef]);

  const selectVehicle = useCallback((vehicle: Vehicle) => {
    selectionRef.current = selectionFromVehicle(vehicle);
    lastSelectedKindRef.current = "vehicle";
    setSheetKind("vehicle");
    stopSelectionRef.current = null;
    setSelectedStopMeta(null);
    setSelectedStopDepartures(null);
    setStopLoading(false);
    selectedShapeRef.current = null;
    loadedShapeIdRef.current = null;
    syncRouteLayers(mapRef.current, null);
    void loadShape(vehicle.shapeId);
    refreshStopLayer();
    const tripId = vehicle.tripId;
    const cached = tripId ? destinationCacheRef.current[tripId] : undefined;
    if (cached !== undefined) {
      setVehicleDestination(cached);
      return;
    }
    setVehicleDestination(null);
    const staticKey = activeStaticKeyRef.current;
    if (!tripId || !staticKey) return;
    void fetchJson<{ headsign?: string | null }>(
      getHttpUrl(`static/trip/v1/${staticKey}/${encodeURIComponent(tripId)}`),
    ).then((data) => {
      const headsign = data.headsign ?? null;
      if (tripId) destinationCacheRef.current[tripId] = headsign;
      if (selectionRef.current?.tripId === tripId) setVehicleDestination(headsign);
    }).catch(() => {
      if (selectionRef.current?.tripId === tripId) setVehicleDestination(null);
    });
  }, [loadShape, mapRef, refreshStopLayer, selectionRef]);

  const onRealtime = useCallback((state: RealTimeState) => {
    recomputeStopDepartures();
    const selection = selectionRef.current;
    if (!selection) return;
    const next = findSelectedVehicle(state.vehicles, selection);
    if (next) {
      selection.routeId = next.routeId;
      selection.shapeId = next.shapeId;
      if (next.shapeId !== loadedShapeIdRef.current) void loadShape(next.shapeId);
    } else {
      selectionRef.current = null;
      syncRouteLayers(mapRef.current, null);
    }
  }, [loadShape, mapRef, recomputeStopDepartures, selectionRef]);

  useEffect(() => {
    if (!selectedStopMeta) return;
    const id = window.setInterval(() => recomputeStopDepartures(), 10000);
    return () => window.clearInterval(id);
  }, [recomputeStopDepartures, selectedStopMeta]);

  useEffect(() => {
    const staticKey = activeStaticKey;
    if (!staticKey) return;
    void ensureStops(staticKey)
      .catch((error) => console.error("Could not load stops:", error));
  }, [activeStaticKey, ensureStops]);

  return {
    stopsData,
    refreshStopLayer,
    resolveStopLines,
    selectStop,
    selectVehicle,
    deselectAll,
    onRealtime,
    selectedStopMeta,
    selectedStopDepartures,
    stopLoading,
    sheetKind,
    vehicleDestination,
  };
}
