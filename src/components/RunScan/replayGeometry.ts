import { distanceInterval, interpolate } from '@/utils/profilePosition';

export type RouteVertex = {
  x: number;
  y: number;
  z: number;
  distance: number;
  altitude?: number;
};
type XY = [number, number];

export function gpsDistances(points: XY[]) {
  let meters = 0;
  const radians = Math.PI / 180;
  return points.map(([lat, lng], i) => {
    if (i) {
      const [prevLat, prevLng] = points[i - 1];
      const a =
        Math.sin(((lat - prevLat) * radians) / 2) ** 2 +
        Math.cos(prevLat * radians) *
          Math.cos(lat * radians) *
          Math.sin(((lng - prevLng) * radians) / 2) ** 2;
      meters += 12742000 * Math.asin(Math.sqrt(Math.min(1, a)));
    }
    return meters;
  });
}

export function routePosition(route: RouteVertex[], ratio: number) {
  if (route.length < 2) return null;
  const total = route[route.length - 1].distance;
  const distance = Math.min(1, Math.max(0, ratio)) * total;
  const { left, right, fraction } = distanceInterval(
    route.length,
    (i) => route[i].distance,
    distance
  );
  const a = route[left];
  const b = route[right];
  return {
    left,
    x: interpolate(a.x, b.x, fraction),
    y: interpolate(a.y, b.y, fraction),
    z: interpolate(a.z, b.z, fraction),
    altitude:
      a.altitude !== undefined && b.altitude !== undefined
        ? interpolate(a.altitude, b.altitude, fraction)
        : undefined,
    distance,
  };
}

// Test the rendered line in screen space so picking follows orbit, zoom and tilt.
export function pickRoute(
  points: XY[],
  route: RouteVertex[],
  x: number,
  y: number,
  radius: number,
  progress: number
) {
  const total = route.at(-1)?.distance || 0;
  if (!total || points.length !== route.length) return null;
  let best = radius * radius;
  let result: number | null = null;
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1];
    const dx = points[i][0] - ax;
    const dy = points[i][1] - ay;
    const squared = dx * dx + dy * dy;
    const t = squared
      ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / squared))
      : 0;
    const error = (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2;
    const ratio =
      interpolate(route[i - 1].distance, route[i].distance, t) / total;
    if (
      error < best - 0.01 ||
      (result !== null &&
        Math.abs(error - best) <= 0.01 &&
        Math.abs(ratio - progress) < Math.abs(result - progress))
    ) {
      best = error;
      result = ratio;
    }
  }
  return result;
}
