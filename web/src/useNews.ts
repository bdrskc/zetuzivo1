import { useCallback, useEffect, useRef, useState } from "react";
import { getHttpUrl } from "./url";
import {
  NEWS_SEEN_VERSION_KEY,
  isNewsSnapshot,
  isNewsStatus,
  type NewsSnapshot,
  type NewsStatus,
} from "./NewsOverlay";

export type NewsOpen = "ready" | "error" | "empty" | "hidden";

/** News badge, snapshot fetch, and the socket messages that update them. */
export function useNews() {
  const [newsStatus, setNewsStatus] = useState<NewsStatus | null>(null);
  const [news, setNews] = useState<NewsSnapshot | null>(null);
  const [seenVersion, setSeenVersion] = useState<string | null>(() => {
    try {
      return window.localStorage.getItem(NEWS_SEEN_VERSION_KEY);
    } catch {
      return null;
    }
  });
  const seenVersionRef = useRef(seenVersion);
  const [newsOpen, setNewsOpen] = useState<NewsOpen>("hidden");

  const handleMessage = useCallback((data: unknown): boolean => {
    if (isNewsStatus(data)) {
      if (seenVersionRef.current === null) {
        seenVersionRef.current = data.version;
        setSeenVersion(data.version);
      }
      setNewsStatus(data);
      return true;
    }
    if (isNewsSnapshot(data)) {
      setNews(data);
      setNewsOpen("ready");
      seenVersionRef.current = data.version;
      setSeenVersion(data.version);
      return true;
    }
    return false;
  }, []);

  const openNews = useCallback(() => {
    if (news !== null && news.version === newsStatus?.version) {
      setNewsOpen("ready");
      return;
    }
    const url = getHttpUrl("news?schema=2");
    void fetch(url, { cache: "no-cache" })
      .then(async (response) => {
        if (response.status === 204) {
          setNews(null);
          setNewsOpen("empty");
          return;
        }
        const data: unknown = await response.json();
        if (isNewsSnapshot(data)) {
          setNews(data);
          setNewsOpen("ready");
          seenVersionRef.current = data.version;
          setSeenVersion(data.version);
        } else {
          setNewsOpen("error");
        }
      })
      .catch(() => setNewsOpen("error"));
  }, [news, newsStatus]);

  useEffect(() => {
    try {
      if (seenVersion === null) window.localStorage.removeItem(NEWS_SEEN_VERSION_KEY);
      else window.localStorage.setItem(NEWS_SEEN_VERSION_KEY, seenVersion);
    } catch {
      // ignore
    }
  }, [seenVersion]);

  const hasUnseen = newsStatus !== null && seenVersion !== newsStatus.version;

  return { news, newsOpen, setNewsOpen, openNews, hasUnseen, handleMessage };
}
