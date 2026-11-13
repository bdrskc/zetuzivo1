import json
import unittest
from pathlib import Path

from server.codec import (
    STATIC_REFERENCE_SYSTEM,
    compress_timestamps,
    StaticReferenceSystem,
    decompress_timestamps,
    decode_deltas,
    encode_deltas,
)

TESTDATA = Path(__file__).resolve().parent.parent / "testdata"


class DeltaEncodingTest(unittest.TestCase):
    def test_round_trip_integers(self):
        values = [3, -5, 1000, -1000, 7, 0, 8]
        self.assertEqual(decode_deltas(encode_deltas(values)), values)

    def test_delta_example(self):
        # Example: absolute offsets [34250, 35292, ...] become differences.
        self.assertEqual(encode_deltas([34250, 35292, 36266]), [34250, 1042, 974])
        self.assertEqual(decode_deltas([34250, 1042, 974]), [34250, 35292, 36266])

    def test_empty_and_single(self):
        self.assertEqual(encode_deltas([]), [])
        self.assertEqual(decode_deltas([5]), [5])


class CoordinateCodecTest(unittest.TestCase):
    KNOWN_TRAIL = {
        "lat": [45.84925, 45.850292, 45.851227, 45.85176, 45.852203, 45.853043],
        "lon": [16.049747, 16.048365, 16.047295, 16.046215, 16.045439, 16.04445],
    }

    def test_known_offsets_round_trip(self):
        ref = STATIC_REFERENCE_SYSTEM
        for axis, expected in self.KNOWN_TRAIL.items():
            coords = self.KNOWN_TRAIL[axis]
            compressed = ref.compress_lats(coords) if axis == "lat" else \
                ref.compress_lons(coords)
            decoded = ref.decompress_lats(compressed) if axis == "lat" else \
                ref.decompress_lons(compressed)
            with self.subTest(axis=axis):
                # Precision loss is bounded by half a micro-degree per point.
                for got, want in zip(decoded, expected):
                    self.assertAlmostEqual(got, want, places=6)

    def test_live_frame_regression(self):
        """Decode the first vehicle of the recorded live production frame."""
        frame = json.loads(
            (TESTDATA / "realtime-frame-0.json").read_text(encoding="utf-8"))
        vehicles = frame["vehicles"]
        ref = STATIC_REFERENCE_SYSTEM
        lats = ref.decompress_lats(vehicles["compressedLats"][0])
        lons = ref.decompress_lons(vehicles["compressedLons"][0])
        # First vehicle came from the live feed: route 208 near Sesvetski Kraljevec.
        self.assertEqual(vehicles["routeIds"][0], 208)
        self.assertEqual(vehicles["shapeIds"][0], "208_6")
        self.assertAlmostEqual(lats[0], 45.84925, places=4)
        self.assertAlmostEqual(lons[0], 16.049747, places=4)
        # Trajectory points in Zagreb (degrees).
        self.assertTrue(all(45.4 < lat < 46.3 for lat in lats))
        self.assertTrue(all(15.4 < lon < 16.8 for lon in lons))
        # Feed-time relative timestamps: delta equals feed_time - vehicle_time.
        feed_time = frame["timestamp"]
        first = vehicles["timestamps"][0]
        self.assertEqual(decompress_timestamps(feed_time, [first])[0],
                         feed_time - first)


class TimestampCodecTest(unittest.TestCase):
    def test_relative_before_feed_time(self):
        ref = 1000
        self.assertEqual(compress_timestamps(ref, [991, 1000, 900]), [9, 0, 100])
        self.assertEqual(decompress_timestamps(ref, [9, 0, 100]), [991, 1000, 900])


class LiveFrameSchemaTest(unittest.TestCase):
    def test_frame_has_v2_message_shape(self):
        """Observed live behavior: /ws-v4 sends v2 (no latestStaticKey)."""
        frame = json.loads(
            (TESTDATA / "realtime-frame-0.json").read_text(encoding="utf-8"))
        self.assertEqual(
            set(frame.keys()), {"vehicles", "timestamp", "activeStaticKey"})
        vehicles = frame["vehicles"]
        for field in ("routeIds", "shapeIds", "vehicleIds", "tripIds",
                      "blockIds", "timestamps", "reportDelays",
                      "compressedLats", "compressedLons", "directionDegrees"):
            self.assertIn(field, vehicles)

    def test_news_status_frame(self):
        frame = json.loads(
            (TESTDATA / "news-status-frame.json").read_text(encoding="utf-8"))
        self.assertEqual(frame["type"], "news-status")
        self.assertIn("version", frame)
        self.assertIn("latestAt", frame)


if __name__ == "__main__":
    unittest.main()
