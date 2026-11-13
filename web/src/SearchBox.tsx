// Search box for stations and lines (new code; see docs/DEVIATIONS.md).
import { useEffect, useMemo, useRef, useState } from "react";
import type { RouteId } from "./protocol";
import type { StopInfo } from "./stops";
import type { StopLineDests } from "./eta";
import { isTram } from "./mapLayers";
import { useI18n, whenLabel } from "./i18n";

function ModeIcon({ tram }: { tram: boolean }) {
  if (tram) {
    return (
      <svg className="mode-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 5.5h10M9 5.5V8M15 5.5V8" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <rect x="4.5" y="8" width="15" height="8" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
        <path d="M4.5 12.2h15" fill="none" stroke="currentColor" strokeWidth="1.7" />
        <circle cx="8" cy="18.2" r="1.35" fill="currentColor" />
        <circle cx="16" cy="18.2" r="1.35" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg className="mode-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="4.5" width="17" height="11" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3.5 9.5h17M8 4.5v5" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="8" cy="18" r="1.5" fill="currentColor" />
      <circle cx="16" cy="18" r="1.5" fill="currentColor" />
    </svg>
  );
}

function stopHasTram(stop: StopInfo): boolean {
  return stop.routeIds.some((routeId) => isTram(routeId));
}

export interface SearchBoxProps {
  stops: StopInfo[] | null;
  favorites: StopInfo[];
  /** Resolve the destination lines for a stop (fetched lazily, cached). */
  resolveStopLines: (stopId: string) => Promise<StopLineDests[]>;
  /** Trip ids that have a vehicle on the road right now. */
  activeTripIds: ReadonlySet<string>;
  /** False until the first live feed arrives, so chips are not all grey. */
  linesLive: boolean;
  onToggleFavorite: (stopId: string) => void;
  onSelectStation: (stop: StopInfo) => void;
  onSelectLine: (routeId: RouteId) => void;
}

export function SearchBox({
  stops,
  favorites,
  resolveStopLines,
  activeTripIds,
  linesLive,
  onToggleFavorite,
  onSelectStation,
  onSelectLine,
}: SearchBoxProps) {
  const { lang, t } = useI18n();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [favOpen, setFavOpen] = useState(false);
  const [linesByStop, setLinesByStop] = useState<Record<string, StopLineDests[] | null>>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const trimmed = query.trim().toLowerCase();

  useEffect(() => {
    if (!open && !favOpen) return;
    const onDocMouseDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
        setFavOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open, favOpen]);

  const matchedStops = useMemo(() => {
    if (!trimmed || !stops) return [];
    return stops.filter((stop) => stop.name.toLowerCase().includes(trimmed));
  }, [trimmed, stops]);

  const stationResults = useMemo(() => matchedStops.slice(0, 6), [matchedStops]);
  const tramStops = useMemo(
    () => matchedStops.filter((stop) => stopHasTram(stop)).slice(0, 5),
    [matchedStops],
  );
  const busStops = useMemo(
    () => matchedStops.filter((stop) => stop.routeIds.length > 0 && !stopHasTram(stop)).slice(0, 5),
    [matchedStops],
  );

  const lineResults = useMemo(() => {
    if (!trimmed || !stops) return [];
    const seen = new Set<RouteId>();
    const lines: RouteId[] = [];
    for (const stop of stops) {
      for (const routeId of stop.routeIds) {
        if (!seen.has(routeId) && String(routeId).toLowerCase().includes(trimmed)) {
          seen.add(routeId);
          lines.push(routeId);
        }
      }
    }
    return lines.sort((a, b) => a - b);
  }, [trimmed, stops]);
  const tramLines = lineResults.filter((routeId) => isTram(routeId)).slice(0, 6);
  const busLines = lineResults.filter((routeId) => !isTram(routeId)).slice(0, 6);

  useEffect(() => {
    const list = favOpen ? favorites : open ? [...tramStops, ...busStops] : [];
    if (list.length === 0) return;
    let cancelled = false;
    for (const stop of list) {
      if (stop.id in linesByStop) continue;
      void resolveStopLines(stop.id).then((lines) => {
        if (!cancelled) setLinesByStop((prev) => ({ ...prev, [stop.id]: lines }));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [open, favOpen, favorites, tramStops, busStops, linesByStop, resolveStopLines]);

  const showResults = open && trimmed.length > 0 &&
    (tramStops.length > 0 || busStops.length > 0 || tramLines.length > 0 || busLines.length > 0);

  const chooseStation = (stop: StopInfo) => {
    onSelectStation(stop);
    setQuery("");
    setOpen(false);
    setFavOpen(false);
  };
  const chooseLine = (routeId: RouteId) => {
    onSelectLine(routeId);
    setQuery("");
    setOpen(false);
    setFavOpen(false);
  };

  const lineChips = (stop: StopInfo) => {
    const lines = linesByStop[stop.id];
    const hasDestinations = lines != null && lines.some((line) => line.destinations.length > 0);
    if (lines == null) {
      if (stop.routeIds.length === 0) {
        return <span className="search-station-loading">{t.loadingLines}</span>;
      }
      return stop.routeIds.map((routeId) => (
        <span key={routeId} className={`search-line${isTram(routeId) ? "" : " bus"}`}>{routeId}</span>
      ));
    }
    if (!hasDestinations) {
      return (
        <span className="search-station-loading">
          {stop.routeIds.length > 0 ? `${t.linesPrefix}: ${stop.routeIds.join(", ")}` : t.noLinesToday}
        </span>
      );
    }
    const chips = lines.flatMap((line) =>
      line.destinations.map((destination) => ({
        key: `${line.routeId}:${destination.name}`,
        routeId: line.routeId,
        name: destination.name,
        running: !linesLive || destination.tripIds.some((id) => activeTripIds.has(id)),
      })),
    );
    const active = chips.filter((chip) => chip.running);
    const idle = chips.filter((chip) => !chip.running);
    const chipNode = (chip: (typeof chips)[number]) => (
      <span key={chip.key} className={`fav-chip${chip.running ? "" : " off"}`}>
        <span className={`search-line${isTram(chip.routeId) ? "" : " bus"}${chip.running ? "" : " off"}`}>{chip.routeId}</span>
        {chip.name}
      </span>
    );
    return (
      <>
        {active.map(chipNode)}
        {active.length > 0 && idle.length > 0 ? <span className="fav-split" /> : null}
        {idle.map(chipNode)}
      </>
    );
  };

  const favoriteIds = useMemo(() => new Set(favorites.map((stop) => stop.id)), [favorites]);

  const stopCard = (stop: StopInfo) => {
    const favorite = favoriteIds.has(stop.id);
    return (
      <div
        key={stop.id}
        className="fav-stop"
        role="button"
        tabIndex={0}
        onClick={() => chooseStation(stop)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            chooseStation(stop);
          }
        }}
      >
        <span className="fav-stop-body">
          <span className="fav-stop-name">
            {stop.name}
            {stop.when ? <span className="search-when"> · {whenLabel(stop.when, lang)}</span> : null}
          </span>
          <span className="fav-lines">{lineChips(stop)}</span>
        </span>
        <button
          type="button"
          className={`stop-star${favorite ? " on" : ""}`}
          aria-pressed={favorite}
          aria-label={favorite ? t.removeFav : t.addFav}
          onClick={(event) => {
            event.stopPropagation();
            onToggleFavorite(stop.id);
          }}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {favorite ? "★" : "☆"}
        </button>
      </div>
    );
  };

  return (
    <div className="search-box" ref={rootRef}>
      <div className="search-row">
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setFavOpen(false);
          }}
          onFocus={() => {
            setOpen(true);
            setFavOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
            if (event.key === "Enter" && stationResults.length > 0) {
              chooseStation(stationResults[0]);
            } else if (event.key === "Enter" && lineResults.length > 0) {
              chooseLine(lineResults[0]);
            }
          }}
          placeholder={t.searchPlaceholder}
          aria-label={t.searchLabel}
        />
        <button
          type="button"
          className={`fav-button${favorites.length > 0 || favOpen ? " on" : ""}`}
          aria-pressed={favOpen}
          aria-label={t.favoritesAria}
          onClick={() => {
            setFavOpen((openNow) => !openNow);
            setOpen(false);
          }}
        >
          ★
          {favorites.length > 0 && <span className="fav-count">{favorites.length}</span>}
        </button>
      </div>
      {favOpen && (
        <div className="search-results search-results-tall">
          <div className="search-group">{t.favorites}</div>
          {favorites.length === 0 ? (
            <div className="search-station-loading">
              {t.favoritesEmpty}
            </div>
          ) : (
            favorites.map((stop) => stopCard(stop))
          )}
        </div>
      )}
      {showResults && (
        <div className="search-results">
          {(tramStops.length > 0 || tramLines.length > 0) && (
            <div className="search-block tram">
              <div className="search-mode tram"><ModeIcon tram /> {t.tram}</div>
              {tramStops.length > 0 && (
                <>
                  <div className="search-group">{t.stops}</div>
                  {tramStops.map((stop) => stopCard(stop))}
                </>
              )}
              {tramLines.length > 0 && (
                <>
                  <div className="search-group">{t.lines}</div>
                  {tramLines.map((routeId) => (
                    <button key={routeId} className="search-item" onClick={() => chooseLine(routeId)}>
                      <span className="search-line">{routeId}</span>
                      <span className="search-name">{t.line} {routeId}</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
          {(busStops.length > 0 || busLines.length > 0) && (
            <div className="search-block bus">
              <div className="search-mode bus"><ModeIcon tram={false} /> {t.bus}</div>
              {busStops.length > 0 && (
                <>
                  <div className="search-group">{t.stops}</div>
                  {busStops.map((stop) => stopCard(stop))}
                </>
              )}
              {busLines.length > 0 && (
                <>
                  <div className="search-group">{t.lines}</div>
                  {busLines.map((routeId) => (
                    <button key={`bus-${routeId}`} className="search-item" onClick={() => chooseLine(routeId)}>
                      <span className="search-line bus">{routeId}</span>
                      <span className="search-name">{t.line} {routeId}</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
