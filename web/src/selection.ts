import type { Vehicle } from "./protocol";

export interface Selection {
  key: string;
  vehicleId: string | null;
  tripId: string | null;
  routeId: number;
  shapeId: string | null;
}

export function selectionFromVehicle(vehicle: Vehicle): Selection {
  return {
    key: `${vehicle.vehicleId ?? ""}:${vehicle.tripId ?? ""}`,
    vehicleId: vehicle.vehicleId,
    tripId: vehicle.tripId,
    routeId: vehicle.routeId,
    shapeId: vehicle.shapeId,
  };
}

export function findSelectedVehicle(vehicles: Vehicle[], selection: Selection | null): Vehicle | null {
  if (!selection) return null;
  let match: Vehicle | null = null;
  for (const vehicle of vehicles) {
    const matches = selection.vehicleId
      ? vehicle.vehicleId === selection.vehicleId
      : selection.tripId
        ? vehicle.tripId === selection.tripId
        : false;
    if (matches && (match === null || vehicle.timestamp > match.timestamp)) {
      match = vehicle;
    }
  }
  return match;
}
