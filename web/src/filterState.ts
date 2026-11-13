import type { RouteId } from "./protocol";

const FAVORITES_KEY = "vozlinija-favorites";

export function readFavorites(): string[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : [];
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function writeFavorites(ids: string[]): void {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(ids));
}

const FILTER_STORAGE_KEY = "vozlinija-filter-state";
const LOCATION_TRACKING_ENABLED_KEY = "vozlinija-location-tracking-enabled";

export interface FilterState {
  selection: Set<RouteId>;
  enabled: boolean;
}

export function readFilterState(): FilterState {
  try {
    const raw = window.localStorage.getItem(FILTER_STORAGE_KEY);
    if (!raw) return { selection: new Set(), enabled: false };
    const parsed = JSON.parse(raw);
    return {
      selection: new Set(parsed.selection as number[]),
      enabled: Boolean(parsed.enabled),
    };
  } catch {
    return { selection: new Set(), enabled: false };
  }
}

export function writeFilterState(state: FilterState): void {
  try {
    window.localStorage.setItem(
      FILTER_STORAGE_KEY,
      JSON.stringify({ selection: [...state.selection], enabled: state.enabled }),
    );
  } catch {
    // ignore storage errors
  }
}

export function readLocationTracking(): boolean {
  try {
    return window.localStorage.getItem(LOCATION_TRACKING_ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeLocationTracking(enabled: boolean): void {
  try {
    if (enabled) window.localStorage.setItem(LOCATION_TRACKING_ENABLED_KEY, "1");
    else window.localStorage.removeItem(LOCATION_TRACKING_ENABLED_KEY);
  } catch {
    // ignore
  }
}
