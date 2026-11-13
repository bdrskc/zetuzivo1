// Animator unit checks, runnable with plain Node (type stripping):
//   node scripts/test-animation.ts
// Catch-up motion: a new fix is the destination of the NEXT interval, so
// sampling "now" just after an update is still at the previous point, and
// the marker arrives there over the observed gap. No route snapping.

import assert from "node:assert/strict";
import { VehicleAnimator, triKey } from "../src/vehicleAnimation.ts";
import type { Vehicle } from "../src/protocol.ts";

const realNow = Date.now.bind(Date);
let fakeNowMs = 1_000_000_000_000;
Date.now = () => fakeNowMs;
const wall = () => fakeNowMs / 1000;

function makeVehicle(
  id: string,
  lat: number,
  lon: number,
  shapeId: string | null = null,
  tripId = "trip-a",
  timestamp = 0,
): Vehicle {
  return {
    vehicleId: id,
    tripId,
    blockId: null,
    routeId: 11,
    shapeId,
    timestamp,
    hasInvalidTimestamp: false,
    reportDelay: 0,
    directionDegrees: null,
    lat: [lat],
    lon: [lon],
  };
}

function toMeters(latA: number, lonA: number, latB: number, lonB: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(latB - latA) / 2) ** 2 +
    Math.cos(rad(latA)) * Math.cos(rad(latB)) * Math.sin(rad(lonB - lonA) / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function endOf(v: Vehicle): [number, number] {
  return [v.lat[v.lat.length - 1], v.lon[v.lon.length - 1]];
}

// 1) Catch-up, not a replay of the past. After the second fix the marker is
//    still at A, halfway 5 s later, and at B once the gap has elapsed.
{
  const animator = new VehicleAnimator();
  fakeNowMs = 1_000_000_000_000;
  animator.update([makeVehicle("1", 45.815, 15.9819)], 1000);
  const first = endOf(animator.sample(wall())[0]);
  assert.ok(toMeters(first[0], first[1], 45.815, 15.9819) < 1, "first fix snaps to A");

  fakeNowMs = 1_000_000_010_000;
  animator.update([makeVehicle("1", 45.815, 15.9828)], 1010);
  const atUpdate = endOf(animator.sample(wall())[0]);
  assert.ok(
    toMeters(atUpdate[0], atUpdate[1], 45.815, 15.9819) < 1,
    "just after the new fix the marker has not jumped to B",
  );

  fakeNowMs = 1_000_000_015_000;
  const mid = endOf(animator.sample(wall())[0]);
  const dA = toMeters(45.815, 15.9819, mid[0], mid[1]);
  const dB = toMeters(45.815, 15.9828, mid[0], mid[1]);
  assert.ok(dA > 25 && dB > 25, `midway between fixes (dA=${dA.toFixed(0)} dB=${dB.toFixed(0)})`);

  fakeNowMs = 1_000_000_020_000;
  const done = endOf(animator.sample(wall())[0]);
  assert.ok(toMeters(done[0], done[1], 45.815, 15.9828) < 1, "arrives at B after the gap");

  fakeNowMs = 1_000_000_030_000;
  const held = endOf(animator.sample(wall())[0]);
  const past = toMeters(held[0], held[1], 45.815, 15.9828);
  assert.ok(past > 6 && past < 28, `coasts past B instead of freezing (got ${past.toFixed(0)} m)`);
  fakeNowMs = 1_000_000_032_000;
  const settled = endOf(animator.sample(wall())[0]);
  assert.ok(toMeters(settled[0], settled[1], held[0], held[1]) < 1, "coast has stopped");
  console.log("catch-up lerp ok");
}

// 2) An early fix retargets from the current on-screen point, never back to A.
{
  const animator = new VehicleAnimator();
  fakeNowMs = 1_000_000_000_000;
  animator.update([makeVehicle("2", 45.815, 15.98)], 0);
  fakeNowMs = 1_000_000_010_000;
  animator.update([makeVehicle("2", 45.815, 15.982)], 10);
  fakeNowMs = 1_000_000_015_000; // halfway toward B
  const mid = endOf(animator.sample(wall())[0]);
  animator.update([makeVehicle("2", 45.815, 15.983)], 15);
  const retarget = endOf(animator.sample(wall())[0]);
  assert.ok(
    toMeters(retarget[0], retarget[1], mid[0], mid[1]) < 1,
    "early fix continues from the rendered position",
  );
  assert.ok(
    toMeters(retarget[0], retarget[1], 45.815, 15.98) > 20,
    "does not snap back to the older fix",
  );
  console.log("retarget ok");
}

// 3) Bearing follows the leg actually being travelled (east ≈ 90).
{
  const animator = new VehicleAnimator();
  fakeNowMs = 1_000_000_000_000;
  animator.update([makeVehicle("3", 45.805, 15.98)], 0);
  fakeNowMs = 1_000_000_010_000;
  animator.update([makeVehicle("3", 45.805, 15.985)], 10);
  fakeNowMs = 1_000_000_015_000;
  const mid = animator.sample(wall())[0].directionDegrees;
  assert.ok(mid != null && Math.abs(mid - 90) < 3, `eastbound bearing (got ${mid})`);
  fakeNowMs = 1_000_000_025_000;
  const held = animator.sample(wall())[0].directionDegrees;
  assert.ok(held != null && Math.abs(held - 90) < 3, `bearing holds (got ${held})`);
  console.log("bearing ok");
}

// 4) Teleport: >800 m snaps to the new position instead of gliding across town.
{
  const animator = new VehicleAnimator();
  fakeNowMs = 1_000_000_000_000;
  animator.update([makeVehicle("4", 45.815, 15.98)], 0);
  fakeNowMs = 1_000_000_010_000;
  animator.update([makeVehicle("4", 45.82, 16.03)], 10);
  const v = endOf(animator.sample(wall())[0]);
  assert.ok(toMeters(45.82, 16.03, v[0], v[1]) < 2, "teleport snaps to target");
  console.log("teleport ok");
}

// 5) A feed gap longer than 45 s snaps.
{
  const animator = new VehicleAnimator();
  fakeNowMs = 1_000_000_000_000;
  animator.update([makeVehicle("5", 45.8, 15.98)], 0);
  fakeNowMs = 1_000_000_060_000;
  animator.update([makeVehicle("5", 45.8005, 15.9805)], 60);
  const v = endOf(animator.sample(wall())[0]);
  assert.ok(toMeters(45.8005, 15.9805, v[0], v[1]) < 2, "stale gap snaps");
  console.log("stale-gap snap ok");
}

// 6) Vehicles that leave the feed are dropped; others keep moving.
{
  const animator = new VehicleAnimator();
  fakeNowMs = 1_000_000_000_000;
  animator.update([makeVehicle("a", 45.81, 15.98), makeVehicle("b", 45.82, 15.99, null, "trip-b")], 0);
  fakeNowMs = 1_000_000_010_000;
  animator.update([makeVehicle("b", 45.8201, 15.9901, null, "trip-b")], 10);
  const ids = animator.sample(wall()).map((v) => v.vehicleId);
  assert.deepEqual(ids, ["b"]);
  console.log("drop missing vehicle ok");
}

// North ~330 m, then east ~230 m. Short enough that the step is not a teleport.
const bend = {
  lats: [45.8, 45.803, 45.803],
  lons: [15.9, 15.9, 15.903],
};

// 7) A tram GPS fix lands on the nearest point of its route.
{
  const animator = new VehicleAnimator();
  animator.setShapes({ s1: bend });
  fakeNowMs = 1_000_000_000_000;
  // ~30 m east of the middle of the northbound leg.
  animator.update([makeVehicle("t", 45.8015, 15.90039, "s1")], 0);
  const p = endOf(animator.sample(wall())[0]);
  assert.ok(toMeters(45.8015, 15.9, p[0], p[1]) < 8, `snapped onto the leg (${p})`);
  console.log("tram snap ok");
}

// 8) Between two fixes the tram follows the bend, not the chord.
{
  const animator = new VehicleAnimator();
  animator.setShapes({ s1: bend });
  fakeNowMs = 1_000_000_000_000;
  animator.update([makeVehicle("t", 45.80015, 15.90004, "s1")], 0);
  fakeNowMs = 1_000_000_010_000;
  animator.update([makeVehicle("t", 45.80304, 15.9027, "s1")], 10);
  fakeNowMs = 1_000_000_015_000;
  const mid = endOf(animator.sample(wall())[0]);
  assert.ok(Math.abs(mid[1] - 15.9) < 0.0002, `midpoint stays on the north leg (lon ${mid[1]})`);
  assert.ok(mid[0] > 45.8012, `midpoint has climbed the leg (lat ${mid[0]})`);
  const bearing = animator.sample(wall())[0].directionDegrees;
  assert.ok(bearing != null && (bearing < 15 || bearing > 345), `northbound bearing (got ${bearing})`);
  console.log("along-route motion ok");
}

// 9) A parallel return track that is closer in a straight line does not steal the tram.
{
  const loop = {
    lats: [45.8, 45.8, 45.80025, 45.80025],
    lons: [15.9, 15.905, 15.905, 15.9],
  };
  const animator = new VehicleAnimator();
  animator.setShapes({ s1: loop });
  fakeNowMs = 1_000_000_000_000;
  animator.update([makeVehicle("t", 45.8, 15.9003, "s1")], 0);
  fakeNowMs = 1_000_000_010_000;
  // 18 m north of the outbound midpoint — nearer the return track.
  animator.update([makeVehicle("t", 45.800162, 15.9025, "s1")], 10);
  fakeNowMs = 1_000_000_020_000;
  const p = endOf(animator.sample(wall())[0]);
  assert.ok(p[0] < 45.80008, `stays on the outbound leg (lat ${p[0]})`);
  console.log("loop stick ok");
}

// 10) A fix far from the shape is not dragged onto it.
{
  const animator = new VehicleAnimator();
  animator.setShapes({ s1: bend });
  fakeNowMs = 1_000_000_000_000;
  animator.update([makeVehicle("far", 45.8, 15.9032, "s1")], 0);
  const far = endOf(animator.sample(wall())[0]);
  assert.ok(Math.abs(far[1] - 15.9032) < 1e-6, "distant vehicle keeps GPS");
  console.log("no false snap ok");
}

// 12) A bus GPS fix lands on its own route, same as a tram.
{
  const animator = new VehicleAnimator();
  animator.setShapes({ s1: { lats: [45.8, 45.8], lons: [15.9, 15.905] } });
  fakeNowMs = 1_000_000_000_000;
  const bus = makeVehicle("bus", 45.80028, 15.902, "s1");
  bus.routeId = 268;
  animator.update([bus], 0);
  const p = endOf(animator.sample(wall())[0]);
  assert.ok(Math.abs(p[0] - 45.8) < 0.00008, `bus snapped onto the route (lat ${p[0]})`);
  console.log("bus snap ok");
}

// 11) GPS wobble across an east-west street must not turn the tram north.
{
  const animator = new VehicleAnimator();
  animator.setShapes({ s1: { lats: [45.8, 45.8], lons: [15.9, 15.905] } });
  fakeNowMs = 1_000_000_000_000;
  animator.update([makeVehicle("ew", 45.8003, 15.902, "s1")], 0);
  const first = animator.sample(wall())[0].directionDegrees;
  const axisOff = (deg: number | null) => {
    if (deg == null) return 180;
    const a = ((deg % 180) + 180) % 180;
    return Math.min(Math.abs(a - 90), 180 - Math.abs(a - 90));
  };
  assert.ok(axisOff(first) < 20, `stopped tram follows the street (got ${first})`);
  fakeNowMs = 1_000_000_010_000;
  animator.update([makeVehicle("ew", 45.8005, 15.90208, "s1")], 10);
  fakeNowMs = 1_000_000_020_000;
  const later = animator.sample(wall())[0].directionDegrees;
  assert.ok(axisOff(later) < 20, `sideways jitter stays along the street (got ${later})`);
  console.log("route heading ok");
}

// 13) A fix behind the tram does not turn it around. Nose follows the shape.
{
  const animator = new VehicleAnimator();
  animator.setShapes({ s1: { lats: [45.8, 45.8], lons: [15.9, 15.905] } });
  fakeNowMs = 1_000_000_000_000;
  animator.update([makeVehicle("dir", 45.8, 15.901, "s1")], 0);
  fakeNowMs = 1_000_000_010_000;
  animator.update([makeVehicle("dir", 45.8, 15.903, "s1")], 10);
  fakeNowMs = 1_000_000_020_000;
  const forward = animator.sample(wall())[0].directionDegrees;
  fakeNowMs = 1_000_000_030_000;
  animator.update([makeVehicle("dir", 45.80002, 15.9022, "s1")], 30);
  const later = animator.sample(wall())[0].directionDegrees;
  assert.ok(forward != null && Math.abs(forward - 90) < 20, `faces along the shape (got ${forward})`);
  assert.ok(later != null && Math.abs(later - 90) < 20, `does not flip when GPS slips back (got ${later})`);
  console.log("no direction flip ok");
}

console.log("ANIMATION TESTS PASSED", triKey({ vehicleId: "1", tripId: "t" }));
void realNow;
