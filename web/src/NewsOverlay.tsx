// ZET news / notifications: snapshot types, unread badge, overlay.

import { Overlay } from "./Overlay";
import { useI18n } from "./i18n";

export const NEWS_SEEN_VERSION_KEY = "vozlinija-news-seen-version-v1";

export type NewsKind = "traffic" | "news" | "app";

export interface NewsItem {
  id: string;
  kind: NewsKind;
  publishedAt: number;
  title: string;
  summaryHtml: string;
  url: string | null;
}

export interface NewsSnapshot {
  version: string;
  fetchedAt: number;
  items: NewsItem[];
}

export interface NewsStatus {
  version: string;
  latestAt: number | null;
}

const MAX_NEWS_TIMESTAMP = 4102444800; // 2100-01-01

function newsKindLabel(kind: NewsKind, t: ReturnType<typeof useI18n>["t"]): string {
  switch (kind) {
    case "traffic":
      return t.newsTraffic;
    case "app":
      return t.newsApp;
    case "news":
      return t.newsZet;
  }
}

export function formatNewsDate(publishedAt: number, lang: "hr" | "en" = "hr"): string {
  const date = new Date(publishedAt * 1000);
  return date.toLocaleString(lang === "en" ? "en-GB" : "hr-HR", {
    timeZone: "Europe/Zagreb",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function isNewsStatus(value: unknown): value is NewsStatus {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "news-status" &&
    typeof (value as { version?: unknown }).version === "string"
  );
}

function isSafeSummaryHtml(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 8192) return false;
  const document = new DOMParser().parseFromString(value, "text/html");
  const safeTags = new Set(["strong", "b", "em", "i", "br", "p", "ul", "ol", "li"]);
  let safe = true;
  const walk = (node: Node): boolean => {
    for (const child of childNodes(node)) {
      if (child.nodeType === Node.TEXT_NODE) continue;
      if (child.nodeType !== Node.ELEMENT_NODE) return false;
      const element = child as Element;
      if (!safeTags.has(element.tagName.toLowerCase()) || element.attributes.length !== 0) {
        return false;
      }
      if (!walk(child)) return false;
    }
    return true;
  };
  return safe && walk(document.body);

  function childNodes(root: Node): Node[] {
    return Array.from(root.childNodes);
  }
}

export function isNewsSnapshot(value: unknown): value is NewsSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const snapshot = value as { type?: unknown; version?: unknown; items?: unknown };
  if (snapshot.type !== "news" || typeof snapshot.version !== "string") return false;
  if (!Array.isArray(snapshot.items)) return false;
  for (const item of snapshot.items) {
    if (typeof item !== "object" || item === null) return false;
    const record = item as Record<string, unknown>;
    if (typeof record.id !== "string") return false;
    if (record.kind !== "traffic" && record.kind !== "news" && record.kind !== "app") {
      return false;
    }
    if (
      typeof record.publishedAt !== "number" ||
      !Number.isFinite(record.publishedAt) ||
      record.publishedAt < 0 ||
      record.publishedAt > MAX_NEWS_TIMESTAMP
    ) {
      return false;
    }
    if (typeof record.title !== "string") return false;
    if (!isSafeSummaryHtml(record.summaryHtml)) return false;
    if (record.url !== null && (typeof record.url !== "string" || record.url.length > 2048)) {
      return false;
    }
  }
  return true;
}

export function NewsControl(props: {
  hasUnseen: boolean;
  loading: boolean;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="maplibregl-ctrl maplibregl-ctrl-group vozlinia-news-button">
      <button
        type="button"
        className="maplibregl-ctrl-icon vozlinia-ctrl"
        title={t.news}
        aria-label={t.news}
        disabled={props.loading}
        onClick={props.onOpen}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="14" height="14" rx="1.5" />
          <path d="M6 7h3v3H6zM11 7h3M11 10h3M6 13h8" />
        </svg>
      </button>
      <span className={`vozlinia-news-dot ${props.hasUnseen ? "" : "hidden"}`} hidden={!props.hasUnseen} />
    </div>
  );
}

export function NewsOverlay(props: {
  snapshot: NewsSnapshot | null;
  state: "ready" | "error" | "empty" | "hidden";
  onClose: () => void;
}) {
  const { snapshot, state, onClose } = props;
  const { lang, t } = useI18n();
  const items = snapshot?.items ?? [];
  return (
    <Overlay onClose={onClose} className="news-overlay-content" showCloseButton={false}>
      <div className="news-overlay">
        <div className="news-header">
          <h3>{t.news}</h3>
          <button type="button" className="news-close-button" onClick={onClose} aria-label={t.newsClose}>
            ✕
          </button>
        </div>
        {state === "error" ? (
          <p>{t.newsError}</p>
        ) : state === "empty" || items.length === 0 ? (
          <p>{t.newsEmpty}</p>
        ) : (
          <div className="news-list">
            {items.map((item) => (
              <article key={item.id} className={`news-item news-item-${item.kind}`}>
                <div className="news-item-kind">{newsKindLabel(item.kind, t)}</div>
                {item.url ? (
                  <a href={item.url} target="_blank" rel="noopener noreferrer">
                    {item.title}
                  </a>
                ) : (
                  <div className="news-item-title">{item.title}</div>
                )}
                <time>{formatNewsDate(item.publishedAt, lang)}</time>
                {item.summaryHtml !== "" && (
                  <div className="news-item-summary" dangerouslySetInnerHTML={{ __html: item.summaryHtml }} />
                )}
              </article>
            ))}
          </div>
        )}
      </div>
    </Overlay>
  );
}
