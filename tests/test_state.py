import unittest
from unittest.mock import patch

from server.state import ParsedFeed, ParsedVehicle, RealtimeState


class VehicleIdentityTest(unittest.TestCase):
    def setUp(self):
        clock = patch("server.state.time_now", return_value=1000)
        self.clock = clock.start()
        self.addCleanup(clock.stop)
        self.state = RealtimeState(vehicles={}, timestamp=0, active_static_key=None)
        self.vehicle = ParsedVehicle(
            vehicle_id="102204", trip_id="trip-a", route_id=11,
            timestamp=100, lat=45.79617, lon=15.93780,
        )

    def update(self, *vehicles, feed_timestamp=None):
        if feed_timestamp is None:
            feed_timestamp = max(v.timestamp for v in vehicles)
        self.state.update(ParsedFeed(vehicles=list(vehicles),
                                     timestamp=feed_timestamp), None)
        return self.state.to_json_v1()["vehicles"]

    def active_vehicles(self):
        return {v.vehicle_id: v for v in self.state.active_vehicles()}

    def test_shared_trip_keeps_both_vehicles_and_independent_trails(self):
        a = self.vehicle
        b = ParsedVehicle(vehicle_id="102278", trip_id="trip-a", route_id=11,
                          timestamp=100, lat=45.82228, lon=16.02804)
        payload = self.update(a, b)
        self.assertCountEqual(payload["vehicleIds"], ["102204", "102278"])
        self.assertEqual(payload["tripIds"], ["trip-a", "trip-a"])
        self.assertTrue(all(len(lat) == 1 for lat in payload["compressedLats"]))

        moved_a = ParsedVehicle(vehicle_id=a.vehicle_id, trip_id="trip-a",
                                route_id=11, timestamp=110,
                                lat=a.lat + 0.0005, lon=a.lon)
        moved_b = ParsedVehicle(vehicle_id=b.vehicle_id, trip_id="trip-a",
                                route_id=11, timestamp=110,
                                lat=b.lat, lon=b.lon + 0.0005)
        self.update(moved_b, moved_a)  # feed order must not set identity
        active = self.active_vehicles()
        self.assertEqual(active[a.vehicle_id].lat, [a.lat, moved_a.lat])
        self.assertEqual(active[b.vehicle_id].lon, [b.lon, moved_b.lon])

    def test_trip_change_resets_trail_and_shape(self):
        a = self.vehicle
        payload = self.update(a)
        self.assertEqual(payload["shapeIds"], [None])  # no static data
        next_trip = ParsedVehicle(vehicle_id=a.vehicle_id, trip_id="trip-b",
                                  route_id=12, timestamp=120,
                                  lat=a.lat + 0.002, lon=a.lon)
        payload = self.update(next_trip)
        self.assertEqual(payload["routeIds"], [12])
        self.assertEqual(payload["tripIds"], ["trip-b"])
        self.assertEqual(len(self.active_vehicles()[a.vehicle_id].lat), 1)


class ReportDelayTest(unittest.TestCase):
    def setUp(self):
        clock = patch("server.state.time_now", return_value=1000)
        self.clock = clock.start()
        self.addCleanup(clock.stop)
        self.state = RealtimeState(vehicles={}, timestamp=0, active_static_key=None)
        self.vehicle = ParsedVehicle(vehicle_id="1", trip_id="t1", route_id=11,
                                     timestamp=100, lat=45.79, lon=15.93)

    def update(self, vehicle=None, feed_timestamp=None):
        v = vehicle if vehicle is not None else self.vehicle
        if feed_timestamp is None:
            feed_timestamp = v.timestamp + 5
        self.state.update(ParsedFeed(vehicles=[v], timestamp=feed_timestamp), None)
        return self.state.to_json_v1()["vehicles"]["reportDelays"]

    def test_report_delay_equals_feed_minus_vehicle_time(self):
        self.assertEqual(self.update(feed_timestamp=105), [5])
        moved = ParsedVehicle(vehicle_id="1", trip_id="t1", route_id=11,
                              timestamp=110, lat=45.79, lon=15.93)
        self.assertEqual(self.update(moved, feed_timestamp=115), [5])

    def test_late_vehicle_gets_age_based_delay(self):
        # A vehicle that stopped reporting, then re-appears stale.
        self.update(feed_timestamp=100)
        self.clock.return_value = 1330
        stale = ParsedVehicle(vehicle_id="1", trip_id="t1", route_id=11,
                              timestamp=690, lat=45.79, lon=15.93)
        self.assertEqual(self.update(stale, feed_timestamp=700), [10])
        # Continuous observation with the same timestamp retains the estimate.
        self.assertEqual(self.update(stale, feed_timestamp=710), [10])
        # A new observation gap recomputes from position age.
        self.clock.return_value = 1630
        self.assertEqual(self.update(stale, feed_timestamp=720), [30])

    def test_invalid_timestamps_yield_none(self):
        bad = ParsedVehicle(vehicle_id="1", trip_id="t1", route_id=11,
                            timestamp=0, lat=45.79, lon=15.93)
        self.assertEqual(self.update(bad, feed_timestamp=110), [None])


if __name__ == "__main__":
    unittest.main()
