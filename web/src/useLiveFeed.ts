import { useEffect, useRef, useState, type MutableRefObject, type RefObject } from "react";
import type * as maplibregl from "maplibre-gl";

import {
  decompressBigStaticData,
  decompressRealTimeState,
  type RealTimeState,
} from "./protocol";
import { getFeedAge } from "./mapLayers";
import type { VehicleLayerSet } from "./vehicleLayers";
import { VehicleAnimator } from "./vehicleAnimation";
import { fetchJson } from "./fetchJson";
import { getHttpUrl, getWebSocketUrl } from "./url";
import type { FilterState } from "./filterState";
import type { Selection } from "./selection";
import type { RecentSample } from "./eta";

interface LiveFeedArgs {
  mapRef: RefObject<maplibregl.Map | null>;
  layersRef: RefObject<VehicleLayerSet | null>;
  selectionRef: RefObject<Selection | null>;
  filterStateRef: RefObject<FilterState>;
  samplesByTripRef: RefObject<Record<string, RecentSample[]>>;
  onSocketMessageRef: MutableRefObject<(data: unknown) => boolean>;
  onRealtimeRef: MutableRefObject<(state: RealTimeState) => void>;
}

/** WebSocket feed plus the animation loop that paints vehicles every frame. */
export function useLiveFeed(args: LiveFeedArgs) {
  const {
    mapRef,
    layersRef,
    selectionRef,
    filterStateRef,
    samplesByTripRef,
    onSocketMessageRef,
    onRealtimeRef,
  } = args;

  const [vehicles, setVehicles] = useState<RealTimeState | null>(null);
  const [lastUpdateTime, setLastUpdateTime] = useState<number | null>(null);
  const [activeStaticKey, setActiveStaticKey] = useState<string | null>(null);
  const vehiclesRef = useRef<RealTimeState | null>(null);
  const feedTimestampRef = useRef<number | null>(null);
  const animatorRef = useRef<VehicleAnimator | null>(null);

  useEffect(() => {
    animatorRef.current = new VehicleAnimator();
    return () => {
      animatorRef.current = null;
    };
  }, []);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectAttempts = 0;
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      ws = new WebSocket(getWebSocketUrl("ws-v4"));
      ws.addEventListener("open", () => {
        reconnectAttempts = 0;
      });
      ws.addEventListener("message", (event) => {
        if (cancelled) return;
        let data: unknown;
        try {
          data = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (onSocketMessageRef.current(data)) return;
        if (data && typeof data === "object" && "vehicles" in data) {
          const state = decompressRealTimeState(data as never);
          vehiclesRef.current = state;
          feedTimestampRef.current = state.timestamp;
          animatorRef.current?.update(state.vehicles, state.timestamp);
          setVehicles(state);
          setLastUpdateTime(state.timestamp * 1000);
          setActiveStaticKey(state.activeStaticKey);
          const samples = samplesByTripRef.current;
          if (samples) {
            for (const vehicle of state.vehicles) {
              const tripId = vehicle.tripId;
              if (!tripId || vehicle.hasInvalidTimestamp) continue;
              const list = samples[tripId] ?? [];
              list.push({
                ts: vehicle.timestamp,
                lat: vehicle.lat[vehicle.lat.length - 1],
                lon: vehicle.lon[vehicle.lon.length - 1],
              });
              while (list.length > 6) list.shift();
              samples[tripId] = list;
            }
          }
          onRealtimeRef.current(state);
        }
      });
      ws.addEventListener("close", () => {
        if (cancelled) return;
        const delay = Math.min(1000 + 1000 * reconnectAttempts, 5000);
        setTimeout(() => {
          if (cancelled) return;
          reconnectAttempts += 1;
          connect();
        }, delay);
      });
      ws.addEventListener("error", () => ws?.close());
    };
    connect();
    return () => {
      cancelled = true;
      ws?.close();
    };
  }, [onRealtimeRef, onSocketMessageRef, samplesByTripRef]);

  useEffect(() => {
    if (!activeStaticKey) return;
    let cancelled = false;
    const url = getHttpUrl(`static/big/v1/${activeStaticKey}`);
    void fetchJson(url)
      .then((data) => {
        if (cancelled) return;
        const big = decompressBigStaticData(data as never);
        const shapes: Record<string, { lats: number[]; lons: number[] }> = {};
        for (const [id, shape] of Object.entries(big.shapes)) {
          shapes[id] = { lats: shape.lats, lons: shape.lons };
        }
        animatorRef.current?.setShapes(shapes);
      })
      .catch((error) => {
        console.error("Could not load routes for tram snapping:", error);
      });
    return () => {
      cancelled = true;
    };
  }, [activeStaticKey]);

  useEffect(() => {
    let raf = 0;
    let lastDraw = 0;
    const loop = (frame: number) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      if (frame - lastDraw < 50) return;
      lastDraw = frame;
      const map = mapRef.current;
      const layers = layersRef.current;
      const animator = animatorRef.current;
      const feedTs = feedTimestampRef.current;
      if (map && layers && animator && feedTs != null) {
        const now = Date.now() / 1000;
        const feedAge = getFeedAge(feedTs, now);
        const samples = animator.sample(now);
        const selection = selectionRef.current;
        const highlightedRouteId = selection ? selection.routeId : null;
        const selectedKey = selection ? selection.key : null;
        const filter = filterStateRef.current;
        const active = filter && filter.enabled ? filter.selection : null;
        const filtered = samples.filter((vehicle) => {
          if (highlightedRouteId !== null && vehicle.routeId === highlightedRouteId) {
            return true;
          }
          if (active === null || active.size === 0) return true;
          return active.has(vehicle.routeId);
        });
        layers.update({
          vehicles: filtered,
          feedAge,
          highlightedRouteId,
          selectedKey,
        });
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [filterStateRef, layersRef, mapRef, selectionRef]);

  return { vehicles, lastUpdateTime, activeStaticKey, vehiclesRef, feedTimestampRef };
}
