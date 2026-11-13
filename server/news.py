"""ZET news / notifikacije: RSS fetch, sanitizacija, snapshots.

Reproduces the observable behaviour of the upstream `ikicic/zet` news cache
(BSD-3-Clause) with new code. See docs/PROTOCOL.md.
"""

from __future__ import annotations

from dataclasses import dataclass
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from xml.etree import ElementTree

import datetime
import hashlib
import html
import json
import logging
import os
import re
import threading
import time

logger = logging.getLogger(__name__)

# --- Bounds (mirror the upstream limits) ------------------------------------
NEWS_FETCH_INTERVAL_SECONDS = 5 * 60
RSS_FETCH_TIMEOUT_SECONDS = 15
MAX_RSS_RESPONSE_BYTES = 256 * 1024
MAX_RSS_ITEMS_PER_FEED = 100
DEFAULT_APP_NEWS_FILE = "app_news.json"
MAX_APP_NEWS_FILE_BYTES = 64 * 1024
MAX_APP_NEWS_ITEMS = 30
RSS_FEEDS: tuple[tuple[str, str], ...] = (
    ("traffic", "https://www.zet.hr/rss_promet.aspx"),
    ("news", "https://www.zet.hr/rss_novosti.aspx"),
)
MAX_NEWS_ITEMS = 30
MAX_NEWS_TITLE_LENGTH = 250
MAX_NEWS_URL_LENGTH = 2048
MAX_NEWS_SUMMARY_SOURCE_LENGTH = 4096
MAX_NEWS_SUMMARY_HTML_LENGTH = 8192
MIN_NEWS_TIMESTAMP = 0
MAX_NEWS_TIMESTAMP = 4_102_444_800  # 2100-01-01
NEWS_SCHEMA_V1 = 1
NEWS_SCHEMA_V2 = 2

ALLOWED_SUMMARY_TAGS = {"strong", "b", "em", "i", "br", "p", "ul", "ol", "li"}
DROP_CONTENT_TAGS = {"iframe", "object", "script", "style", "template"}
BLOCK_TAGS = {"article", "blockquote", "div", "footer", "h1", "h2", "h3",
              "h4", "h5", "h6", "header", "section"}


class HtmlTextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)

    def text(self) -> str:
        return " ".join(" ".join(self.parts).split())


def html_to_text(value: str) -> str:
    parser = HtmlTextExtractor()
    parser.feed(html.unescape(value))
    return parser.text()


class SafeHtmlExtractor(HTMLParser):
    """Keep only harmless presentation tags from RSS descriptions."""

    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self.open_tags: list[str] = []
        self.dropped_content_tag: str | None = None

    def handle_starttag(self, tag: str, attrs) -> None:
        if self.dropped_content_tag is not None:
            return
        if tag in DROP_CONTENT_TAGS:
            self.dropped_content_tag = tag
            return
        if tag in BLOCK_TAGS:
            self._append_line_break()
        if tag == "br":
            self.parts.append("<br>")
        elif tag in ALLOWED_SUMMARY_TAGS:
            self.parts.append(f"<{tag}>")
            self.open_tags.append(tag)

    def handle_startendtag(self, tag: str, attrs) -> None:
        if self.dropped_content_tag is not None:
            return
        if tag == "br":
            self.parts.append("<br>")

    def handle_endtag(self, tag: str) -> None:
        if tag == self.dropped_content_tag:
            self.dropped_content_tag = None
            return
        if self.dropped_content_tag is not None:
            return
        if tag in ALLOWED_SUMMARY_TAGS and tag in self.open_tags:
            self.parts.append(f"</{tag}>")
            self.open_tags.remove(tag)

    def handle_data(self, data: str) -> None:
        if self.dropped_content_tag is not None:
            return
        if data:
            self.parts.append(html.escape(data))

    def _append_line_break(self) -> None:
        rendered = self.sanitized_html()
        if not rendered.endswith("<br>"):
            self.parts.append("<br>")

    def sanitized_html(self) -> str:
        for tag in reversed(self.open_tags):
            self.parts.append(f"</{tag}>")
        self.open_tags = []
        return "".join(self.parts)

def sanitize_rss_html(value: str) -> str:
    try:
        parser = SafeHtmlExtractor()
        parser.feed(html.unescape(value))
        parser.close()
        return parser.sanitized_html()
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Could not sanitize RSS HTML; using plain text: %s", exc)
        return html.escape(html_to_text(value))


def limit_summary_html(value: str) -> str:
    if len(value) <= MAX_NEWS_SUMMARY_HTML_LENGTH:
        return value
    # Preserve the bound even for text that expands when escaped.
    return html.escape(html_to_text(value)[:MAX_NEWS_SUMMARY_HTML_LENGTH // 6])


def news_item_id(kind: str, published_at: int, title: str,
                 summary_html: str, url: str | None) -> str:
    message = json.dumps(
        [kind, published_at, title, summary_html, url],
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode()
    return hashlib.sha256(message).hexdigest()[:32]


def is_zet_url(value: str) -> bool:
    from urllib.parse import urlparse
    parsed = urlparse(value)
    return parsed.scheme == "https" and parsed.hostname in {"zet.hr", "www.zet.hr"}


def is_https_url(value: str) -> bool:
    from urllib.parse import urlparse
    parsed = urlparse(value)
    return parsed.scheme == "https" and parsed.hostname is not None


def fetch_rss_bytes(url: str) -> bytes:
    request = Request(url, headers={"User-Agent": "ZET-uzivo/1.0 (nesluzbeno, read-only)"})
    with urlopen(request, timeout=RSS_FETCH_TIMEOUT_SECONDS) as response:
        return response.read(MAX_RSS_RESPONSE_BYTES + 1)[:MAX_RSS_RESPONSE_BYTES]


@dataclass
class NewsItem:
    id: str
    kind: str
    published_at: int
    title: str
    summary_html: str
    url: str | None

    def to_json(self) -> dict:
        return {
            "id": self.id,
            "kind": self.kind,
            "publishedAt": self.published_at,
            "title": self.title,
            "summaryHtml": self.summary_html,
            "url": self.url,
        }


class NewsCache:
    def __init__(self, app_news_path: str = DEFAULT_APP_NEWS_FILE) -> None:
        self._app_news_path = app_news_path
        self._app_news_path_is_explicit = os.environ.get(
            "VOZLINIA_APP_NEWS_FILE") is not None
        self._lock = threading.Lock()
        self._items_by_kind: dict[str, list[NewsItem]] = {
            kind: [] for kind, _ in RSS_FEEDS}
        self._items_by_kind["app"] = []
        self._items_by_schema: dict[int, list[NewsItem]] = {
            NEWS_SCHEMA_V1: [], NEWS_SCHEMA_V2: []}
        self._versions_by_schema: dict[int, str] = {
            NEWS_SCHEMA_V1: "", NEWS_SCHEMA_V2: ""}
        self._fetched_at = 0

    def refresh(self) -> bool:
        fetched: dict[str, list[NewsItem]] = {}
        for kind, url in RSS_FEEDS:
            try:
                fetched[kind] = self._parse_feed(url, kind)
            except Exception as exc:
                logger.warning("Failed to fetch %s RSS feed (%s): %s",
                               kind, url, exc)
        try:
            fetched["app"] = self._parse_app_news(self._app_news_path)
        except FileNotFoundError:
            if self._app_news_path_is_explicit:
                logger.warning("Failed to read app news file (%s)",
                               self._app_news_path)
            else:
                fetched["app"] = []
        except Exception as exc:
            logger.warning("Failed to read app news file (%s): %s",
                           self._app_news_path, exc)

        if not fetched:
            return False

        with self._lock:
            items_by_kind = dict(self._items_by_kind)
        items_by_kind.update(fetched)

        def combine(kinds: tuple[str, ...]) -> list[NewsItem]:
            combined = sorted(
                [item for kind in kinds for item in items_by_kind[kind]],
                key=lambda item: (item.published_at, item.id), reverse=True)
            unique = list(
                {item.id: item for item in reversed(combined)}.values())
            return list(reversed(unique))

        schema_v1_items = combine(("traffic", "news"))[:MAX_NEWS_ITEMS]
        combined_items = combine(("traffic", "news", "app"))
        if os.environ.get("VOZLINIA_DEV") == "1":
            now = int(time.time())
            combined_items.insert(0, NewsItem(
                id=f"dev-news-{now}", kind="app", published_at=now,
                title="Testna obavijest",
                summary_html="<strong>Test:</strong> nova obavijest s poslužitelja.",
                url=None))
        schema_v2_items = combined_items[:MAX_NEWS_ITEMS]

        items_by_schema = {
            NEWS_SCHEMA_V1: schema_v1_items,
            NEWS_SCHEMA_V2: schema_v2_items,
        }
        versions_by_schema = {
            schema: self._items_version(schema_items)
            for schema, schema_items in items_by_schema.items()
        }
        with self._lock:
            self._items_by_kind = items_by_kind
            changed = versions_by_schema != self._versions_by_schema
            self._items_by_schema = items_by_schema
            self._versions_by_schema = versions_by_schema
            self._fetched_at = int(time.time())
            if changed:
                logger.info("News changed: %d items in snapshot",
                            len(schema_v2_items))
            return changed

    @staticmethod
    def _items_version(items: list[NewsItem]) -> str:
        encoded = json.dumps(
            [item.to_json() for item in items],
            ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
        return hashlib.sha256(encoded).hexdigest()[:16]


    def _parse_feed(self, url: str, kind: str) -> list[NewsItem]:
        raw = fetch_rss_bytes(url)
        root = ElementTree.fromstring(raw)
        channel = root.find("channel")
        if channel is None:
            raise ValueError("RSS feed has no <channel>")
        item_nodes = channel.findall("item")
        if len(item_nodes) > MAX_RSS_ITEMS_PER_FEED:
            logger.warning("RSS feed has %d items; parsing first %d",
                           len(item_nodes), MAX_RSS_ITEMS_PER_FEED)
        items: list[NewsItem] = []
        for node in item_nodes[:MAX_RSS_ITEMS_PER_FEED]:
            title = html_to_text(node.findtext("title", default=""))[:MAX_NEWS_TITLE_LENGTH]
            link = node.findtext("link", default="").strip()
            published = node.findtext("pubDate", default="").strip()
            if (not title or not link or not published
                    or len(link) > MAX_NEWS_URL_LENGTH
                    or not is_zet_url(link)):
                continue
            try:
                published_at = int(parsedate_to_datetime(published).timestamp())
            except (TypeError, ValueError, IndexError):
                logger.warning("Skipping RSS item with invalid date: %s", published)
                continue
            if not MIN_NEWS_TIMESTAMP <= published_at <= MAX_NEWS_TIMESTAMP:
                logger.warning("Skipping RSS item with out-of-range date: %s",
                               published)
                continue
            summary_html = limit_summary_html(sanitize_rss_html(
                node.findtext("description", default="")
                [:MAX_NEWS_SUMMARY_SOURCE_LENGTH]))
            items.append(NewsItem(
                id=news_item_id(kind, published_at, title, summary_html, link),
                kind=kind,
                published_at=published_at,
                title=title,
                summary_html=summary_html,
                url=link,
            ))
        if item_nodes and not items:
            raise ValueError("RSS feed has items but none passed validation")
        return items

    def _parse_app_news(self, path: str) -> list[NewsItem]:
        with open(path, "rb") as file:
            raw_data = file.read(MAX_APP_NEWS_FILE_BYTES + 1)
        if len(raw_data) > MAX_APP_NEWS_FILE_BYTES:
            raise ValueError("app news file exceeds size limit")
        raw_items = json.loads(raw_data)
        if not isinstance(raw_items, list):
            raise ValueError("app news file must contain a JSON array")
        if len(raw_items) > MAX_APP_NEWS_ITEMS:
            raise ValueError("app news file contains more than 30 items")

        items: list[NewsItem] = []
        allowed_keys = {"publishedAt", "title", "summary", "url"}
        for index, raw_item in enumerate(raw_items):
            if not isinstance(raw_item, dict):
                raise ValueError(f"app news item {index} must be an object")
            unknown_keys = set(raw_item) - allowed_keys
            if unknown_keys:
                raise ValueError(
                    f"app news item {index} has unknown fields: "
                    f"{', '.join(sorted(unknown_keys))}")
            published = raw_item.get("publishedAt")
            title = raw_item.get("title")
            summary = raw_item.get("summary", "")
            url = raw_item.get("url")
            if not isinstance(published, str):
                raise ValueError("app news item %d publishedAt must be a string" % index)
            if not isinstance(title, str) or not title.strip():
                raise ValueError("app news item %d title must be non-empty" % index)
            if len(title) > MAX_NEWS_TITLE_LENGTH:
                raise ValueError("app news item %d title is too long" % index)
            if not isinstance(summary, str):
                raise ValueError("app news item %d summary must be a string" % index)
            if len(summary) > MAX_NEWS_SUMMARY_SOURCE_LENGTH:
                raise ValueError("app news item %d summary is too long" % index)
            if url is not None and (
                    not isinstance(url, str)
                    or len(url) > MAX_NEWS_URL_LENGTH
                    or not is_https_url(url)):
                raise ValueError(
                    "app news item %d url must be null or an HTTPS URL" % index)


            if url is not None and (
                    not isinstance(url, str)
                    or len(url) > MAX_NEWS_URL_LENGTH
                    or not is_https_url(url)):
                raise ValueError(
                    "app news item %d url must be null or an HTTPS URL" % index)
            try:
                published_dt = datetime.datetime.fromisoformat(published)
            except ValueError as exc:
                raise ValueError(
                    "app news item %d has invalid publishedAt" % index) from exc
            if published_dt.tzinfo is None or published_dt.utcoffset() is None:
                raise ValueError(
                    "app news item %d publishedAt must include a timezone" % index)
            published_at = int(published_dt.timestamp())
            if not MIN_NEWS_TIMESTAMP <= published_at <= MAX_NEWS_TIMESTAMP:
                raise ValueError("app news item %d publishedAt is out of range" % index)
            title = " ".join(title.split())
            summary_html = limit_summary_html(
                html.escape(summary).replace("\r\n", "\n")
                .replace("\r", "\n").replace("\n", "<br>"))
            items.append(NewsItem(
                id=news_item_id("app", published_at, title, summary_html, url),
                kind="app",
                published_at=published_at,
                title=title,
                summary_html=summary_html,
                url=url,
            ))
        return items

    def snapshot(self, schema: int = NEWS_SCHEMA_V1):
        with self._lock:
            version = self._versions_by_schema[schema]
            items = list(self._items_by_schema[schema])
            if not version:
                return None
            fetched_at = self._fetched_at
        message = json.dumps({"type": "news", "version": version,
                              "fetchedAt": fetched_at,
                              "items": [item.to_json() for item in items]},
                             separators=(",", ":"))
        return version, message

    def status_message(self, schema: int = NEWS_SCHEMA_V1):
        with self._lock:
            version = self._versions_by_schema[schema]
            items = self._items_by_schema[schema]
            if not version:
                return None
            latest_at = items[0].published_at if items else None
        return json.dumps({"type": "news-status", "version": version,
                           "latestAt": latest_at}, separators=(",", ":"))

