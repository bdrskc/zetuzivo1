import json
import unittest
from pathlib import Path

from server.server import GtfsServer, WsOutputMessageVariants
from server.state import ParsedFeed, ParsedVehicle

TESTDATA = Path(__file__).resolve().parent.parent / "testdata"


class MessageBuildingTest(unittest.TestCase):
    def setUp(self):
        self.server = GtfsServer()

    def test_v1_and_v2_shapes_from_a_parsed_feed(self):
        feed = ParsedFeed(
            vehicles=[ParsedVehicle(
                vehicle_id="102204", trip_id="trip-a", route_id=11,
                timestamp=1000, lat=45.79617, lon=15.93780)],
            timestamp=1010,
        )
        variants = self.server.process_feed(feed)
        v1 = json.loads(variants.version1)
        v2 = json.loads(variants.version2)
        self.assertIn("latestStaticKey", v1)
        self.assertNotIn("latestStaticKey", v2)
        self.assertEqual(v2["timestamp"], 1010)
        self.assertEqual(v2["vehicles"]["routeIds"], [11])
        # No static data loaded yet -> shape unknown.
        self.assertEqual(v2["vehicles"]["shapeIds"], [None])
        # Delta timestamp: 1010 - 1000 = 10.
        self.assertEqual(v2["vehicles"]["timestamps"], [10])

    def test_v0_is_a_list(self):
        feed = ParsedFeed(
            vehicles=[ParsedVehicle(vehicle_id="7", trip_id="t", route_id=2,
                                    timestamp=5, lat=45.8, lon=16.0)],
            timestamp=10)
        variants = self.server.process_feed(feed)
        v0 = json.loads(variants.version0)
        self.assertIsInstance(v0, list)
        self.assertEqual(v0[0]["routeId"], 2)

    def test_static_snapshot_fixture_is_servable(self):
        # Replay mode registers the recorded static fixtures by key.
        import server.server as server_module
        server_module.start_replay(self.server)
        key = json.loads((TESTDATA / "realtime-frame-0.json").read_text(
            encoding="utf-8"))["activeStaticKey"]
        snapshot = self.server.active_static_snapshot(key)
        self.assertIsNotNone(snapshot)
        small = json.loads(snapshot.formatted_json_small)
        self.assertGreater(len(small["routes"]["ids"]), 0)
        big = json.loads(snapshot.formatted_json_big)
        self.assertIn("shapes", big)
        self.assertIn("stops", big)


    def test_v2_carries_trip_updates(self):
        feed = ParsedFeed(
            vehicles=[ParsedVehicle(vehicle_id="102204", trip_id="trip-a",
                                    route_id=11, timestamp=1000,
                                    lat=45.79617, lon=15.93780)],
            timestamp=1010,
            trip_updates=[{
                "tripId": "trip-a",
                "delay": None,
                "timestamp": 1010,
                "stopTimeUpdates": [{
                    "stopId": "s2", "seq": 2,
                    "arrivalTime": 1100, "arrivalDelay": 30,
                }],
            }, {
                "tripId": "nobody-is-on-this-trip",
                "stopTimeUpdates": [],
            }],
        )
        variants = self.server.process_feed(feed)
        v2 = json.loads(variants.version2)
        self.assertEqual(len(v2["tripUpdates"]), 1)
        self.assertEqual(v2["tripUpdates"][0]["stopTimeUpdates"][0]["stopId"], "s2")
        # v1 stays upstream-compatible (no tripUpdates field).
        v1 = json.loads(variants.version1)
        self.assertNotIn("tripUpdates", v1)

    def test_stop_endpoints_from_mini_zip(self):
        from tests.test_schedule import make_zip
        snapshot = self.server.process_static(make_zip())
        key = snapshot.key
        index = self.server.stop_index(key)
        self.assertIsNotNone(index)
        layer = self.server.stop_index(key).stops_layer_json()
        self.assertEqual(layer["stops"][0][0], "s1")
        services = self.server.stop_services_json(key, "s2")
        self.assertIsNotNone(services)
        parsed = json.loads(services)
        self.assertEqual(parsed["name"], "Sredina")
        # The day index still has the morning trip. The served payload drops
        # trips that finished more than 20 minutes ago.
        full = index.stop_services_json("s2")
        self.assertEqual(full["services"][0]["routeId"], 11)
        self.assertEqual(full["services"][0]["headsign"], "Borongaj")
        self.assertIsNone(self.server.stop_services_json(key, "missing"))
        from server.server import handle_http_request
        encoded = handle_http_request(
            self.server, "GET", f"/static/stop/v1/{key}/s%32", {})
        self.assertEqual(encoded.status, 200)
        self.assertIn(b"Sredina", encoded.body)


        import math
        from server.server import advance_position

        lat, lon = 45.815, 15.9819
        north = advance_position(lat, lon, 0.0, 111.32)
        east = advance_position(lat, lon, 90.0, 111.32)
        self.assertAlmostEqual(north[0] - lat, 0.001, places=6)
        self.assertAlmostEqual(north[1], lon, places=6)
        # East displacement in degrees is scaled by cos(lat).
        expected_east = 111.32 / (111320.0 * math.cos(math.radians(lat)))
        self.assertAlmostEqual(east[1] - lon, expected_east, places=6)
        self.assertAlmostEqual(east[0], lat, places=6)
        # None bearing (no direction) must not crash and moves north-ish.
        none_bearing = advance_position(lat, lon, None, 50.0)
        self.assertTrue(none_bearing[0] != lat)


if __name__ == "__main__":
    unittest.main()
