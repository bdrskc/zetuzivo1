import { useEffect, useState, type ReactNode } from "react";
import { minutesText, type StopDepartureRow } from "./eta";
import { isTram } from "./mapLayers";
import { useI18n, whenLabel, type Copy } from "./i18n";

const BOARD_PREVIEW = 5;

function lateText(late: number | null, t: Copy): string | null {
  if (late == null || Math.abs(late) < 60) return null;
  const mins = Math.round(Math.abs(late) / 60);
  return late > 0 ? t.later(mins) : t.earlier(mins);
}

function boardRows(rows: StopDepartureRow[], elapsed: number): StopDepartureRow[] {
  const best = new Map<string, StopDepartureRow>();
  for (const row of rows) {
    if (row.seconds == null) continue;
    const seconds = row.seconds - elapsed;
    const key = `${row.routeId}|${row.headsign ?? ""}`;
    const prev = best.get(key);
    if (prev == null || seconds < (prev.seconds ?? Number.POSITIVE_INFINITY)) {
      best.set(key, { ...row, seconds: Math.max(0, seconds) });
    }
  }
  return [...best.values()]
    .sort((a, b) =>
      (a.seconds ?? Number.POSITIVE_INFINITY) - (b.seconds ?? Number.POSITIVE_INFINITY) ||
      a.routeId - b.routeId,
    );
}
function SheetHeader(props: {
  kicker: string;
  title: string;
  onClose: () => void;
  favorite?: boolean;
  onToggleFavorite?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="sheet-header">
      <div>
        <div className="sheet-kicker">{props.kicker}</div>
        <div className="sheet-title">{props.title}</div>
      </div>
      <div className="sheet-header-actions">
        {props.onToggleFavorite && (
          <button
            className={`sheet-close${props.favorite ? " on" : ""}`}
            onClick={props.onToggleFavorite}
            aria-label={props.favorite ? t.removeFav : t.addFav}
            aria-pressed={props.favorite}
          >
            {props.favorite ? "★" : "☆"}
          </button>
        )}
        <button className="sheet-close" onClick={props.onClose} aria-label={t.close}>×</button>
      </div>
    </div>
  );
}

export function StopSheet(props: {
  meta: { id: string; name: string } | null;
  departures: StopDepartureRow[] | null;
  loading: boolean;
  favorite: boolean;
  note: string;
  onToggleFavorite: () => void;
  onPickDeparture: (row: StopDepartureRow) => void;
  onClose: () => void;
}): ReactNode {
  const { lang, t } = useI18n();
  const [elapsed, setElapsed] = useState(0);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    setElapsed(0);
    setExpanded(false);
    if (!props.meta) return;
    const started = Date.now();
    const id = window.setInterval(() => setElapsed((Date.now() - started) / 1000), 10000);
    return () => window.clearInterval(id);
  }, [props.meta, props.departures]);

  if (!props.meta) return null;
  const rows = props.departures ? boardRows(props.departures, elapsed) : [];
  const visible = expanded ? rows : rows.slice(0, BOARD_PREVIEW);
  let body: React.ReactNode;
  if (props.loading) {
    body = <div className="sheet-muted">{t.loadingArrivals}</div>;
  } else if (rows.length === 0) {
    body = (
      <div className="sheet-muted">
        {props.note
          ? t.noVehiclesNote(whenLabel(props.note, lang))
          : t.noVehicles}
      </div>
    );
  } else {
    body = (
      <div className="sheet-groups">
        {visible.map((row) => {
          const soon = (row.seconds ?? 0) < 60;
          const late = lateText(row.late, t);
          return (
            <button
              type="button"
              key={`${row.routeId}:${row.headsign ?? ""}:${row.tripId}`}
              className="sheet-row"
              onClick={() => props.onPickDeparture(row)}
            >
              <span className={`sheet-line ${isTram(row.routeId) ? "tram" : "bus"}`}>{row.routeId}</span>
              <span className="sheet-text">
                <span className="sheet-dest">{row.headsign ?? t.noHeadsign}</span>
                <span className="sheet-meta">
                  {[row.kind === "live" ? t.live : null, row.clock ? `${t.plan} ${row.clock}` : null]
                    .filter(Boolean)
                    .join(" · ")}
                  {late ? (
                    <span className={row.late != null && row.late > 0 ? " sheet-late" : ""}>
                      {`${row.kind === "live" || row.clock ? " · " : ""}${late}`}
                    </span>
                  ) : null}
                </span>
              </span>
              <span className={`sheet-eta${soon ? " soon" : ""}`}>
                {row.seconds != null ? minutesText(row.seconds, t.now) : t.now}
              </span>
            </button>
          );
        })}
        {rows.length > BOARD_PREVIEW && (
          <button className="sheet-more" onClick={() => setExpanded((open) => !open)}>
            {expanded ? t.less : t.more(rows.length - BOARD_PREVIEW)}
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="stop-sheet">
      <SheetHeader
        kicker={t.station}
        title={props.meta.name}
        favorite={props.favorite}
        onToggleFavorite={props.onToggleFavorite}
        onClose={props.onClose}
      />
      {body}
    </div>
  );
}

export function VehicleSheet(props: {
  routeId: number;
  destination: string | null;
  onClose: () => void;
}): ReactNode {
  const { t } = useI18n();
  const tram = isTram(props.routeId);
  return (
    <div className="stop-sheet">
      <div className="sheet-header">
        <div className="sheet-vehicle">
          <span className={`sheet-line ${tram ? "tram" : "bus"}`}>{props.routeId}</span>
          <div>
            <div className="sheet-kicker">{tram ? t.tram : t.bus}</div>
            <div className="sheet-title">{props.destination ?? "…"}</div>
          </div>
        </div>
        <button className="sheet-close" onClick={props.onClose} aria-label={t.close}>×</button>
      </div>
    </div>
  );
}

export function MapUnavailableBox({ message }: { message: string }) {
  const { t } = useI18n();
  const text = message === "webgl" ? t.mapError : message;
  return (
    <main className="map-unavailable">
      <div>
        <h1>ZET uživo</h1>
        <p>{text}</p>
        <p>{t.unofficialBox}</p>
      </div>
    </main>
  );
}
