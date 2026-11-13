import datetime
import io
import json
import unittest
import zipfile

from server.staticdata import StopIndex

ROUTES_CSV = "route_id,agency_id,route_short_name,route_long_name,route_type\n11,a,11,Tramvaj,0\n268,a,268,Autobus,3\n"
TRIPS_CSV = (
    "route_id,service_id,trip_id,trip_headsign,direction_id,block_id,shape_id\n"
    "11,wd,trip-a,Borongaj,0,1102,s1\n"
    "11,wd,trip-c,Borongaj,0,1102,s1\n"
    "268,sat,trip-b,V. Gorica,1,26820,s2\n")
CALENDAR_CSV = (
    "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n"
    "wd,1,1,1,1,1,0,0,20260101,20261231\n"
    "sat,0,0,0,0,0,0,0,20260101,20261231\n")
CALENDAR_DATES_CSV = ("service_id,date,exception_type\nsat,20261114,1\n"
                      "sat,20261114,2\n")  # added then removed -> inactive
STOPS_CSV = (
    "stop_id,stop_name,stop_lat,stop_lon,location_type\n"
    "s1,Stara,\"45.8\",\"15.9\",0\n"
    "s2,Sredina,\"45.81\",\"15.91\",0\n"
    "s3,Centar,\"45.82\",\"15.92\",0\n"
    "s0,Sredina,\"45.815\",\"15.915\",1\n")
STOP_TIMES_CSV = (
    "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n"
    "trip-a,08:00:00,08:00:00,s1,1\n"
    "trip-a,08:05:00,08:05:00,s2,2\n"
    "trip-a,08:10:00,08:10:00,s3,3\n"
    "trip-c,09:00:00,09:00:00,s2,1\n"
    "trip-c,09:05:00,09:05:00,s3,2\n"
    "trip-b,20:00:00,20:00:00,s1,1\n"
    "trip-b,20:10:00,20:10:00,s2,2\n")
SHAPES_CSV = (
    "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\n"
    "s1,45.8,15.9,1\n"
    "s1,45.81,15.91,2\n"
    "s1,45.82,15.92,3\n"
    "s2,45.81,15.91,1\n"
    "s2,45.82,15.92,2\n")


def make_zip() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as zf:
        for name, content in (
            ("routes.txt", ROUTES_CSV),
            ("trips.txt", TRIPS_CSV),
            ("calendar.txt", CALENDAR_CSV),
            ("calendar_dates.txt", CALENDAR_DATES_CSV),
            ("stops.txt", STOPS_CSV),
            ("stop_times.txt", STOP_TIMES_CSV),
            ("shapes.txt", SHAPES_CSV),
        ):
            zf.writestr(name, content)
    return buffer.getvalue()


class StopIndexTest(unittest.TestCase):
    def test_weekday_service_only(self):
        # 2026-11-09 is a Monday: only trip-a and trip-c (service wd) run.
        index = StopIndex.from_zip_data(make_zip(), datetime.date(2026, 11, 9))
        self.assertEqual(index.stops["s2"], ("Sredina", 45.81, 15.91))
        trip_ids = {str(t["trip_id"]) for t in index.trips}
        self.assertEqual(trip_ids, {"trip-a", "trip-c"})
        # s1 is served only by trip-a on Monday.
        self.assertEqual(
            [str(index.trips[i]["trip_id"]) for i in index.stop_services["s1"]],
            ["trip-a"])

    def test_calendar_date_removal_wins(self):
        # 2026-11-14 Saturday: service sat is added then removed -> trip-b out.
        index = StopIndex.from_zip_data(make_zip(), datetime.date(2026, 11, 14))
        self.assertEqual([str(t["trip_id"]) for t in index.trips], [])

    def test_stops_layer_payload(self):
        index = StopIndex.from_zip_data(make_zip(), datetime.date(2026, 11, 9))
        payload = json.loads(json.dumps(index.stops_layer_json()))
        self.assertEqual(payload["date"], "2026-11-09")
        by_id = {stop[0]: stop for stop in payload["stops"]}
        self.assertEqual(by_id["s2"][1:4], ["Sredina", 45.81, 15.91])
        # Stops keep the set of route ids that serve them today.
        self.assertEqual(sorted(by_id["s2"][4]), [11])
        self.assertEqual(sorted(by_id["s3"][4]), [11])
        self.assertEqual(by_id["s2"][5], "")
        self.assertNotIn("s0", by_id)

    def test_next_run_label(self):
        # Friday: a Saturday-only platform is "sutra". Monday the same stop is "vikendom".
        calendar = (
            "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n"
            "we,0,0,0,0,0,1,1,20260101,20261231\n")
        trips = (
            "route_id,service_id,trip_id,trip_headsign,direction_id,block_id,shape_id\n"
            "113,we,trip-w,Jarun,0,11301,sw\n")
        stops = (
            "stop_id,stop_name,stop_lat,stop_lon,location_type\n"
            "j1,Jarun,\"45.78\",\"15.90\",0\n")
        times = (
            "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n"
            "trip-w,10:00:00,10:00:00,j1,1\n")
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as zf:
            zf.writestr("routes.txt", ROUTES_CSV)
            zf.writestr("trips.txt", trips)
            zf.writestr("calendar.txt", calendar)
            zf.writestr("calendar_dates.txt", "service_id,date,exception_type\n")
            zf.writestr("stops.txt", stops)
            zf.writestr("stop_times.txt", times)
            zf.writestr("shapes.txt", "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\n")
        raw = buffer.getvalue()
        friday = StopIndex.from_zip_data(raw, datetime.date(2026, 11, 13))
        monday = StopIndex.from_zip_data(raw, datetime.date(2026, 11, 9))
        saturday = StopIndex.from_zip_data(raw, datetime.date(2026, 11, 14))
        self.assertEqual(friday.next_label["j1"], "sutra")
        self.assertEqual(monday.next_label["j1"], "vikendom")
        self.assertNotIn("j1", saturday.next_label)
        row = json.loads(json.dumps(friday.stops_layer_json()))["stops"][0]
        self.assertEqual(row[5], "sutra")
        self.assertEqual(row[4], [])

    def test_stop_services_payload(self):
        index = StopIndex.from_zip_data(make_zip(), datetime.date(2026, 11, 9))
        payload = json.loads(json.dumps(index.stop_services_json("s3")))
        self.assertEqual(payload["name"], "Centar")
        trips = {s["tripId"]: s for s in payload["services"]}
        self.assertEqual(set(trips), {"trip-a", "trip-c"})
        trip_a = trips["trip-a"]
        self.assertEqual(trip_a["routeId"], 11)
        self.assertEqual(trip_a["headsign"], "Borongaj")
        self.assertEqual(trip_a["directionId"], 0)
        self.assertEqual(trip_a["shapeId"], "s1")
        # stop_times kept in stop_sequence order: [stopId, seq, arr, dep].
        self.assertEqual(trip_a["times"],
                         [["s1", 1, 8 * 3600, 8 * 3600],
                          ["s2", 2, 8 * 3600 + 300, 8 * 3600 + 300],
                          ["s3", 3, 8 * 3600 + 600, 8 * 3600 + 600]])
        # services are ordered by scheduled arrival at the stop.
        self.assertEqual([s["tripId"] for s in payload["services"]],
                         ["trip-a", "trip-c"])
        self.assertIsNone(index.stop_services_json("missing"))

    def test_finished_trips_left_out(self):
        index = StopIndex.from_zip_data(make_zip(), datetime.date(2026, 11, 9))
        # 08:20 is still inside the 20-minute grace after trip-a (ends 08:10).
        early = index.stop_services_json("s3", now_secs=8 * 3600 + 20 * 60)
        self.assertEqual([s["tripId"] for s in early["services"]],
                         ["trip-a", "trip-c"])
        # By 10:00 both Monday trips have finished.
        late = index.stop_services_json("s3", now_secs=10 * 3600)
        self.assertEqual(late["services"], [])

    def test_same_database_filters_another_day(self):
        from server.staticdata import ScheduleDb
        db = ScheduleDb.from_zip_data(make_zip())
        monday = db.index_for(datetime.date(2026, 11, 9))
        saturday = db.index_for(datetime.date(2026, 11, 14))
        self.assertEqual({t["trip_id"] for t in monday.trips}, {"trip-a", "trip-c"})
        self.assertEqual(saturday.trips, [])

    def test_trip_label_is_line_and_destination(self):
        index = StopIndex.from_zip_data(make_zip(), datetime.date(2026, 11, 9))
        label = index.trip_label("trip-a")
        self.assertEqual(label["routeId"], 11)
        self.assertEqual(label["headsign"], "Borongaj")
        self.assertIsNone(index.trip_label("missing"))

    def test_arrival_at_stop_helper(self):
        index = StopIndex.from_zip_data(make_zip(), datetime.date(2026, 11, 9))
        payload = json.loads(json.dumps(index.stop_services_json("s2")))
        trip_a = next(s for s in payload["services"] if s["tripId"] == "trip-a")
        from server.staticdata import _arrival_at_stop
        self.assertEqual(_arrival_at_stop(trip_a["times"], "s2"),
                         8 * 3600 + 300)


if __name__ == "__main__":
    unittest.main()
