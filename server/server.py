#!/usr/bin/env python3
"""ZET uživo backend: GTFS/GTFS-RT fetch + HTTP + WebSocket, one process.

Serves the frontend, the static GTFS-derived JSON, the realtime vehicle
state over /ws-v1..v4, and the ZET news feed. See docs/ARCHITECTURE.md and
docs/PROTOCOL.md.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote, urljoin, urlsplit
from zoneinfo import ZoneInfo

import argparse
import asyncio
import datetime
import json
import logging
import os
import random
import re
import threading
import time

from google.transit import gtfs_realtime_pb2

from server.codec import STATIC_REFERENCE_SYSTEM
from server.news import (
    NEWS_FETCH_INTERVAL_SECONDS,
    NEWS_SCHEMA_V1,
    NEWS_SCHEMA_V2,
    NewsCache,
)
from server.state import RealtimeState, ParsedFeed
from server.staticdata import StaticDataSnapshot, compact_json
from server.transports import HttpMessage, VozLiniaConnection

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- Tunables (mirror the upstream server behaviour) -------------------------
MAX_RECENT_STATIC_SNAPSHOTS = 3
REALTIME_STALE_THRESHOLD = 120  # seconds, server-side staleness notice
REALTIME_FETCH_INTERVAL_SECONDS = 10
STATIC_FETCH_INTERVAL_SECONDS = 3600
UNCHANGED_BACKOFF = 1.01
MIN_UNCHANGED_DELAY = 1.0
MAX_UNCHANGED_DELAY = 10.0
FETCH_TIMEOUT_SECONDS = 30
MAX_CLIENTS = 200
WS_PING_INTERVAL_SECONDS = 30
WS_IDLE_SECONDS = 180

REALTIME_URL = "https://www.zet.hr/gtfs-rt-protobuf"
LATEST_STATIC_URL = "https://www.zet.hr/gtfs-scheduled/latest"
OLD_STATIC_LIST_URL = "https://www.zet.hr/gtfs2"
OLD_STATIC_URL_REGEX = r'href="(/gtfs-scheduled/scheduled-000-[0-9]+\.zip)"'
OLD_STATIC_COUNT = 2

ROOT = Path(__file__).resolve().parent.parent
DIST_DIR = ROOT / "web" / "dist"
TEMPLATE_APP_NEWS = ROOT / "app_news.json"


@dataclass
class WsClient:
    ws: object
    version: int

    def __hash__(self) -> int:
        return id(self)


@dataclass
class WsOutputMessageVariants:
    version0: str
    version1: str
    version2: str

    @staticmethod
    def from_realtime_state(state: RealtimeState) -> "WsOutputMessageVariants":
        json_v1 = state.to_json_v1()
        return WsOutputMessageVariants(
            version0=compact_json(state.to_json_v0()),
            version1=compact_json(json_v1),
            version2=compact_json(state.to_json_v2()),
        )

    def for_version(self, version: int) -> str:
        if version <= 0:
            return self.version0
        if version == 1:
            return self.version1
        return self.version2

class GtfsServer:
    """Owns the realtime state, static snapshots, news cache and WS clients."""

    def __init__(
        self,
        *,
        realtime_url: str = REALTIME_URL,
        latest_static_url: str = LATEST_STATIC_URL,
        old_static_list_url: str = OLD_STATIC_LIST_URL,
        old_static_url_regex: str = OLD_STATIC_URL_REGEX,
        old_static_count: int = OLD_STATIC_COUNT,
        app_news_path: Path = TEMPLATE_APP_NEWS,
    ) -> None:
        self.realtime_url = realtime_url
        self.latest_static_url = latest_static_url
        self.old_static_list_url = old_static_list_url
        self.old_static_url_regex = old_static_url_regex
        self.old_static_count = old_static_count

        self.realtime_state = RealtimeState(
            vehicles={}, timestamp=0, active_static_key=None)
        self.recent_static_snapshots: list[StaticDataSnapshot] = []
        self.latest_message: WsOutputMessageVariants | None = None
        self.clients: set[WsClient] = set()
        self.news_cache = NewsCache(app_news_path=str(app_news_path))

        self.last_realtime_update: float = 0.0
        self._static_fetched_at: datetime.datetime | None = None
        self._realtime_bytes: bytes | None = None
        self._stop_index_cache: dict[tuple[str, str], object] = {}
        self._stop_services_cache: dict[tuple, str] = {}
        self._static_lock = threading.Lock()
        self._index_lock = threading.Lock()
        self.replay_loop: object = None  # set by start_replay()

    # ------------------------------------------------------------- feed intake
    def process_feed(self, feed: ParsedFeed) -> WsOutputMessageVariants:
        if os.environ.get("VOZLINIA_DEV") == "1":
            # Occasionally age a position to exercise gray markers and recovery.
            for vehicle in feed.vehicles:
                if random.random() < 0.1:
                    vehicle.timestamp -= random.randint(60, 900)

        # Match the feed date, including when replaying historical data.
        feed_date = datetime.datetime.fromtimestamp(
            feed.timestamp, ZoneInfo("Europe/Zagreb")).date()
        with self._static_lock:
            snapshots = list(self.recent_static_snapshots)
        active_static_snapshot: StaticDataSnapshot | None = None
        for snapshot in reversed(snapshots):
            if (snapshot.static_data is not None and
                    feed_date in snapshot.static_data.calendar_dates):
                active_static_snapshot = snapshot
                break
        self.realtime_state.update(feed, active_static_snapshot)
        message = WsOutputMessageVariants.from_realtime_state(self.realtime_state)
        self.latest_message = message
        self.last_realtime_update = time.time()
        return message

    def process_feed_bytes(self, raw_data: bytes) -> bool:
        feed = gtfs_realtime_pb2.FeedMessage()
        feed.ParseFromString(raw_data)
        parsed = ParsedFeed.from_protobuf(feed)
        if parsed is None:
            return False
        self.process_feed(parsed)
        return True

    def process_static(self, raw_data: bytes) -> StaticDataSnapshot | None:
        snapshot = StaticDataSnapshot.from_zip_data(raw_data, STATIC_REFERENCE_SYSTEM)
        with self._static_lock:
            self.recent_static_snapshots.append(snapshot)
            while len(self.recent_static_snapshots) > MAX_RECENT_STATIC_SNAPSHOTS:
                self.recent_static_snapshots.pop(0)
        logger.info("Processed static data: key=%s shapes=%d routes=%d",
                    snapshot.key,
                    len(snapshot.static_data.shapes),
                    len(snapshot.static_data.route_ids))
        try:
            with open("/tmp/vozlinija-static-cache.zip", "wb") as cache:
                cache.write(raw_data)
        except OSError:
            pass
        # Warm today's schedule index off the request path.
        self.stop_index(snapshot.key)
        return snapshot

    def _load_static_cache(self) -> None:
        """Last good timetable, so a rate-limit on startup still shows vehicles."""
        if self.recent_static_snapshots:
            return
        for path in ("/tmp/vozlinija-static-cache.zip", "/tmp/gtfs-398.zip"):
            try:
                with open(path, "rb") as cache:
                    raw = cache.read()
            except OSError:
                continue
            if not raw:
                continue
            try:
                self.process_static(raw)
                logger.info("Loaded cached static data from %s", path)
                return
            except Exception as exc:
                logger.error("Cached static data failed: %s", exc)

    def active_static_snapshot(self, key: str) -> StaticDataSnapshot | None:
        with self._static_lock:
            for snapshot in self.recent_static_snapshots:
                if snapshot.key == key:
                    return snapshot
        return None

    def handle_request(self, method: str, path: str,
                       headers: dict[str, str]) -> HttpMessage:
        """HTTP entry point called by the transport."""
        return handle_http_request(self, method, path, headers)

    async def handle_request_async(self, method: str, path: str,
                                   headers: dict[str, str]) -> HttpMessage:
        """Stop indexes parse a GTFS zip; keep that off the event loop."""
        if path.startswith("/static/stop"):
            return await asyncio.to_thread(self.handle_request, method, path, headers)
        return self.handle_request(method, path, headers)

    def stop_index(self, key: str, date: datetime.date | None = None):
        """Per-day StopIndex for `key`, filtered from the parsed schedule."""
        snapshot = self.active_static_snapshot(key)
        if snapshot is None or snapshot.schedule is None:
            return None
        if date is None:
            date = datetime.datetime.now(ZoneInfo("Europe/Zagreb")).date()
        cache_key = (key, date.isoformat())
        with self._index_lock:
            cached = self._stop_index_cache.get(cache_key)
            if cached is not None:
                return cached
        logger.info("Building stop index for %s (%s)…", key[:12], date)
        index = snapshot.schedule.index_for(date)
        with self._index_lock:
            existing = self._stop_index_cache.get(cache_key)
            if existing is not None:
                return existing
            self._stop_index_cache = {
                k: v for k, v in self._stop_index_cache.items()
                if k[1] == date.isoformat()}
            self._stop_index_cache[cache_key] = index
        logger.info("Stop index ready: %d trips, %d stops",
                    len(index.trips), len(index.stops))
        return index

    def stop_services_json(self, key: str, stop_id: str) -> str | None:
        """Per-stop services, without trips that already finished.

        Cached per stop and per 5-minute bucket so a search does not rebuild
        the same JSON, and so a finished trip drops out without waiting all day.
        """
        index = self.stop_index(key)
        if index is None:
            return None
        now = datetime.datetime.now(ZoneInfo("Europe/Zagreb"))
        now_secs = now.hour * 3600 + now.minute * 60 + now.second
        bucket = now_secs // 300
        cache_key = (key, index.date.isoformat(), stop_id, bucket)
        with self._index_lock:
            cached = self._stop_services_cache.get(cache_key)
            if cached is not None:
                self._stop_services_cache.pop(cache_key, None)
                self._stop_services_cache[cache_key] = cached
                return cached
        payload = index.stop_services_json(stop_id, now_secs=now_secs)
        if payload is None:
            return None
        encoded = compact_json(payload)
        with self._index_lock:
            self._stop_services_cache[cache_key] = encoded
            while len(self._stop_services_cache) > 400:
                del self._stop_services_cache[next(iter(self._stop_services_cache))]
        return encoded

    def trip_label_json(self, key: str, trip_id: str) -> str | None:
        """Line number and destination for a trip. Stable for the service day."""
        index = self.stop_index(key)
        if index is None:
            return None
        label = index.trip_label(trip_id)
        if label is None:
            return None
        return compact_json(label)


    # ----------------------------------------------------------------- clients
    async def client_connected(self, conn, version: int,
                               app_updates: bool = False) -> None:
        if len(self.clients) >= MAX_CLIENTS:
            logger.warning("Refusing WebSocket client (cap %d)", MAX_CLIENTS)
            conn.close()
            return
        client = WsClient(ws=conn, version=version)
        self.clients.add(client)
        logger.info("Client connected (ws-v%d). Number of clients: %d",
                    version, len(self.clients))
        try:
            if app_updates:
                release = release_message()
                if release is not None:
                    conn.send_text(release)
            if self.latest_message is not None:
                conn.send_text(self.latest_message.for_version(version))
            if version >= 3:
                schema = NEWS_SCHEMA_V2 if version >= 4 else NEWS_SCHEMA_V1
                status = self.news_cache.status_message(schema)
                if status is not None:
                    conn.send_text(status)
            await conn.closed  # keep the connection until the client closes
        finally:
            self.clients.discard(client)
            logger.info("Client removed. Total clients: %d", len(self.clients))

    async def broadcast_real_time(self) -> None:
        message = self.latest_message
        if message is None:
            return
        dead: set[WsClient] = set()
        for client in list(self.clients):
            try:
                client.ws.send_text(message.for_version(client.version))
            except Exception:
                dead.add(client)
        self.clients -= dead

    async def broadcast_news_status(self) -> None:
        v1 = self.news_cache.status_message(NEWS_SCHEMA_V1)
        v2 = self.news_cache.status_message(NEWS_SCHEMA_V2)
        dead: set[WsClient] = set()
        for client in list(self.clients):
            try:
                message = (v2 if client.version >= 4
                           else v1 if client.version >= 3 else None)
                if message is not None:
                    client.ws.send_text(message)
            except Exception:
                dead.add(client)
        self.clients -= dead


    # ---------------------------------------------------------------- fetching
    async def run_fetch_loop(self) -> None:
        """Fetch static data at startup, then realtime data with backoff."""
        try:
            await self._fetch_old_static()
            await self._maybe_fetch_static()
        except Exception as exc:  # never crash the server
            logger.error("Initial static fetch failed: %s", exc)
            self._load_static_cache()

        unchanged_delay = MIN_UNCHANGED_DELAY
        current_delay = 0.0
        while True:
            try:
                raw = await asyncio.to_thread(self.fetch_url, self.realtime_url)
            except Exception as exc:
                logger.error("Realtime fetch failed: %s", exc)
                current_delay = min(current_delay * 2 if current_delay else 1.0, 20)
                await asyncio.sleep(current_delay)
                continue

            new_snapshot = raw != self._realtime_bytes
            self._realtime_bytes = raw
            if new_snapshot:
                logger.info("Fetched realtime data (%d bytes)", len(raw))
                try:
                    self.process_feed_bytes(raw)
                except Exception as exc:
                    logger.error("Error processing realtime data: %s", exc)
                await self.broadcast_real_time()
                current_delay = REALTIME_FETCH_INTERVAL_SECONDS - 1
                unchanged_delay = MIN_UNCHANGED_DELAY
            else:
                unchanged_delay = min(
                    unchanged_delay * UNCHANGED_BACKOFF, MAX_UNCHANGED_DELAY)
                current_delay = unchanged_delay

            try:
                if await self._maybe_fetch_static():
                    current_delay = 0
            except Exception as exc:
                logger.error("Static fetch failed: %s", exc)
            await asyncio.sleep(max(0.0, current_delay))

    async def _fetch_old_static(self) -> None:
        """Download the previous static snapshots as well, because the latest
        one may only cover future dates."""
        if not self.old_static_list_url or not self.old_static_url_regex:
            return
        list_html = await asyncio.to_thread(
            self.fetch_url, self.old_static_list_url)
        matches = re.findall(self.old_static_url_regex,
                             list_html.decode("ascii", "replace"))
        if not matches:
            raise ValueError("No static data URLs found in list page")
        urls = sorted(set(matches))[-self.old_static_count:]
        for path in urls:
            url = urljoin(self.old_static_list_url, path)
            logger.info("Fetching old static data: %s", url)
            raw = await asyncio.to_thread(self.fetch_url, url)
            await asyncio.to_thread(self.process_static, raw)

    async def _maybe_fetch_static(self) -> bool:
        now = datetime.datetime.now()
        if (self._static_fetched_at is not None and
                now - self._static_fetched_at <
                datetime.timedelta(seconds=STATIC_FETCH_INTERVAL_SECONDS)):
            return False
        self._static_fetched_at = now
        logger.info("Fetching static GTFS data: %s", self.latest_static_url)
        raw = await asyncio.to_thread(self.fetch_url, self.latest_static_url)
        await asyncio.to_thread(self.process_static, raw)
        return True

    @staticmethod
    def fetch_url(url: str) -> bytes:
        from urllib.request import Request, urlopen
        request = Request(url, headers={"User-Agent": "ZET-uzivo/1.0 (nesluzbeno, read-only)"})
        with urlopen(request, timeout=FETCH_TIMEOUT_SECONDS) as response:
            return response.read()

    async def run_news_loop(self) -> None:
        while True:
            try:
                if self.news_cache.refresh():
                    await self.broadcast_news_status()
            except Exception as exc:
                logger.error("News refresh failed: %s", exc)
            await asyncio.sleep(NEWS_FETCH_INTERVAL_SECONDS)

    async def run_staleness_loop(self) -> None:
        while True:
            if self.last_realtime_update and \
                    time.time() - self.last_realtime_update > REALTIME_STALE_THRESHOLD:
                logger.warning(
                    "No realtime update for %d seconds",
                    int(time.time() - self.last_realtime_update))
            await asyncio.sleep(30)

    async def run_ws_keepalive(self) -> None:
        """Ping clients and drop ones that never answer. A dead TCP connection
        otherwise stays in the set until a later broadcast fails."""
        while True:
            await asyncio.sleep(WS_PING_INTERVAL_SECONDS)
            now = time.monotonic()
            dead: set[WsClient] = set()
            for client in list(self.clients):
                conn = client.ws
                idle = now - getattr(conn, "last_activity", now)
                if idle > WS_IDLE_SECONDS:
                    dead.add(client)
                    try:
                        conn.close()
                    except Exception:
                        pass
                    continue
                try:
                    conn.send_ping()
                except Exception:
                    dead.add(client)
            self.clients -= dead


# ------------------------------------------------------------ HTTP + WS routes


def _response(status: int, body: bytes, content_type: str,
              cache_control: str | None = None,
              extra_headers: list[tuple[str, str]] | None = None) -> HttpMessage:
    return HttpMessage(status=status, body=body, content_type=content_type,
                       cache_control=cache_control,
                       extra_headers=extra_headers or [])


def _static_file(path: Path, content_type: str, cache_control: str) -> HttpMessage:
    try:
        body = path.read_bytes()
    except OSError:
        return _response(404, b"Not found", "text/plain; charset=utf-8")
    return _response(200, body, content_type, cache_control)


def _serve_frontend() -> HttpMessage:
    index = DIST_DIR / "index.html"
    if index.is_file():
        return _static_file(index, "text/html; charset=utf-8", "no-cache")
    body = """<!DOCTYPE html><html lang="hr"><head><meta charset="utf-8">
<title>ZET uživo</title></head><body>
<p>Frontend nije izgrađen. Pokrenite <code>npm run build</code> u <code>web/</code>
ili koristite razvojni poslužitelj: <a href="http://localhost:5173/">http://localhost:5173/</a></p>
</body></html>"""
    return _response(200, body.encode("utf-8"), "text/html; charset=utf-8", "no-cache")


def _asset(path: str) -> HttpMessage:
    # Serve hashed build assets; never follow ../ sequences.
    normalized = Path(*Path(path).parts[1:]) if path.startswith("/") else Path(path)
    candidate = (DIST_DIR / normalized).resolve()
    if not candidate.is_relative_to(DIST_DIR.resolve()):
        return _response(404, b"Not found", "text/plain; charset=utf-8")
    content_types = {
        ".js": "application/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json",
        ".html": "text/html; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".ico": "image/x-icon",
        ".map": "application/json",
        ".woff2": "font/woff2",
    }
    content_type = content_types.get(candidate.suffix,
                                     "application/octet-stream")
    cache = ("public, max-age=31536000, immutable"
             if candidate.name not in ("index.html", "version.json")
             else "no-cache")
    return _static_file(candidate, content_type, cache)


def _static_json(server: GtfsServer, path: str, small: bool) -> HttpMessage:
    key = path.strip("/").split("/")[-1]
    snapshot = server.active_static_snapshot(key)
    if snapshot is None:
        return _response(404, b"Unknown static key", "text/plain; charset=utf-8",
                         "no-cache")
    body = (snapshot.formatted_json_small if small
            else snapshot.formatted_json_big).encode("utf-8")
    return _response(200, body, "application/json", "public, max-age=5184000")


def handle_http_request(server: GtfsServer, method: str, path: str,
                        headers: dict[str, str]) -> HttpMessage:
    """Route a plain HTTP request to the appropriate handler."""
    if path == "/" or path == "/index.html":
        return _serve_frontend()
    if path == "/privacy.html":
        privacy = ROOT / "web" / "public" / "privacy.html"
        return _static_file(privacy, "text/html; charset=utf-8", "no-cache")
    if path == "/favicon.ico":
        return _response(404, b"", "image/x-icon")

    if path.startswith("/static/small/v0/") or path.startswith("/static/small/"):
        return _static_json(server, path, small=True)
    if path.startswith("/static/stop/v1/"):
        rest = path[len("/static/stop/v1/"):].split("/", 1)
        if len(rest) != 2:
            return _response(404, b"Bad stop path", "text/plain; charset=utf-8")
        key, raw_stop = rest[0], rest[1]
        stop_id = unquote(raw_stop.split("?")[0])
        logger.info("Stop services request: key=%s stop=%s", key[:12], stop_id)
        payload = server.stop_services_json(key, stop_id)
        if payload is None:
            return _response(404, b"Unknown static key or stop",
                             "text/plain; charset=utf-8", "no-cache")
        return _response(200, payload.encode("utf-8"), "application/json",
                         "public, max-age=60")
    if path.startswith("/static/stops/v1/"):
        key = path.strip("/").split("/")[-1]
        logger.info("Stops layer request: key=%s", key[:12])
        index = server.stop_index(key)
        if index is None:
            return _response(404, b"Unknown static key",
                             "text/plain; charset=utf-8", "no-cache")
        body = index.stops_layer_body().encode("utf-8")
        return _response(200, body, "application/json", "public, max-age=3600")
    if path.startswith("/static/trip/v1/"):
        rest = path[len("/static/trip/v1/"):].split("/", 1)
        if len(rest) != 2:
            return _response(404, b"Bad trip path", "text/plain; charset=utf-8")
        key, raw_trip = rest[0], rest[1]
        trip_id = unquote(raw_trip.split("?")[0])
        payload = server.trip_label_json(key, trip_id)
        if payload is None:
            return _response(404, b"Unknown trip", "text/plain; charset=utf-8", "no-cache")
        return _response(200, payload.encode("utf-8"), "application/json",
                         "public, max-age=3600")
    if path.startswith("/static/big/v1/") or path.startswith("/static/"):
        return _static_json(server, path, small=False)

    if path.startswith("/news"):
        return handle_news(server, headers, path)

    if path.startswith("/api/feedback"):
        return handle_feedback_stub()

    if path.startswith("/assets/"):
        return _asset(path)

    # Marker icons and other files from web/public are copied to dist/.
    # Docker only has that folder, so /tram-marker.png must be served here.
    if ".." not in path:
        frontend = _asset(path)
        if frontend.status != 404:
            return frontend

    return _response(404, b"Not found", "text/plain; charset=utf-8")


def handle_news(server: GtfsServer, headers: dict[str, str], path: str) -> HttpMessage:
    raw_schema = _query(path).get("schema")
    if raw_schema is None or raw_schema == str(NEWS_SCHEMA_V1):
        schema = NEWS_SCHEMA_V1
    elif raw_schema == str(NEWS_SCHEMA_V2):
        schema = NEWS_SCHEMA_V2
    else:
        return _response(400, b'{"error":"Unsupported news schema"}',
                         "application/json")
    snapshot = server.news_cache.snapshot(schema)
    if snapshot is None:
        return _response(204, b"", "text/plain; charset=utf-8", "no-cache")
    version, message = snapshot
    if headers.get("if-none-match") == version:
        return _response(304, b"", "text/plain; charset=utf-8", "private, no-cache")
    return _response(200, message.encode("utf-8"),
                     "application/json", "private, no-cache",
                     extra_headers=[("ETag", version)])


def _query(path: str) -> dict[str, str]:
    parts = urlsplit(path)
    query: dict[str, str] = {}
    if parts.query:
        for pair in parts.query.split("&"):
            if "=" in pair:
                key, value = pair.split("=", 1)
                query[key] = value
    return query


def handle_feedback_stub() -> HttpMessage:
    """Feedback is not implemented. Nothing is sent or stored, even if an
    SMTP host variable is present — that variable does not turn sending on."""
    return _response(501, json.dumps(
        {"error": "Slanje poruka nije ugrađeno. Ništa se ne šalje i ništa se ne sprema."})
        .encode("utf-8"),
        "application/json")


def release_message() -> str | None:
    """Announce the built frontend version over WebSocket, if available."""
    path = os.environ.get("VOZLINIA_FRONTEND_RELEASE_FILE",
                          str(DIST_DIR / "version.json"))
    try:
        with open(path, encoding="utf-8") as source:
            release = json.loads(source.read(4096))
        version = release.get("version")
        if not isinstance(version, str) or not re.fullmatch(r"[a-f0-9]{20}",
                                                            version):
            raise ValueError("invalid frontend version")
    except FileNotFoundError:
        return None
    except (OSError, ValueError) as exc:
        logger.warning("Cannot read frontend release %s: %s", path, exc)
        return None
    return json.dumps({"type": "app-version", "version": version},
                      separators=(",", ":"))


# ------------------------------------------------------------------ WebSocket

def _fixture_static_data(trip_to_shape_id: dict | None = None):
    """StaticData stub that matches any feed date around now (replay only)."""
    from server.staticdata import StaticData
    today = datetime.date.today()
    dates = {today + datetime.timedelta(days=d) for d in (-1, 0, 1)}
    return StaticData(trip_to_shape_id=trip_to_shape_id or {}, shapes={},
                      route_ids=[], calendar_dates=dates)


# ---------------------------------------------------------------------- replay

def advance_position(lat: float, lon: float, bearing_degrees: float | None,
                     meters: float):
    """Advance a point by `meters` in a compass bearing (0=N, 90=E).

    Used by replay mode to make recorded vehicles move convincingly; pure
    function so it can be unit-tested.
    """
    if bearing_degrees is None:
        bearing_degrees = 0.0
    import math
    rad = math.radians(bearing_degrees)
    d_lat = meters * math.cos(rad) / 111320.0
    d_lon = meters * math.sin(rad) / (111320.0 * math.cos(math.radians(lat)))
    return lat + d_lat, lon + d_lon


def start_replay(server: GtfsServer) -> None:
    """Serve recorded fixtures from testdata/ so development works offline.

    The recorded frame is replayed through the regular realtime pipeline with
    the feed timestamp shifted to the current time, keeping all relative
    (delta) structure intact; static fixtures are served by static key.
    """
    testdata = ROOT / "testdata"
    frame = json.loads(
        (testdata / "realtime-frame-0.json").read_text(encoding="utf-8"))
    active_key = frame.get("activeStaticKey")
    feed_timestamp = int(frame.get("timestamp", 0))
    vehicles = frame["vehicles"]
    count = len(vehicles["routeIds"])

    lats = [STATIC_REFERENCE_SYSTEM.decompress_lats(entry)
            for entry in vehicles["compressedLats"]]
    lons = [STATIC_REFERENCE_SYSTEM.decompress_lons(entry)
            for entry in vehicles["compressedLons"]]
    times = [feed_timestamp - delta for delta in vehicles["timestamps"]]

    snapshot = StaticDataSnapshot(
        key=active_key,
        static_data=_fixture_static_data(trip_to_shape_id={
            vehicles["tripIds"][i]: vehicles["shapeIds"][i]
            for i in range(count)}),
        formatted_json_big=(testdata / "static-big.json").read_text(encoding="utf-8"),
        formatted_json_small=(testdata / "static-small.json").read_text(encoding="utf-8"),
    )
    server.recent_static_snapshots.append(snapshot)
    logger.info("Replay mode: %d vehicles, static key %s", count, active_key)

    async def replay_loop() -> None:
        from server.state import ParsedVehicle
        import random

        # Current simulated position of every vehicle (starts at the last
        # recorded point of each trail). Vehicles advance along their recorded
        # heading each cycle so the demo visibly moves.
        cur_lat = [row[-1] for row in lats]
        cur_lon = [row[-1] for row in lons]
        relative_times = [max(5, min(30, feed_timestamp - t)) for t in times]

        while True:
            now = int(time.time())
            parsed = []
            for i in range(count):
                cur_lat[i], cur_lon[i] = advance_position(
                    cur_lat[i], cur_lon[i],
                    vehicles["directionDegrees"][i],
                    random.uniform(35.0, 80.0))
                # Small occasional jitter so trails look organic.
                if random.random() < 0.35:
                    cur_lat[i] += random.uniform(-0.00004, 0.00004)
                    cur_lon[i] += random.uniform(-0.00004, 0.00004)
                parsed.append(ParsedVehicle(
                    route_id=vehicles["routeIds"][i],
                    trip_id=vehicles["tripIds"][i],
                    timestamp=now - relative_times[i],
                    lat=cur_lat[i],
                    lon=cur_lon[i],
                    vehicle_id=vehicles["vehicleIds"][i],
                ))
            feed = ParsedFeed(vehicles=parsed, timestamp=now)
            message = server.process_feed(feed)
            if message is not None:
                await server.broadcast_real_time()
            await asyncio.sleep(REALTIME_FETCH_INTERVAL_SECONDS)

    server.replay_loop = replay_loop


# ------------------------------------------------------------------- runtime

server: GtfsServer | None = None


def create_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="ZET uživo server: GTFS fetch + HTTP + WebSocket")
    parser.add_argument("--host", default=os.environ.get("VOZLINIA_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int,
                        default=int(os.environ.get("VOZLINIA_PORT", "5000")))
    parser.add_argument("--replay", action="store_true",
                        help="Serve the recorded fixtures in testdata/ instead "
                             "of the live ZET feeds")
    parser.add_argument("--realtime-url", default=None,
                        help="Override the GTFS-RT URL (default: live ZET)")
    parser.add_argument("--static-interval", type=int, default=None,
                        help="Override the static-data refresh interval in seconds")
    return parser


def main() -> None:
    global server
    args = create_parser().parse_args()

    server = GtfsServer(
        realtime_url=args.realtime_url or REALTIME_URL,
    )
    if os.environ.get("VOZLINIA_APP_NEWS_FILE"):
        server.news_cache = NewsCache(
            app_news_path=os.environ["VOZLINIA_APP_NEWS_FILE"])
    if args.static_interval:
        global STATIC_FETCH_INTERVAL_SECONDS
        STATIC_FETCH_INTERVAL_SECONDS = args.static_interval

    async def run() -> None:
        listener = await asyncio.get_running_loop().create_server(
            lambda: VozLiniaConnection(server), args.host, args.port)
        logger.info("ZET uživo server listening on http://%s:%d "
                    "(WebSocket routes /ws-v0..v4)", args.host, args.port)
        tasks = [
            asyncio.create_task(server.run_news_loop()),
            asyncio.create_task(server.run_staleness_loop()),
            asyncio.create_task(server.run_ws_keepalive()),
        ]
        if args.replay:
            start_replay(server)
            tasks.append(asyncio.create_task(server.replay_loop()))
        else:
            tasks.append(asyncio.create_task(server.run_fetch_loop()))
        try:
            await asyncio.gather(*tasks)
        finally:
            listener.close()
            await listener.wait_closed()

    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        logger.info("Shutting down.")


if __name__ == "__main__":
    main()
