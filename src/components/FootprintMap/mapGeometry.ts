import { decodeRoute } from '@/components/RunScan';
import type { Region, Visit } from '@/utils/footprint';

export type Camera = { x: number; y: number; zoom: number };
export type Point = [number, number];
export const overview: Camera = { x: 0, y: 0, zoom: 1 };
export const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));

export function readCamera(value: string | null): Camera {
  const fields = value?.split(',').map(Number);
  if (!fields || fields.length !== 3 || !fields.every(Number.isFinite))
    return overview;
  return { x: fields[0], y: fields[1], zoom: clamp(fields[2], 0.8, 8) };
}
export const cameraValue = ({ x, y, zoom }: Camera) =>
  [x.toFixed(2), y.toFixed(2), zoom.toFixed(3)].join(',');

export function focusRegion(
  region: Region,
  project: (lng: number, lat: number) => Point
): Camera {
  const rings =
    region.geometry.type === 'Polygon'
      ? region.geometry.coordinates
      : region.geometry.coordinates.flat();
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const ring of rings)
    for (const [lng, lat] of ring) {
      const [x, y] = project(lng, lat);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  if (!Number.isFinite(minX)) return overview;
  const zoom = clamp(
    Math.min(800 / Math.max(1, maxX - minX), 445 / Math.max(1, maxY - minY)),
    0.8,
    7
  );
  return {
    x: (500 - (minX + maxX) / 2) * zoom,
    y: (300 - (minY + maxY) / 2) * zoom,
    zoom,
  };
}

// All routes in a city share one local metre grid, with north at the top.
export function fitCityRoutes(visits: Visit[], width: number, height: number) {
  const decoded = visits
    .map(({ activity }) => ({ activity, points: decodeRoute(activity) }))
    .filter(({ points }) => points.length > 1);
  if (!decoded.length) return { routes: [], pixelsPerMetre: 0 };
  const [lat0, lng0] = decoded[0].points[0];
  const metresLat = (Math.PI * 6371008.8) / 180;
  const metresLng = metresLat * Math.cos((lat0 * Math.PI) / 180);
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  const projected = decoded.map(({ activity, points }) => ({
    activity,
    points: points.map(([lat, lng]): Point => {
      const x = (((lng - lng0 + 540) % 360) - 180) * metresLng;
      const y = (lat0 - lat) * metresLat;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      return [x, y];
    }),
  }));
  const pixelsPerMetre = Math.min(
    (width * 0.8) / Math.max(50, maxX - minX),
    (height * 0.66) / Math.max(50, maxY - minY)
  );
  const cx = (minX + maxX) / 2,
    cy = (minY + maxY) / 2;
  const routes = projected.reverse().map(({ activity, points }) => {
    let prevX = Infinity,
      prevY = Infinity;
    const path: string[] = [];
    points.forEach(([x, y], i) => {
      const sx = width / 2 + (x - cx) * pixelsPerMetre,
        sy = height / 2 + (y - cy) * pixelsPerMetre;
      if (
        i < points.length - 1 &&
        Math.abs(sx - prevX) + Math.abs(sy - prevY) < 0.3
      )
        return;
      path.push(`${path.length ? 'L' : 'M'}${sx.toFixed(2)},${sy.toFixed(2)}`);
      prevX = sx;
      prevY = sy;
    });
    return { activity, path: path.join(' ') };
  });
  return { routes, pixelsPerMetre };
}

export function distanceScale(pixelsPerMetre: number) {
  if (!(pixelsPerMetre > 0)) return null;
  const maxMetres = 95 / pixelsPerMetre;
  const decade = Math.pow(10, Math.floor(Math.log10(maxMetres)));
  const metres = ([5, 2, 1].find((n) => n * decade <= maxMetres) || 1) * decade;
  return {
    width: metres * pixelsPerMetre,
    label: metres >= 1000 ? `${metres / 1000} km` : `${metres} m`,
  };
}
