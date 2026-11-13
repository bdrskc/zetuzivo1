"""Coordinate and timestamp codec used by the ZET uživo protocol.

This module reproduces the behaviour of the upstream `ikicic/zet` protocol
(BSD-3-Clause, "ZET live map"); see docs/PROTOCOL.md and docs/ATTRIBUTION.md.

Encoding scheme:

  * Coordinates are stored as integer offsets from a reference point
    (ref_lat = 45.815, ref_lon = 15.9819) scaled by 10^coord_num_digits
    (coord_num_digits = 6, i.e. the offsets are in micro-degrees).
    The absolute offsets of a trajectory are delta-encoded. Each absolute
    offset is rounded *before* differencing so that rounding errors do not
    accumulate along a trail.
  * Vehicle timestamps are stored as integers counting the seconds *before*
    the realtime snapshot's `timestamp` (feed time).
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence

__all__ = [
    "COORD_NUM_DIGITS",
    "REF_LAT",
    "REF_LON",
    "StaticReferenceSystem",
    "encode_deltas",
    "decode_deltas",
]


class StaticReferenceSystem:
    """Shared reference system for lat/lon compression."""

    def __init__(
        self,
        coord_num_digits: int = 6,
        ref_lat: float = 45.815,
        ref_lon: float = 15.9819,
    ) -> None:
        self.coord_num_digits = coord_num_digits
        self.ref_lat = ref_lat
        self.ref_lon = ref_lon
        # Scaled offsets are integers in units of 10^-coord_num_digits degrees.
        self._factor: float = 10.0 ** coord_num_digits
        self._inv_scale: float = 10.0 ** (-coord_num_digits)

    def _compress_coord(self, ref_value: float, values: Sequence[float]) -> list[int]:
        # Round each absolute offset before differencing. Rounding each step
        # would accumulate error, especially for negative coordinate changes.
        offsets = (round((value - ref_value) * self._factor) for value in values)
        return encode_deltas(offsets)

    def compress_lats(self, lats: Sequence[float]) -> list[int]:
        return self._compress_coord(self.ref_lat, lats)

    def compress_lons(self, lons: Sequence[float]) -> list[int]:
        return self._compress_coord(self.ref_lon, lons)

    def _decompress_coord(
        self, ref_value: float, coords: Sequence[int]
    ) -> list[float]:
        return [ref_value + offset * self._inv_scale for offset in decode_deltas(coords)]

    def decompress_lats(self, lats: Sequence[int]) -> list[float]:
        return self._decompress_coord(self.ref_lat, lats)

    def decompress_lons(self, lons: Sequence[int]) -> list[float]:
        return self._decompress_coord(self.ref_lon, lons)


# The reference system used for every realtime state and static snapshot.
COORD_NUM_DIGITS = 6
REF_LAT = 45.815
REF_LON = 15.9819
STATIC_REFERENCE_SYSTEM = StaticReferenceSystem(
    coord_num_digits=COORD_NUM_DIGITS,
    ref_lat=REF_LAT,
    ref_lon=REF_LON,
)


def encode_deltas(values: Iterable[int]) -> list[int]:
    """Difference-encode a sequence of integers."""
    previous = 0
    deltas: list[int] = []
    for value in values:
        deltas.append(value - previous)
        previous = value
    return deltas


def decode_deltas(deltas: Sequence[int]) -> list[int]:
    """Reconstruct the original integer sequence from its deltas."""
    acc = 0
    decoded: list[int] = []
    for delta in deltas:
        acc += delta
        decoded.append(acc)
    return decoded


def compress_timestamps(ref_timestamp: int, timestamps: Sequence[int]) -> list[int]:
    """Encode vehicle times as seconds before the feed timestamp."""
    return [ref_timestamp - t for t in timestamps]


def decompress_timestamps(ref_timestamp: int, deltas: Sequence[int]) -> list[int]:
    return [ref_timestamp - d for d in deltas]
