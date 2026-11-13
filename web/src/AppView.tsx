import { useCallback, useEffect, useRef, useState } from "react";

import {
  decompressSmallStaticData,
  type RealTimeState,
} from "./protocol";
import { getHttpUrl } from "./url";
import { FilterControl, FilterOverlay } from "./FilterOverlay";
import { HelpControl, InfoControl, InfoOverlay, LanguageControl, ThemeControl } from "./InfoOverlay";
import { NewsControl, NewsOverlay } from "./NewsOverlay";
import { StaleDataIndicator } from "./StaleDataIndicator";
import { SearchBox } from "./SearchBox";
import {
  readFavorites,
  readFilterState,
  writeFavorites,
  writeFilterState,
  type FilterState,
} from "./filterState";
import type { Selection } from "./selection";
import { findSelectedVehicle } from "./selection";
import type { RecentSample } from "./eta";
import { MapUnavailableBox, StopSheet, VehicleSheet } from "./sheets";
import { useZagrebMap, type MapHandlers } from "./useZagrebMap";
import { useLiveFeed } from "./useLiveFeed";
import { useStopBoard } from "./useStopBoard";
import { useNews } from "./useNews";
import { applyTheme, readTheme, writeTheme, type Theme } from "./theme";

export type { FilterState } from "./filterState";

export function AppView() {
  const [filterState, setFilterState] = useState<FilterState>(readFilterState);
  const filterStateRef = useRef(filterState);
  const selectionRef = useRef<Selection | null>(null);
  const samplesByTripRef = useRef<Record<string, RecentSample[]>>({});
  const onSocketMessageRef = useRef<(data: unknown) => boolean>(() => false);
  const onRealtimeRef = useRef<(state: RealTimeState) => void>(() => {});
  const handlersRef = useRef<MapHandlers>({
    vehiclesRef: { current: null },
    onVehicle: () => {},
    onStop: () => {},
    onEmpty: () => {},
    refreshStops: () => {},
  });

  const [showInfo, setShowInfo] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [smallStaticData, setSmallStaticData] = useState<ReturnType<typeof decompressSmallStaticData> | null>(null);

  const [theme, setTheme] = useState<Theme>(() => {
    const initial = readTheme();
    applyTheme(initial);
    return initial;
  });
  useEffect(() => {
    applyTheme(theme);
    writeTheme(theme);
  }, [theme]);

  const news = useNews();
  const map = useZagrebMap(handlersRef, theme);
  const feed = useLiveFeed({
    mapRef: map.mapRef,
    layersRef: map.layersRef,
    selectionRef,
    filterStateRef,
    samplesByTripRef,
    onSocketMessageRef,
    onRealtimeRef,
  });
  const board = useStopBoard({
    mapRef: map.mapRef,
    stopLayerSetRef: map.stopLayerSetRef,
    vehiclesRef: feed.vehiclesRef,
    samplesByTripRef,
    selectionRef,
    filterStateRef,
    activeStaticKey: feed.activeStaticKey,
  });

  handlersRef.current = {
    vehiclesRef: feed.vehiclesRef,
    onVehicle: board.selectVehicle,
    onStop: board.selectStop,
    onEmpty: board.deselectAll,
    refreshStops: board.refreshStopLayer,
  };
  onSocketMessageRef.current = news.handleMessage;
  onRealtimeRef.current = board.onRealtime;

  useEffect(() => {
    if (!feed.activeStaticKey) return;
    const url = getHttpUrl(`static/small/v0/${feed.activeStaticKey}`);
    void fetch(url, { cache: "no-cache" })
      .then((r) => r.json())
      .then((data) => setSmallStaticData(decompressSmallStaticData(data)))
      .catch(() => {});
  }, [feed.activeStaticKey]);

  const applyFilter = useCallback((next: FilterState) => {
    filterStateRef.current = next;
    setFilterState(next);
    writeFilterState(next);
    board.refreshStopLayer();
  }, [board.refreshStopLayer]);

  const filterHidesAll =
    feed.vehicles !== null &&
    feed.vehicles.vehicles.length > 0 &&
    filterState.enabled &&
    filterState.selection.size > 0 &&
    feed.vehicles.vehicles.every((v) => !filterState.selection.has(v.routeId)) &&
    selectionRef.current === null;

  const [favoriteIds, setFavoriteIds] = useState<string[]>(readFavorites);
  const favoriteStops = (board.stopsData ?? []).filter((stop) => favoriteIds.includes(stop.id));
  const selectedStop = board.stopsData?.find((stop) => stop.id === board.selectedStopMeta?.id);
  const activeTripIds = new Set<string>();
  for (const vehicle of feed.vehicles?.vehicles ?? []) {
    if (vehicle.tripId) activeTripIds.add(vehicle.tripId);
  }
  const vehicleSelection = selectionRef.current;
  const toggleFavorite = useCallback((stopId: string) => {
    setFavoriteIds((current) => {
      const next = current.includes(stopId)
        ? current.filter((id) => id !== stopId)
        : [...current, stopId];
      writeFavorites(next);
      return next;
    });
  }, []);

  return (
    <>
      <div style={{ position: "relative", width: "100%", height: "100%" }}>
        <div ref={map.mapContainer} style={{ width: "100%", height: "100%" }} />
        {map.mapError !== null && <MapUnavailableBox message={map.mapError} />}
        <StaleDataIndicator lastUpdateTime={feed.lastUpdateTime} />

        <div className="search-wrap">
          <SearchBox
            stops={board.stopsData}
            favorites={favoriteStops}
            resolveStopLines={board.resolveStopLines}
            activeTripIds={activeTripIds}
            linesLive={feed.vehicles != null}
            onToggleFavorite={toggleFavorite}
            onSelectStation={(stop) => {
              board.selectStop({ id: stop.id, name: stop.name });
              map.mapRef.current?.flyTo({ center: [stop.lon, stop.lat], zoom: 16 });
            }}
            onSelectLine={(routeId) => {
              applyFilter({ selection: new Set([routeId]), enabled: true });
              const stop = board.stopsData?.find((s) => s.routeIds.includes(routeId));
              if (stop) map.mapRef.current?.flyTo({ center: [stop.lon, stop.lat], zoom: 15 });
            }}
          />
        </div>

        <div className="ctrl-stack">
          <HelpControl />
          <NewsControl hasUnseen={news.hasUnseen} onOpen={news.openNews} loading={false} />
          <InfoControl onOpen={() => setShowInfo(true)} />
          <ThemeControl
            theme={theme}
            onToggle={() => setTheme((current) => current === "dark" ? "light" : "dark")}
          />
          <LanguageControl />
          <FilterControl
            selectionSize={filterState.selection.size}
            enabled={filterState.enabled}
            filterHidesAll={filterHidesAll}
            onToggle={(enabled) => applyFilter({ ...filterState, enabled })}
            onOpen={() => setShowFilter(true)}
          />
        </div>
        <StopSheet
          meta={board.selectedStopMeta}
          departures={board.selectedStopDepartures}
          loading={board.stopLoading}
          favorite={board.selectedStopMeta != null && favoriteIds.includes(board.selectedStopMeta.id)}
          note={selectedStop?.when ?? ""}
          onToggleFavorite={() => {
            if (board.selectedStopMeta) toggleFavorite(board.selectedStopMeta.id);
          }}
          onPickDeparture={(row) => {
            const vehicle = findSelectedVehicle(feed.vehiclesRef.current?.vehicles ?? [], {
              key: "",
              vehicleId: null,
              tripId: row.tripId,
              routeId: row.routeId,
              shapeId: null,
            });
            if (!vehicle) return;
            board.selectVehicle(vehicle);
            const lat = vehicle.lat[vehicle.lat.length - 1];
            const lon = vehicle.lon[vehicle.lon.length - 1];
            if (lat != null && lon != null) {
              map.mapRef.current?.flyTo({ center: [lon, lat], zoom: 16 });
            }
          }}
          onClose={board.deselectAll}
        />
        {board.sheetKind === "vehicle" && vehicleSelection !== null && board.selectedStopMeta === null && (
          <VehicleSheet
            routeId={vehicleSelection.routeId}
            destination={board.vehicleDestination}
            onClose={board.deselectAll}
          />
        )}
      </div>

      {showInfo && <InfoOverlay onClose={() => setShowInfo(false)} />}
      {news.newsOpen !== "hidden" && (
        <NewsOverlay snapshot={news.news} state={news.newsOpen} onClose={() => news.setNewsOpen("hidden")} />
      )}
      {showFilter && (
        <FilterOverlay
          smallStaticData={smallStaticData}
          state={filterState}
          onClose={() => setShowFilter(false)}
          onChange={applyFilter}
        />
      )}
    </>
  );
}
