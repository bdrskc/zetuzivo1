"""GTFS static data: parsing, compression and static-snapshot JSON.

Reproduces the observable format of the upstream `ikicic/zet` server
(BSD-3-Clause) with new code. See docs/PROTOCOL.md.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from itertools import groupby
from typing import Iterable, Iterator

import csv
import datetime
import gzip
import hashlib
import io
import logging
import zipfile

from server.codec import encode_deltas

logger = logging.getLogger(__name__)

TripId = str
ShapeId = str
RouteId = int


@dataclass
class GtfsShape:
    id: ShapeId
    lats: list[float]
    lons: list[float]

    @staticmethod
    def to_compressed_json(shapes: list["GtfsShape"], ref) -> dict:
        return {
            "ids": [shape.id for shape in shapes],
            "compressedLats": [ref.compress_lats(shape.lats) for shape in shapes],
            "compressedLons": [ref.compress_lons(shape.lons) for shape in shapes],
        }


def _read_gtfs_rows(zip_file: zipfile.ZipFile, name: str) -> Iterator[dict[str, str]]:
    with zip_file.open(name) as file:
        yield from csv.DictReader(io.TextIOWrapper(file, encoding="utf-8-sig"))


@dataclass
class StaticData:
    trip_to_shape_id: dict[TripId, ShapeId]
    shapes: dict[ShapeId, GtfsShape]
    route_ids: list[RouteId]
    calendar_dates: set[datetime.date]
    stops: dict[str, tuple[float, float]] = field(default_factory=dict)
    shape_stop_ids: dict[ShapeId, list[str]] = field(default_factory=dict)
    trip_to_block_id: dict[TripId, str] = field(default_factory=dict)

    @staticmethod
    def from_zip_data(raw_data: bytes) -> "StaticData":
        with zipfile.ZipFile(io.BytesIO(raw_data)) as zip_file:
            trip_to_shape_id: dict[TripId, ShapeId] = {}
            trip_to_block_id: dict[TripId, str] = {}
            for row in _read_gtfs_rows(zip_file, "trips.txt"):
                trip_to_shape_id[row["trip_id"]] = row["shape_id"]
                if row.get("block_id"):
                    trip_to_block_id[row["trip_id"]] = row["block_id"]
            shapes = StaticData._read_shapes(zip_file)
            return StaticData(
                trip_to_shape_id=trip_to_shape_id,
                trip_to_block_id=trip_to_block_id,
                shapes=shapes,
                route_ids=StaticData._read_route_ids(zip_file),
                calendar_dates=StaticData._read_calendar_dates(zip_file),
                stops=StaticData._read_stops(zip_file),
                shape_stop_ids=StaticData._read_shape_stop_ids(
                    zip_file, trip_to_shape_id, set(shapes)),
            )

    @staticmethod
    def _read_shapes(zip_file: zipfile.ZipFile) -> dict[ShapeId, GtfsShape]:
        points: dict[ShapeId, list[tuple[int, float, float]]] = {}
        for row in _read_gtfs_rows(zip_file, "shapes.txt"):
            points.setdefault(row["shape_id"], []).append(
                (int(row["shape_pt_sequence"]),
                 float(row["shape_pt_lat"]), float(row["shape_pt_lon"])))
        shapes: dict[ShapeId, GtfsShape] = {}
        for shape_id, shape_points in points.items():
            shape_points.sort(key=lambda point: point[0])
            shapes[shape_id] = GtfsShape(
                id=shape_id,
                lats=[lat for _, lat, _ in shape_points],
                lons=[lon for _, _, lon in shape_points],
            )
        return shapes

    @staticmethod
    def _read_route_ids(zip_file: zipfile.ZipFile) -> list[RouteId]:
        route_ids: list[RouteId] = []
        for row in _read_gtfs_rows(zip_file, "routes.txt"):
            try:
                route_ids.append(int(row["route_id"]))
            except ValueError:
                logger.warning("Error parsing route_id: %s", row["route_id"])
        return route_ids

    @staticmethod
    def _read_calendar_dates(zip_file: zipfile.ZipFile) -> set[datetime.date]:
        dates: set[datetime.date] = set()
        for row in _read_gtfs_rows(zip_file, "calendar_dates.txt"):
            try:
                dates.add(datetime.datetime.strptime(row["date"], "%Y%m%d").date())
            except ValueError as exc:
                logger.error("Error parsing calendar_dates.txt: %s", exc)
        return dates

    @staticmethod
    def _read_stops(zip_file: zipfile.ZipFile) -> dict[str, tuple[float, float]]:
        return {
            row["stop_id"]: (float(row["stop_lat"]), float(row["stop_lon"]))
            for row in _read_gtfs_rows(zip_file, "stops.txt")
            if row["stop_lat"] and row["stop_lon"]
        }

    @staticmethod
    def _read_shape_stop_ids(
        zip_file: zipfile.ZipFile,
        trip_to_shape_id: dict[TripId, ShapeId],
        available_shapes: set[ShapeId],
        *,
        grouped: bool = True,
    ) -> dict[ShapeId, list[str]]:
        """The stop sequence of each shape, from stop_times.txt.

        The current ZET feed has one stop sequence per shape. If multiple trips
        use one shape with different stop sequences, the stops for that shape
        are dropped rather than guessed.
        """
        shape_stop_ids: dict[ShapeId, list[str]] = {}
        ambiguous_shapes: set[ShapeId] = set()

        def add_trip(trip_id: TripId,
                     stop_sequence: Iterable[tuple[int, str]]) -> None:
            shape_id = trip_to_shape_id[trip_id]
            stop_ids = [stop_id for _, stop_id in sorted(stop_sequence)]
            if shape_id in shape_stop_ids and shape_stop_ids[shape_id] != stop_ids:
                ambiguous_shapes.add(shape_id)
            else:
                shape_stop_ids[shape_id] = stop_ids

        with zip_file.open("stop_times.txt") as file:
            # stop_times has millions of rows; reuse one dict at a time when
            # trips are contiguous to keep memory low.
            reader = (row for row in csv.reader(
                io.TextIOWrapper(file, encoding="utf-8-sig")) if row)
            header = next(reader)
            trip_col, stop_col, sequence_col = (
                header.index(name)
                for name in ("trip_id", "stop_id", "stop_sequence"))
            if grouped:
                seen: set[TripId] = set()
                for trip_id, rows in groupby(reader, lambda row: row[trip_col]):
                    if trip_id in seen:
                        # GTFS does not require contiguous trips. Restart from
                        # scratch rather than treating partial blocks as patterns.
                        return StaticData._read_shape_stop_ids(
                            zip_file, trip_to_shape_id, available_shapes,
                            grouped=False)
                    seen.add(trip_id)
                    if trip_to_shape_id.get(trip_id) in available_shapes:
                        add_trip(trip_id, ((int(row[sequence_col]), row[stop_col])
                                           for row in rows))
            else:
                trip_stops: dict[TripId, list[tuple[int, str]]] = {}
                for row in reader:
                    trip_id = row[trip_col]
                    if trip_to_shape_id.get(trip_id) in available_shapes:
                        trip_stops.setdefault(trip_id, []).append(
                            (int(row[sequence_col]), row[stop_col]))
                for trip_id, stop_sequence in trip_stops.items():
                    add_trip(trip_id, stop_sequence)

        for shape_id in ambiguous_shapes:
            shape_stop_ids.pop(shape_id, None)
        if ambiguous_shapes:
            logger.warning(
                "Omitting stops for %d shapes with multiple stop patterns",
                len(ambiguous_shapes))
        return shape_stop_ids

    def big_to_json(self, ref) -> dict:
        """Large data, loaded on demand (shapes + stops)."""
        # Assign stop indices in first-appearance order along the shapes so
        # that nearby stops tend to have nearby indices as well as coordinates.
        stop_ids = list(dict.fromkeys(
            stop_id for shape_id in self.shapes
            for stop_id in self.shape_stop_ids.get(shape_id, [])
            if stop_id in self.stops))
        stop_indices = {stop_id: i for i, stop_id in enumerate(stop_ids)}
        shapes = GtfsShape.to_compressed_json(list(self.shapes.values()), ref)
        shapes["stopIndexDeltas"] = [
            encode_deltas(stop_indices[s]
                          for s in self.shape_stop_ids.get(shape_id, [])
                          if s in stop_indices)
            for shape_id in self.shapes]
        return {
            "shapes": shapes,
            "stops": {
                "latDeltas": ref.compress_lats(
                    [self.stops[s][0] for s in stop_ids]),
                "lonDeltas": ref.compress_lons(
                    [self.stops[s][1] for s in stop_ids]),
            },
        }

    def small_to_json(self) -> dict:
        """Small data, loaded immediately (route ids)."""
        return {"routes": {"ids": self.route_ids}}


@dataclass
class StaticDataSnapshot:
    key: str
    static_data: StaticData
    formatted_json_big: str
    formatted_json_small: str
    raw_data: bytes | None = None
    schedule: ScheduleDb | None = None

    @staticmethod
    def from_zip_data(raw_data: bytes, ref) -> "StaticDataSnapshot":
        key = hashlib.sha256(raw_data).hexdigest()
        static_data = StaticData.from_zip_data(raw_data)
        schedule = ScheduleDb.from_zip_data(raw_data)
        return StaticDataSnapshot(
            key=key,
            static_data=static_data,
            formatted_json_big=compact_json(static_data.big_to_json(ref)),
            formatted_json_small=compact_json(static_data.small_to_json()),
            raw_data=None,
            schedule=schedule,
        )

    def matches_date(self, date: datetime.date) -> bool:
        return date in self.static_data.calendar_dates


FINISHED_GRACE_SECONDS = 20 * 60


@dataclass
class ScheduleDb:
    """GTFS schedule parsed once per zip.

    A day's :class:`StopIndex` is a filter over this store, so the large
    ``stop_times.txt`` is not read again when the date rolls over or when the
    first station is opened.
    """

    stops: dict[str, tuple[str, float, float]]
    weekday: dict[str, set[int]]
    added: dict[str, set[datetime.date]]
    removed: dict[str, set[datetime.date]]
    # Parallel to ``times``: (trip_id, route_id, headsign, direction, shape, service, end)
    trips: list[tuple]
    times: list[list[tuple[str, int, int | None, int | None]]]
    # stop_id -> (arrival seconds, index into ``trips``), unique and sorted
    by_stop: dict[str, list[tuple[int, int]]]

    def is_active(self, service_id: str, date: datetime.date) -> bool:
        if date in self.removed.get(service_id, ()):
            return False
        return (date.weekday() in self.weekday.get(service_id, ())
                or date in self.added.get(service_id, ()))

    def _next_run_label(self, stop_id: str, today: datetime.date) -> str | None:
        """When a stop with no service today runs again: sutra, vikendom, or a weekday."""
        services = {self.trips[src][5] for _when, src in self.by_stop.get(stop_id, ())}
        if not services:
            return None
        names = ("pon", "uto", "sri", "čet", "pet", "sub", "ned")
        for offset in range(1, 8):
            day = today + datetime.timedelta(days=offset)
            if any(self.is_active(service_id, day) for service_id in services):
                if offset == 1:
                    return "sutra"
                if day.weekday() >= 5:
                    return "vikendom"
                return names[day.weekday()]
        return None

    def index_for(self, date: datetime.date) -> "StopIndex":
        active = [i for i, trip in enumerate(self.trips)
                  if self.is_active(trip[5], date)]
        remap = {src: i for i, src in enumerate(active)}
        trips: list[dict[str, object]] = []
        trip_index: dict[TripId, int] = {}
        trip_times: dict[TripId, list[tuple[str, int, int | None, int | None]]] = {}
        for src in active:
            trip_id, route_id, headsign, direction_id, shape_id, _service, end = self.trips[src]
            trip_index[trip_id] = len(trips)
            trips.append({
                "trip_id": trip_id,
                "route_id": route_id,
                "headsign": headsign,
                "direction_id": direction_id,
                "shape_id": shape_id,
                "end": end,
            })
            trip_times[trip_id] = self.times[src]
        stop_services: dict[str, list[int]] = {stop_id: [] for stop_id in self.stops}
        route_ids_by_stop: dict[str, list[int]] = {stop_id: [] for stop_id in self.stops}
        for stop_id, calls in self.by_stop.items():
            if stop_id not in stop_services:
                continue
            indices = [remap[src] for _when, src in calls if src in remap]
            stop_services[stop_id] = indices
            routes: list[int] = []
            seen: set[int] = set()
            for index in indices:
                route_id = int(trips[index]["route_id"])
                if route_id not in seen:
                    seen.add(route_id)
                    routes.append(route_id)
            route_ids_by_stop[stop_id] = routes
        next_label: dict[str, str] = {}
        for stop_id, routes in route_ids_by_stop.items():
            if routes:
                continue
            label = self._next_run_label(stop_id, date)
            if label:
                next_label[stop_id] = label
        return StopIndex(
            date=date,
            stops=self.stops,
            trips=trips,
            trip_index=trip_index,
            trip_times=trip_times,
            stop_services=stop_services,
            route_ids_by_stop=route_ids_by_stop,
            next_label=next_label,
        )

    @staticmethod
    def from_zip_data(raw_data: bytes) -> "ScheduleDb":
        with zipfile.ZipFile(io.BytesIO(raw_data)) as zip_file:
            stops: dict[str, tuple[str, float, float]] = {}
            for row in _read_gtfs_rows(zip_file, "stops.txt"):
                if not row["stop_lat"] or not row["stop_lon"]:
                    continue
                name = row.get("stop_name") or row.get("stop_code") or ""
                stops[row["stop_id"]] = (
                    name, float(row["stop_lat"]), float(row["stop_lon"]))

            weekday: dict[str, set[int]] = {}
            for row in _read_gtfs_rows(zip_file, "calendar.txt"):
                days = {i for i, name in enumerate(
                    ("monday", "tuesday", "wednesday", "thursday",
                     "friday", "saturday", "sunday"))
                    if row.get(name) == "1"}
                if days:
                    weekday[row["service_id"]] = days
            added: dict[str, set[datetime.date]] = {}
            removed: dict[str, set[datetime.date]] = {}
            for row in _read_gtfs_rows(zip_file, "calendar_dates.txt"):
                try:
                    day = datetime.datetime.strptime(row["date"], "%Y%m%d").date()
                except ValueError:
                    continue
                if row.get("exception_type") == "1":
                    added.setdefault(row["service_id"], set()).add(day)
                elif row.get("exception_type") == "2":
                    removed.setdefault(row["service_id"], set()).add(day)

            meta: dict[TripId, tuple] = {}
            for row in _read_gtfs_rows(zip_file, "trips.txt"):
                try:
                    route_id = int(row["route_id"])
                except ValueError:
                    continue
                try:
                    direction_id = int(row["direction_id"])
                except (ValueError, KeyError):
                    direction_id = None
                meta[row["trip_id"]] = (
                    row["trip_id"], route_id, row.get("trip_headsign") or None,
                    direction_id, row.get("shape_id") or None, row["service_id"],
                )

            pending: dict[str, list[tuple[int, str, int | None, int | None]]] = {}
            with zip_file.open("stop_times.txt") as file:
                reader = (row for row in csv.reader(
                    io.TextIOWrapper(file, encoding="utf-8-sig")) if row)
                header = next(reader)
                trip_col = header.index("trip_id")
                seq_col = header.index("stop_sequence")
                stop_col = header.index("stop_id")
                arr_col = header.index("arrival_time")
                dep_col = header.index("departure_time")
                for row in reader:
                    trip_id = row[trip_col]
                    if trip_id not in meta or row[stop_col] not in stops:
                        continue
                    pending.setdefault(trip_id, []).append((
                        int(row[seq_col]), row[stop_col],
                        StopIndex._time_to_seconds(row[arr_col]),
                        StopIndex._time_to_seconds(row[dep_col])))

        trips: list[tuple] = []
        times: list[list[tuple[str, int, int | None, int | None]]] = []
        by_stop_raw: dict[str, list[tuple[int, int]]] = {}
        for trip_id, rows in pending.items():
            rows.sort(key=lambda item: item[0])
            end: int | None = None
            for _seq, _stop, arr, dep in rows:
                for stamp in (arr, dep):
                    if stamp is not None and (end is None or stamp > end):
                        end = stamp
            src = len(trips)
            base = meta[trip_id]
            trips.append((*base, end))
            times.append(rows)
            seen_stops: set[str] = set()
            for _seq, stop_id, arr, dep in rows:
                if stop_id in seen_stops:
                    continue
                seen_stops.add(stop_id)
                when = arr if arr is not None else (dep if dep is not None else 0)
                by_stop_raw.setdefault(stop_id, []).append((when, src))
        for calls in by_stop_raw.values():
            calls.sort()
        # Parent stations (and any other stop no trip ever calls at) share the
        # name of the real platforms and draw as a permanently gray dot.
        stops = {sid: meta for sid, meta in stops.items() if sid in by_stop_raw}
        return ScheduleDb(
            stops=stops, weekday=weekday, added=added, removed=removed,
            trips=trips, times=times, by_stop=by_stop_raw)


def _trip_still_relevant(end: object, now_secs: int) -> bool:
    """True when the trip has not finished yet (with a short grace period).

    GTFS allows times past 24:00 for the same service day. Just after midnight
    those still count.
    """
    if not isinstance(end, int):
        return True
    if end >= now_secs - FINISHED_GRACE_SECONDS:
        return True
    if now_secs < 4 * 3600 and end >= 24 * 3600:
        return (end - 24 * 3600) >= now_secs - FINISHED_GRACE_SECONDS
    return False


def compact_json(data) -> str:
    import json
    return json.dumps(data, separators=(",", ":"))


def gzipped_static_payload(raw_data: bytes) -> str:
    """gzip the raw zip and hex-encode it, as the internal fetcher message does."""
    return gzip.compress(raw_data).hex()

@dataclass
class StopIndex:
    """Per-day stop/service index from GTFS static.

    Keeps stop ids as raw strings so they match the ``stop_id`` values used in
    the live feed's TripUpdate stop_time_updates (e.g. ``"98_1"``). Trips are
    filtered to those active on ``date`` via calendar.txt + calendar_dates.txt.
    """

    date: datetime.date
    stops: dict[str, tuple[str, float, float]]  # stop_id -> (name, lat, lon)
    trips: list[dict[str, object]]  # active trip metadata
    trip_index: dict[TripId, int]
    trip_times: dict[TripId, list[tuple[str, int, int | None, int | None]]]
    stop_services: dict[str, list[int]]  # stop_id -> active trip indices
    route_ids_by_stop: dict[str, list[int]] = field(default_factory=dict)
    # Stops with no service today, but a trip on a later day ("sutra", "vikendom", …).
    next_label: dict[str, str] = field(default_factory=dict)
    _layer_json: str | None = field(default=None, repr=False)

    @staticmethod
    def _time_to_seconds(value: str) -> int | None:
        try:
            h, m, s = value.split(":")
            return int(h) * 3600 + int(m) * 60 + int(s)
        except (ValueError, AttributeError):
            return None

    @staticmethod
    def from_zip_data(raw_data: bytes, date: datetime.date) -> "StopIndex":
        return ScheduleDb.from_zip_data(raw_data).index_for(date)

    def trip_label(self, trip_id: str) -> dict[str, object] | None:
        """Line number and destination for one trip. No vehicle id."""
        index = self.trip_index.get(trip_id)
        if index is None:
            return None
        trip = self.trips[index]
        return {
            "tripId": trip_id,
            "routeId": int(trip["route_id"]),
            "headsign": trip.get("headsign"),
        }

    def trip_route_id(self, trip: dict[str, object]) -> int:
        return int(trip["route_id"])

    def stops_layer_json(self) -> dict:
        """Compact stop layer payload: identity + the routes serving each stop.

        Each stop is ``[stop_id, name, lat, lon, [route_ids...], next_label]``.
        ``next_label`` is empty when the stop runs today, otherwise "sutra" or "vikendom".
        """
        layer: list[list[object]] = []
        routes = self.route_ids_by_stop
        for stop_id, (name, lat, lon) in self.stops.items():
            layer.append([
                stop_id, name, lat, lon,
                routes.get(stop_id, []),
                self.next_label.get(stop_id, ""),
            ])
        return {
            "date": self.date.isoformat(),
            "stops": layer,
        }

    def stops_layer_body(self) -> str:
        """Serialized stop layer, built once per day."""
        if self._layer_json is None:
            self._layer_json = compact_json(self.stops_layer_json())
        return self._layer_json

    def stop_services_json(self, stop_id: str, now_secs: int | None = None) -> dict | None:
        """Services that call at this stop, ordered by scheduled arrival.

        When ``now_secs`` is set, trips that finished more than
        ``FINISHED_GRACE_SECONDS`` ago are left out. The full day is what the
        tests and a cold index still expose.
        """
        if stop_id not in self.stops:
            return None
        name, lat, lon = self.stops[stop_id]
        services: list[dict[str, object]] = []
        for trip_index in self.stop_services[stop_id]:
            trip = self.trips[trip_index]
            if now_secs is not None and not _trip_still_relevant(trip.get("end"), now_secs):
                continue
            trip_id = str(trip["trip_id"])
            rows = trip.get("_rows")
            if not isinstance(rows, list):
                rows = [
                    [stop, seq, arrival, departure]
                    for seq, stop, arrival, departure in self.trip_times[trip_id]]
                trip["_rows"] = rows
            services.append({
                "tripId": trip_id,
                "routeId": self.trip_route_id(trip),
                "headsign": trip.get("headsign"),
                "directionId": trip.get("direction_id"),
                "shapeId": trip.get("shape_id"),
                "times": rows,
            })
        return {
            "stopId": stop_id,
            "name": name,
            "lat": lat,
            "lon": lon,
            "services": services,
        }


def _arrival_at_stop(times: list, stop_id: str) -> int | None:
    for stop, _seq, arrival, _dep in times:
        if stop == stop_id:
            return arrival
    return None

