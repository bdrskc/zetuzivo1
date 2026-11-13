// Info panel: sources, licenses, privacy, and an explicit unofficial notice.

import { useEffect, useRef, useState } from "react";
import { Overlay } from "./Overlay";
import { FeedbackForm } from "./Feedback";
import { useI18n } from "./i18n";
import type { Theme } from "./theme";

export function ThemeControl(props: { theme: Theme; onToggle: () => void }) {
  const { t } = useI18n();
  const dark = props.theme === "dark";
  const label = dark ? t.themeLight : t.themeDark;
  return (
    <div className="maplibregl-ctrl maplibregl-ctrl-group">
      <button
        type="button"
        className="maplibregl-ctrl-icon vozlinia-ctrl"
        title={label}
        aria-label={label}
        onClick={props.onToggle}
      >
        {dark ? (
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <circle cx="10" cy="10" r="3.2" />
            <path d="M10 2.5v1.8M10 15.7v1.8M2.5 10h1.8M15.7 10h1.8M4.4 4.4l1.3 1.3M14.3 14.3l1.3 1.3M15.6 4.4l-1.3 1.3M5.7 14.3l-1.3 1.3" />
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 11.2A6.2 6.2 0 0 1 8.8 4 6.4 6.4 0 1 0 16 11.2z" />
          </svg>
        )}
      </button>
    </div>
  );
}

export function LanguageControl() {
  const { lang, setLang, t } = useI18n();
  const next = lang === "hr" ? "en" : "hr";
  return (
    <div className="maplibregl-ctrl maplibregl-ctrl-group">
      <button
        type="button"
        className="maplibregl-ctrl-icon vozlinia-ctrl lang-mark"
        title={t.langTitle}
        aria-label={t.langTitle}
        onClick={() => setLang(next)}
      >
        {next.toUpperCase()}
      </button>
    </div>
  );
}

export function HelpControl() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  return (
    <div className="help-wrap" ref={rootRef}>
      <div className="maplibregl-ctrl maplibregl-ctrl-group">
        <button
          type="button"
          className="maplibregl-ctrl-icon vozlinia-ctrl help-mark"
          title={t.helpTitle}
          aria-label={t.helpTitle}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          ?
        </button>
      </div>
      {open && (
        <div className="help-card" role="dialog" aria-label={t.helpTitle}>
          <div className="help-title">{t.helpTitle}</div>
          <ol>
            <li>{t.help1}</li>
            <li>{t.help2}</li>
            <li>{t.help3}</li>
            <li>{t.help4}</li>
            <li>{t.help5}</li>
          </ol>
        </div>
      )}
    </div>
  );
}

export const REPO_URL = "https://github.com/ikicic/vozlinija";

function ExternalLink(props: { href: string; children: React.ReactNode }) {
  return (
    <a href={props.href} target="_blank" rel="noopener noreferrer" className="link">
      {props.children}
    </a>
  );
}

export function InfoControl(props: { onOpen: () => void }) {
  const { t } = useI18n();
  return (
    <div className="maplibregl-ctrl maplibregl-ctrl-group vozlinia-info-button">
      <button
        type="button"
        className="maplibregl-ctrl-icon vozlinia-ctrl"
        title={t.info}
        aria-label={t.info}
        onClick={props.onOpen}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 20 20">
          <path d="M4 10a6 6 0 1 0 12 0 6 6 0 1 0-12 0m5-3a1 1 0 1 0 2 0 1 1 0 1 0-2 0m0 3a1 1 0 1 1 2 0v3a1 1 0 1 1-2 0" />
        </svg>
      </button>
    </div>
  );
}

export function InfoOverlay({ onClose }: { onClose: () => void }) {
  const { lang } = useI18n();
  const en = lang === "en";
  return (
    <Overlay onClose={onClose}>
      <h3>ZET uživo</h3>
      {en ? (
        <>
          <p>
            Live positions of ZET trams and buses in Zagreb. This app is{" "}
            <b>unofficial and independent of ZET</b>, and it is not connected to zet.skoljka.org.
          </p>
          <p>
            It includes public-sector information under the{" "}
            <ExternalLink href="https://data.gov.hr/otvorena-dozvola">Open Licence</ExternalLink>
            .<br />
            Vehicle data:{" "}
            <ExternalLink href="https://www.zet.hr/odredbe/datoteke-u-gtfs-formatu/669">ZET GTFS</ExternalLink>
            {" · "}
            <ExternalLink href="https://www.zet.hr/gtfs-rt-protobuf">GTFS-Realtime</ExternalLink>
          </p>
          <p>
            Interactive map:{" "}
            <ExternalLink href="https://maplibre.org/">MapLibre GL JS</ExternalLink>
          </p>
          <p>
            Map data:{" "}
            <ExternalLink href="https://openfreemap.org/">OpenFreeMap</ExternalLink>
            {" | "}
            <ExternalLink href="https://openmaptiles.org/">OpenMapTiles</ExternalLink>
            {" | "}
            <ExternalLink href="https://www.openstreetmap.org/">OpenStreetMap</ExternalLink>
          </p>
          <p>
            <ExternalLink href={REPO_URL}>GitHub (ZET uživo source)</ExternalLink>
            {" | "}
            <ExternalLink href="/privacy.html">Privacy</ExternalLink>
          </p>
          <p>
            <i>
              Behaviour follows the public project{" "}
              <ExternalLink href="https://github.com/ikicic/zet">ikicic/zet</ExternalLink>{" "}
              (BSD-3-Clause).
            </i>
          </p>
          <hr className="feedback-separator" />
          <FeedbackForm />
          <p className="unofficial-notice">
            <i>
              Note: ZET uživo is unofficial and independent of ZET. For timetable
              information please contact{" "}
              <a href="https://www.zet.hr/kontakti-276/276">ZET</a>.
            </i>
          </p>
        </>
      ) : (
        <>
          <p>
            Prikazuje uživo položaje ZET-ovih tramvaja i autobusa. Aplikacija je{" "}
            <b>neslužbena i neovisna o ZET-u</b>; nije povezana ni sa zet.skoljka.org.
          </p>
          <p>
            Sadrži informacije tijela javne vlasti u skladu s{" "}
            <ExternalLink href="https://data.gov.hr/otvorena-dozvola">Otvorenom dozvolom</ExternalLink>
            .<br />
            Podaci o vozilima:{" "}
            <ExternalLink href="https://www.zet.hr/odredbe/datoteke-u-gtfs-formatu/669">ZET GTFS</ExternalLink>
            {" · "}
            <ExternalLink href="https://www.zet.hr/gtfs-rt-protobuf">GTFS-Realtime</ExternalLink>
          </p>
          <p>
            Interaktivna karta:{" "}
            <ExternalLink href="https://maplibre.org/">MapLibre GL JS</ExternalLink>
          </p>
          <p>
            Podaci za kartu:{" "}
            <ExternalLink href="https://openfreemap.org/">OpenFreeMap</ExternalLink>
            {" | "}
            <ExternalLink href="https://openmaptiles.org/">OpenMapTiles</ExternalLink>
            {" | "}
            <ExternalLink href="https://www.openstreetmap.org/">OpenStreetMap</ExternalLink>
          </p>
          <p>
            <ExternalLink href={REPO_URL}>GitHub (izvorni kod ZET uživo)</ExternalLink>
            {" | "}
            <ExternalLink href="/privacy.html">Pravila privatnosti</ExternalLink>
          </p>
          <p>
            <i>
              Ponašanje aplikacije usklađeno je s javnim projektom{" "}
              <ExternalLink href="https://github.com/ikicic/zet">ikicic/zet</ExternalLink>{" "}
              (BSD-3-Clause).
            </i>
          </p>
          <hr className="feedback-separator" />
          <FeedbackForm />
          <p className="unofficial-notice">
            <i>
              Napomena: ZET uživo je neslužbena aplikacija, neovisna o ZET-u. Za
              informacije o voznom redu molimo kontaktirajte{" "}
              <a href="https://www.zet.hr/kontakti-276/276">ZET</a>.
            </i>
          </p>
        </>
      )}
    </Overlay>
  );
}
