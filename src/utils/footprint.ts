import type { Feature, Polygon, MultiPolygon, Position } from 'geojson';
import { chinaCities } from '@/static/city';
import { type Activity, locationForRun } from './utils';
import { decodeRoute } from '@/components/RunScan';

export type Region = Feature<Polygon | MultiPolygon>;
export type Visit = {
  activity: Activity;
  province?: string;
  country?: string;
  city?: string;
  point?: [number, number];
};
function inRing(point: Position, ring: Position[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x, y] = ring[i],
      [a, b] = ring[j];
    if (
      y > point[1] !== b > point[1] &&
      point[0] < ((a - x) * (point[1] - y)) / (b - y) + x
    )
      inside = !inside;
  }
  return inside;
}
function contains(region: Region, point: Position) {
  const polygons =
    region.geometry.type === 'Polygon'
      ? [region.geometry.coordinates]
      : region.geometry.coordinates;
  return polygons.some(
    (p) =>
      inRing(point, p[0]) && !p.slice(1).some((hole) => inRing(point, hole))
  );
}
export const regionName = (region: Region) =>
  String(region.properties?.name || '');
export const regionKey = (region: Region) =>
  String(
    region.properties?.id
      ? `province:${region.properties.id}`
      : `country:${region.properties?.iso_a3 && region.properties.iso_a3 !== '-99' ? region.properties.iso_a3 : regionName(region)}`
  );
// The bundled world map splits some countries into multiple island features.
// Merge these into one logical region for rendering, counts and selection.
export function mergeRegions(regions: Region[]): Region[] {
  const result = new Map<string, Region>();
  for (const region of regions) {
    const key = regionKey(region);
    const previous = result.get(key);
    if (!previous) result.set(key, region);
    else {
      const polygons = (r: Region) =>
        r.geometry.type === 'Polygon'
          ? [r.geometry.coordinates]
          : r.geometry.coordinates;
      result.set(key, {
        ...previous,
        geometry: {
          type: 'MultiPolygon',
          coordinates: [...polygons(previous), ...polygons(region)],
        },
      });
    }
  }
  return [...result.values()];
}
export function buildVisits(
  activities: Activity[],
  regions: Region[]
): Visit[] {
  const provinces = regions.filter((r) => r.properties?.id);
  const countries = regions.filter((r) => !r.properties?.id);
  return activities.map((activity) => {
    const location = locationForRun(activity);
    const text = activity.location_country || '';
    const lat = text.match(/['"]latitude['"]:\s*([-\d.]+)/)?.[1];
    const lng = text.match(/['"]longitude['"]:\s*([-\d.]+)/)?.[1];
    const route = decodeRoute(activity);
    const point: [number, number] | undefined = route.length
      ? [route[0][1], route[0][0]]
      : lat && lng
        ? [Number(lng), Number(lat)]
        : undefined;
    const district = text.match(/['"]districtCode['"]:\s*['"](\d{6})/)?.[1];
    const city = chinaCities.find(
      (c) => c.code === `${district?.slice(0, 4)}00` || c.name === location.city
    );
    // Prefer a recorded administrative code/name. GPS is a fallback for garbled
    // old location text. Lighting means an activity location, not area coverage.
    const province =
      provinces.find(
        (r) =>
          String(r.properties?.id) === district?.slice(0, 2) ||
          regionName(r) === location.province
      ) ||
      (point && provinces.find((r) => contains(r, point)));
    const country = province
      ? countries.find((r) => r.properties?.iso_a3 === 'CHN')
      : countries.find((r) =>
          [regionName(r), r.properties?.full_name].includes(location.country)
        ) ||
        (point && countries.find((r) => contains(r, point)));
    return {
      activity,
      point,
      city: city?.name || location.city || undefined,
      province: province ? regionKey(province) : undefined,
      country: country ? regionKey(country) : undefined,
    };
  });
}
