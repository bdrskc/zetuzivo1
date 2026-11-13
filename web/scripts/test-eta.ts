
// ETA unit checks — runnable with plain Node (type stripping):
//   node scripts/test-eta.ts
// Verifies arrival-tier ordering:
//   TripUpdate stop_time_update > TripUpdate delay > distance estimate > timetable,
// plus "vehicle already passed the stop" dropping and Croatian labels.

import assert from "node:assert/strict";
import {
  computeStopDepartures,
  minutesText,
  formatClock,
  normalizeStopServices,
  type StopServices,
  type StopDepartureInputs,
} from "../src/eta.ts";
import type { TripUpdateInfo, Vehicle } from "../src/protocol.ts";

// 2026-11-09 06:50 UTC == 07:50 Europe/Zagreb (CET).
const now = Date.UTC(2026, 10, 9, 6, 50, 0) / 1000;

const stopsById = {
  s1: { lat: 45.8, lon: 15.9 },
  s2: { lat: 45.8, lon: 15.904 },
  s3: { lat: 45.8, lon: 15.908 },
};
const shapesById = {
  shapeA: { lats: [45.8, 45.8, 45.8], lons: [15.9, 15.904, 15.908] },
};

type Times = [string, number, string | null, string | null][];

function service(tripId: string, routeId: number, times: Times) {
  return {
    tripId,
    routeId,
    headsign: tripId === "trip-a" ? "Borongaj" : "V. Gorica",
    directionId: 0,
    shapeId: "shapeA",
    times: times.map(([stopId, seq, arrival, departure]) => ({
      stopId,
      seq,
      arrival: arrival != null ? Number(arrival) : null,
      departure: departure != null ? Number(departure) : null,
    })),
  };
}

function services(a: StopServices["services"][number]): StopServices {
  return {
    stopId: "s2",
    name: "Sredina",
    lat: 45.8,
    lon: 15.904,
    services: [a],
  };
}

function vehicle(tripId: string): Vehicle {
  return {
    vehicleId: "v1",
    tripId,
    blockId: "b1",
    routeId: 11,
    shapeId: "shapeA",
    timestamp: now,
    hasInvalidTimestamp: false,
    reportDelay: 0,
    directionDegrees: 90,
    lat: [45.8005],
    lon: [15.9005],
  };
}

function tripUpdate(
  tripId: string,
  stus: { stopId: string; arrivalTime?: number | null; arrivalDelay?: number | null }[],
  delay?: number | null,
): TripUpdateInfo {
  return {
    tripId,
    delay,
    timestamp: now,
    stopTimeUpdates: stus.map((s) => ({
      stopId: s.stopId,
      seq: null,
      arrivalTime: s.arrivalTime ?? null,
      arrivalDelay: s.arrivalDelay ?? null,
    })),
  };
}

function inputs(overrides: Partial<StopDepartureInputs> = {}): StopDepartureInputs {
  return {
    services: services(service("trip-a", 11, [
      ["s1", 1, "28800", "28800"],
      ["s2", 2, "29100", "29100"],
      ["s3", 3, "29400", "29400"],
    ])),
    stopsById,
    vehicles: [vehicle("trip-a")],
    tripUpdates: [],
    shapesById,
    samplesByTrip: {
      "trip-a": [
        { ts: now - 2, lat: 45.8, lon: 15.9002 },
        { ts: now - 1, lat: 45.8, lon: 15.9004 },
      ],
    },
    now,
    ...overrides,
  };
}
// 1) Tier 1: TripUpdate STU arrival.time wins.
{
  const update = tripUpdate("trip-a", [{ stopId: "s2", arrivalTime: now + 300 }]);
  const rows = computeStopDepartures(inputs({ tripUpdates: [update] }));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "live");
  assert.equal(rows[0].seconds!, 300);
  assert.equal(rows[0].clock, "08:05");
  console.log("tier1 arrTime ok");
}

// 2) Tier 1 fallback: scheduled + arrival.delay.
{
  const update = tripUpdate("trip-a", [{ stopId: "s2", arrivalTime: null, arrivalDelay: 120 }]);
  const rows = computeStopDepartures(inputs({ tripUpdates: [update] }));
  assert.equal(rows[0].kind, "live");
  assert.equal(rows[0].seconds!, 1020);
  console.log("tier1 delay ok");
}

// 3) Tier 2: TripUpdate-level delay applied to the timetable.
{
  const update = tripUpdate("trip-a", [], 90);
  const rows = computeStopDepartures(inputs({ tripUpdates: [update] }));
  assert.equal(rows[0].kind, "live");
  assert.equal(rows[0].seconds!, 990);
  console.log("tier2 delay ok");
}

// 4) Tier 3: positions only — distance along shape / implied speed.
{
  const rows = computeStopDepartures(inputs());
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "procjena");
  assert.ok(rows[0].seconds! > 0 && rows[0].seconds! < 120);
  console.log("tier3 estimate ok:", Math.round(rows[0].seconds!));
}

// 5) No live vehicle -> no rows at all (timetable is not shown).
{
  const rows = computeStopDepartures(inputs({ vehicles: [], samplesByTrip: {} }));
  assert.equal(rows.length, 0, "no timetable rows when no live vehicle will reach the stop");
  console.log("no timetable-only rows ok");
}

// 6) A vehicle that already passed the stop is dropped, not estimated.
{
  const passed = vehicle("trip-a");
  passed.lat = [45.8];
  passed.lon = [15.906]; // between s2 (index 1) and s3
  const rows = computeStopDepartures(inputs({ vehicles: [passed], samplesByTrip: {} }));
  assert.equal(rows.length, 0, "no row once the vehicle passed the stop");
  console.log("passed-vehicle skip ok");
}



// 7) Croatian labels: under a minute "sada", otherwise whole minutes.
{
  assert.equal(minutesText(0), "sada");
  assert.equal(minutesText(59.9), "sada");
  assert.equal(minutesText(60), "1 min");
  assert.equal(minutesText(180), "3 min");
  assert.equal(formatClock(25 * 3600 + 5 * 60), "01:05");
  console.log("label formatting ok");
}

// 8) Tier set for one stop: only live signals, never the timetable.
{
  const mixed: StopServices = {
    stopId: "s2",
    name: "Sredina",
    lat: 45.8,
    lon: 15.904,
    services: [
      service("trip-live", 11, [["s1", 1, "28800", "28800"], ["s2", 2, "29100", "29100"]]),
      service("trip-tu", 11, [["s1", 1, "28800", "28800"], ["s2", 2, "29100", "29100"]]),
      service("trip-tt", 11, [["s1", 1, "28800", "28800"], ["s2", 2, "29100", "29100"]]),
    ],
  };
  const rows = computeStopDepartures({
    services: mixed,
    stopsById,
    vehicles: [
      { ...vehicle("trip-live"), tripId: "trip-live" },
      { ...vehicle("trip-tu"), tripId: "trip-tu" },
    ],
    tripUpdates: [tripUpdate("trip-tu", [{ stopId: "s2", arrivalTime: now + 600 }], null)],
    shapesById,
    samplesByTrip: {
      "trip-live": [
        { ts: now - 2, lat: 45.8, lon: 15.9002 },
        { ts: now - 1, lat: 45.8, lon: 15.9004 },
      ],
    },
    now,
  });
  const kinds = rows.map((r) => r.kind).sort((a, b) => a.localeCompare(b));
  assert.deepEqual(kinds, ["live", "procjena"]);
  assert.ok(!rows.some((r) => r.kind === "vozni red"), "no vozni red rows are emitted");
  console.log("tier set ok (live + procjena only)");
}

// 11) A bend in the shape makes the estimate longer than the straight chord.
{
  const bent = {
    shapeA: {
      lats: [45.8, 45.81, 45.8, 45.8],
      lons: [15.9, 15.902, 15.904, 15.908],
    },
  };
  const withBend = computeStopDepartures(inputs({ shapesById: bent, samplesByTrip: inputs().samplesByTrip }));
  const straight = computeStopDepartures(inputs({ shapesById: {}, samplesByTrip: inputs().samplesByTrip }));
  assert.ok(withBend[0].seconds! > straight[0].seconds!, "shape bend is longer than the chord");
  console.log("shape distance ok", Math.round(straight[0].seconds!), "->", Math.round(withBend[0].seconds!));
}

console.log("ETA TESTS PASSED");


// 9) Server wire shape (compact arrays) normalized to objects yields live rows.
{
  const wire = JSON.parse(JSON.stringify(services(service("trip-a", 11, [
    ["s1", 1, "28800", "28800"],
    ["s2", 2, "29100", "29100"],
  ]))));
  const normalized = normalizeStopServices(wire);
  const rows = computeStopDepartures({
    ...inputs(),
    services: normalized,
    vehicles: [vehicle("trip-a")],
  });
  assert.ok(rows.length >= 1, "normalized wire payload yields a live/estimate row");
  assert.ok(
    rows.every((r) => r.kind === "live" || r.kind === "procjena"),
    `no vozni red rows (got ${rows.map((r) => r.kind).join(",")})`,
  );
  console.log("wire array -> objects normalization ok");
}



// 10) A vehicle many stops before the selected stop is still shown.
{
  const stopsLon: Record<string, { lat: number; lon: number }> = {};
  for (let i = 1; i <= 15; ++i) stopsLon[`s${i}`] = { lat: 45.8, lon: 15.9 + i * 0.001 };
  const longTrip = service("trip-long", 11, [
    ...Array.from({ length: 15 }, (_, i) => [`s${i + 1}`, i + 1,
      String(28800 + i * 300), String(28800 + i * 300)] as [string, number, string, string]),
  ]);
  const vehicleAtS1 = vehicle("trip-long");
  vehicleAtS1.lat = [45.8];
  vehicleAtS1.lon = [15.901];

  const near = computeStopDepartures({
    ...inputs({ vehicles: [vehicleAtS1], samplesByTrip: {} }),
    services: { ...services(longTrip), stopId: "s11" },
    stopsById: stopsLon,
    tripUpdates: [tripUpdate("trip-long", [{ stopId: "s11", arrivalTime: now + 600 }], null)],
  });
  assert.ok(near.some((r) => r.kind === "live"), "gap 10 is shown");

  const far = computeStopDepartures({
    ...inputs({ vehicles: [vehicleAtS1], samplesByTrip: {} }),
    services: { ...services(longTrip), stopId: "s13" },
    stopsById: stopsLon,
    tripUpdates: [tripUpdate("trip-long", [{ stopId: "s13", arrivalTime: now + 40 * 60 }], null)],
  });
  assert.ok(far.some((r) => r.kind === "live" && r.seconds! > 20 * 60), "gap > 10 and over 20 min is shown");
  console.log("no stop-count or 20-minute cap ok");
}
