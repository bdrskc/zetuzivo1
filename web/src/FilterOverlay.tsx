// Filter controls and overlay. Tram vs bus: route id with <=2 characters is a
// tram, 3+ is a bus (the same rule as the upstream client; never assume length
// a priori, see docs/PROTOCOL.md).

import { useEffect, useRef } from "react";
import type { RouteId, SmallStaticData } from "./protocol";
import { Overlay } from "./Overlay";
import type { FilterState } from "./filterState";
import { isTram } from "./mapLayers";
import { useI18n } from "./i18n";

export function categorizeRoutes(routeIds: RouteId[]) {
  const trams: RouteId[] = [];
  const buses: RouteId[] = [];
  for (const routeId of routeIds) {
    if (isTram(routeId)) trams.push(routeId);
    else buses.push(routeId);
  }
  return { trams, buses };
}

function triState(selection: Set<RouteId>, subset: RouteId[]): "checked" | "unchecked" | "partial" {
  const count = subset.filter((r) => selection.has(r)).length;
  if (count === 0) return "unchecked";
  if (count === subset.length) return "checked";
  return "partial";
}

export function FilterControl(props: {
  selectionSize: number;
  enabled: boolean;
  filterHidesAll: boolean;
  onToggle: (enabled: boolean) => void;
  onOpen: () => void;
}) {
  const { selectionSize, enabled, filterHidesAll, onToggle, onOpen } = props;
  const { t } = useI18n();
  const visible = selectionSize > 0;
  const className = [
    "maplibregl-ctrl",
    "maplibregl-ctrl-group",
    "vozlinia-filter-button",
    filterHidesAll ? "no-markers" : "",
    visible && enabled ? "active" : "",
  ].filter(Boolean).join(" ");

  return (
    <>
      {visible && (
        <label className="filter-switch">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => onToggle(event.target.checked)}
            aria-label={t.filterToggle}
          />
          <span className="slider" />
        </label>
      )}
      <div className={className}>
        <button type="button" className="maplibregl-ctrl-icon vozlinia-ctrl" title={t.filter} aria-label={t.filter} onClick={onOpen}>
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 5h10l-3.5 5v5l-3 1v-6z" />
          </svg>
        </button>
      </div>
    </>
  );
}

function CategoryRow(props: {
  label: string;
  subset: RouteId[];
  selection: Set<RouteId>;
  onChange: (selection: Set<RouteId>) => void;
}) {
  const { label, subset, selection, onChange } = props;
  const state = triState(selection, subset);
  const checkboxRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (checkboxRef.current) checkboxRef.current.indeterminate = state === "partial";
  }, [state]);

  const toggle = () => {
    const next = new Set(selection);
    if (state === "checked") subset.forEach((r) => next.delete(r));
    else subset.forEach((r) => next.add(r));
    onChange(next);
  };

  return (
    <label className="filter-category">
      <input ref={checkboxRef} type="checkbox" checked={state === "checked"} onChange={toggle} />
      <span>{label}</span>
    </label>
  );
}

export function FilterOverlay(props: {
  smallStaticData: SmallStaticData | null;
  state: FilterState;
  onClose: () => void;
  onChange: (state: FilterState) => void;
}) {
  const { smallStaticData, state, onClose, onChange } = props;
  const { t } = useI18n();
  const routeIds = smallStaticData?.routeIds ?? [];
  const { trams, buses } = categorizeRoutes(routeIds);

  const setSelection = (next: Set<RouteId>) => {
    onChange({ selection: next, enabled: state.enabled || next.size > 0 });
  };

  return (
    <Overlay onClose={onClose}>
      <h3>{t.filterTitle}</h3>
      {smallStaticData === null ? (
        <p>{t.loadingRoutes}</p>
      ) : routeIds.length === 0 ? (
        <p>{t.noRoutes}</p>
      ) : (
        <>
          <CategoryRow label={t.trams} subset={trams} selection={state.selection} onChange={setSelection} />
          <CategoryRow label={t.buses} subset={buses} selection={state.selection} onChange={setSelection} />

          <div className="filter-route-list">
            {routeIds.map((routeId) => (
              <label key={routeId} className="filter-route">
                <input
                  type="checkbox"
                  checked={state.selection.has(routeId)}
                  onChange={() => {
                    const next = new Set(state.selection);
                    if (next.has(routeId)) next.delete(routeId);
                    else next.add(routeId);
                    setSelection(next);
                  }}
                />
                <span className={`filter-route-id ${isTram(routeId) ? "tram" : "bus"}`}>{routeId}</span>
              </label>
            ))}
          </div>

          <div className="filter-actions">
            <button type="button" className="filter-reset" onClick={() => setSelection(new Set())}>
              {t.reset}
            </button>
          </div>
        </>
      )}
    </Overlay>
  );
}
