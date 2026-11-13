"""Realtime vehicle state, mirroring the observable behaviour of the upstream
`ikicic/zet` server (BSD-3-Clause) with new code. See docs/PROTOCOL.md.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import math

from server.codec import STATIC_REFERENCE_SYSTEM
from server.codec import compress_timestamps

# --- Tunables (same values as the upstream server) ---------------------------
MAX_TRAJECTORY_LENGTH = 30
TRAJECTORY_OUTPUT_LENGTH = 6
# Longer observation gaps cannot distinguish late delivery from a stopped vehicle.
MAX_REPORT_OBSERVATION_GAP_SECONDS = 30
DIRECTION_THRESHOLD_METERS = 20
EARTH_RADIUS_METERS = 6371000


def haversine_distance_meters(lat1, lon1, lat2, lon2):
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = phi2 - phi1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dl / 2) ** 2
    return EARTH_RADIUS_METERS * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def arrow_angle(lat1, lon1, lat2, lon2):
    """Angle of the vector between two points, north == 0, east == pi/2."""
    dx = (lon2 - lon1) * math.cos(math.radians(lat1))
    dy = lat2 - lat1
    return math.atan2(dx, dy)


TripId = str
ShapeId = str
RouteId = int


@dataclass
class ParsedVehicle:
    route_id: int
    trip_id: TripId
    timestamp: int
    lat: float
    lon: float
    vehicle_id: str | None = None


@dataclass
class ParsedFeed:
    vehicles: list[ParsedVehicle]
    timestamp: int
    trip_updates: list[dict] = field(default_factory=list)

    @staticmethod
    def from_protobuf(feed) -> Optional["ParsedFeed"]:
        """Parse a `gtfs_realtime_pb2.FeedMessage` into parsed vehicles."""
        vehicles: list[ParsedVehicle] = []
        for entity in feed.entity:
            if not entity.HasField("vehicle"):
                continue
            v = entity.vehicle
            if not v.HasField("trip") or not v.HasField("position"):
                continue
            try:
                vehicles.append(ParsedVehicle(
                    route_id=int(v.trip.route_id),
                    trip_id=v.trip.trip_id,
                    timestamp=int(v.timestamp),
                    lat=float(v.position.latitude),
                    lon=float(v.position.longitude),
                    vehicle_id=v.vehicle.id or None,
                ))
            except (KeyError, ValueError, TypeError):
                continue

        # TripUpdates (stop_time_update / delay) are relayed to the client
        # verbatim, in compact form, so per-stop live arrivals can be computed.
        trip_updates: list[dict] = []
        for entity in feed.entity:
            if not entity.HasField("trip_update"):
                continue
            update = entity.trip_update
            stus: list[dict] = []
            for s in update.stop_time_update:
                entry: dict[str, object] = {"stopId": s.stop_id}
                if s.HasField("stop_sequence"):
                    entry["seq"] = s.stop_sequence
                if s.HasField("arrival"):
                    if s.arrival.HasField("time"):
                        entry["arrivalTime"] = s.arrival.time
                    if s.arrival.HasField("delay"):
                        entry["arrivalDelay"] = s.arrival.delay
                if s.HasField("departure"):
                    if s.departure.HasField("time"):
                        entry["departureTime"] = s.departure.time
                    if s.departure.HasField("delay"):
                        entry["departureDelay"] = s.departure.delay
                stus.append(entry)
            info: dict[str, object] = {
                "tripId": update.trip.trip_id,
                "stopTimeUpdates": stus,
            }
            if update.HasField("delay"):
                info["delay"] = update.delay
            if update.HasField("timestamp"):
                info["timestamp"] = update.timestamp
            trip_updates.append(info)

        return ParsedFeed(vehicles=vehicles,
                          timestamp=int(feed.header.timestamp),
                          trip_updates=trip_updates)


@dataclass
class Vehicle:
    route_id: int
    shape_id: ShapeId | None
    timestamp: int
    lat: list[float]          # lat[-1] is the newest position
    lon: list[float]          # lon[-1] is the newest position
    direction_radians: float | None = None
    no_update_counter: int = 0
    report_delay: int | None = None
    vehicle_id: str | None = None
    trip_id: TripId | None = None
    block_id: str | None = None

    @staticmethod
    def from_parsed_vehicle(vehicle: ParsedVehicle, static_data) -> "Vehicle":
        shape_id = None
        block_id = None
        if static_data is not None:
            shape_id = static_data.trip_to_shape_id.get(vehicle.trip_id)
            block_id = static_data.trip_to_block_id.get(vehicle.trip_id)
        return Vehicle(
            route_id=vehicle.route_id,
            shape_id=shape_id,
            timestamp=vehicle.timestamp,
            lat=[],
            lon=[],
            vehicle_id=vehicle.vehicle_id,
            trip_id=vehicle.trip_id,
            block_id=block_id,
        )

    @staticmethod
    def compute_direction(lat: list[float], lon: list[float]) -> float | None:
        if len(lat) < 2:
            return None
        # Angle towards the first sufficiently distant earlier point.
        for i in reversed(range(len(lat) - 1)):
            dist = haversine_distance_meters(lat[-1], lon[-1], lat[i], lon[i])
            if dist > DIRECTION_THRESHOLD_METERS:
                return arrow_angle(lat[i], lon[i], lat[-1], lon[-1])
        return None

    def update(self, vehicle: ParsedVehicle, static_data, feed_timestamp: int,
               continuous_feed: bool) -> None:
        if (not continuous_feed or self.no_update_counter != 1
                or vehicle.timestamp != self.timestamp
                or self.report_delay is None):
            self.report_delay = (
                feed_timestamp - vehicle.timestamp
                if 0 < vehicle.timestamp <= feed_timestamp else None)
        self.lat.append(vehicle.lat)
        self.lon.append(vehicle.lon)
        if len(self.lat) > MAX_TRAJECTORY_LENGTH:
            self.lat.pop(0)
            self.lon.pop(0)
        self.timestamp = vehicle.timestamp
        self.no_update_counter = 0
        self.direction_radians = self.compute_direction(self.lat, self.lon)
        self.vehicle_id = vehicle.vehicle_id
        self.trip_id = vehicle.trip_id
        if static_data is not None:
            self.block_id = static_data.trip_to_block_id.get(vehicle.trip_id)
            shape_id = static_data.trip_to_shape_id.get(vehicle.trip_id)
            if shape_id is not None:
                self.shape_id = shape_id

    def to_track(self) -> tuple[list[float], list[float]]:
        """The trail slice that the client renders."""
        trail = TRAJECTORY_OUTPUT_LENGTH
        return self.lat[-trail:], self.lon[-trail:]



@dataclass
class RealtimeState:
    vehicles: dict[tuple[str | None, TripId], Vehicle]
    timestamp: int
    active_static_key: str | None
    trip_updates: list[dict] = field(default_factory=list)
    _last_feed_received_at: float | None = field(default=None, init=False)

    def update(self, feed: ParsedFeed, active_static_snapshot) -> None:
        if feed.timestamp < self.timestamp:
            # Historical replay or a feed clock reset restarts observation.
            self.vehicles.clear()
        received_at = time_now()
        continuous_feed = (
            0 <= feed.timestamp - self.timestamp
            <= MAX_REPORT_OBSERVATION_GAP_SECONDS
            and self._last_feed_received_at is not None
            and 0 <= received_at - self._last_feed_received_at
            <= MAX_REPORT_OBSERVATION_GAP_SECONDS
        )
        self._last_feed_received_at = received_at
        for vehicle in self.vehicles.values():
            vehicle.no_update_counter += 1

        static_data = (active_static_snapshot.static_data
                       if active_static_snapshot else None)
        for parsed in feed.vehicles:
            # A physical vehicle can change trips; two vehicles can share a
            # trip. Identity is (vehicle_id, trip_id); without a vehicle id we
            # fall back to per-trip identity.
            key = (parsed.vehicle_id, parsed.trip_id)
            vehicle = self.vehicles.get(key)
            if vehicle is None:
                vehicle = Vehicle.from_parsed_vehicle(parsed, static_data)
                self.vehicles[key] = vehicle
            vehicle.update(parsed, static_data, feed.timestamp, continuous_feed)

        # Vehicles missing from the last 30 feeds are dropped.
        self.vehicles = {
            key: v for key, v in self.vehicles.items()
            if v.no_update_counter < 30
        }
        self.timestamp = feed.timestamp
        self.active_static_key = (
            active_static_snapshot.key if active_static_snapshot else None)
        self.trip_updates = feed.trip_updates



    def active_vehicles(self) -> list[Vehicle]:
        return [v for v in self.vehicles.values() if v.no_update_counter == 0]

    def to_json_v0(self):
        """Legacy: an array of vehicle positions."""
        out = []
        for v in self.active_vehicles():
            deg = round(v.direction_radians * 180 / math.pi) \
                if v.direction_radians is not None else None
            lats, lons = v.to_track()
            out.append({
                "routeId": v.route_id,
                "timestamp": v.timestamp,
                "lat": lats,
                "lon": lons,
                "directionDegrees": deg,
            })
        return out

    def to_json_v1(self):
        """Structure of arrays with compressed coordinates (v1)."""
        ref = STATIC_REFERENCE_SYSTEM
        vehicles = self.active_vehicles()
        compressed_lats, compressed_lons = [], []
        degrees = []
        for v in vehicles:
            lats, lons = v.to_track()
            compressed_lats.append(ref.compress_lats(lats))
            compressed_lons.append(ref.compress_lons(lons))
            degrees.append(
                round(v.direction_radians * 180 / math.pi)
                if v.direction_radians is not None else None)
        return {
            "vehicles": {
                "routeIds": [v.route_id for v in vehicles],
                "shapeIds": [v.shape_id for v in vehicles],
                "vehicleIds": [v.vehicle_id for v in vehicles],
                "tripIds": [v.trip_id for v in vehicles],
                "blockIds": [v.block_id for v in vehicles],
                "timestamps": compress_timestamps(
                    self.timestamp, [v.timestamp for v in vehicles]),
                "reportDelays": [v.report_delay for v in vehicles],
                "compressedLats": compressed_lats,
                "compressedLons": compressed_lons,
                "directionDegrees": degrees,
            },
            "timestamp": self.timestamp,
            "activeStaticKey": self.active_static_key,
            # Backwards compatibility (there was supposed to be a version bump
            # after renaming this field upstream).
            "latestStaticKey": self.active_static_key,
        }

    def to_json_v2(self):
        data = self.to_json_v1()
        del data["latestStaticKey"]
        # Only trips that currently have a vehicle. The full feed is ~540
        # TripUpdates; the map only estimates arrivals for visible vehicles,
        # and older clients ignore this extra key either way.
        active = {v.trip_id for v in self.active_vehicles() if v.trip_id}
        data["tripUpdates"] = [
            update for update in self.trip_updates
            if update.get("tripId") in active
        ]
        return data


def time_now() -> float:
    """Monotonic seconds; stubbed so tests can control the clock."""
    return __import__("time").monotonic()
