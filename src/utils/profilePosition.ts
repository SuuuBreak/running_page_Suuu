import type { ElevationProfile } from '@/hooks/useRouteElevation';

export function interpolate(start: number, end: number, fraction: number) {
  return start + (end - start) * fraction;
}

// Profiles are ordered by GPS distance. Use the same point on the profile
// chart and in the spatial view, including between recorded samples.
export function profilePosition(profile: ElevationProfile, ratio: number) {
  const { samples } = profile;
  const distance = Math.min(1, Math.max(0, ratio)) * profile.distance;
  return distanceInterval(
    samples.length,
    (index) => samples[index][0],
    distance
  );
}

export function distanceInterval(
  count: number,
  distanceAt: (index: number) => number,
  distance: number
) {
  let left = 0;
  let right = count - 1;
  while (right - left > 1) {
    const middle = Math.floor((left + right) / 2);
    if (distanceAt(middle) < distance) left = middle;
    else right = middle;
  }
  const segmentLength = distanceAt(right) - distanceAt(left);
  const fraction = segmentLength
    ? (distance - distanceAt(left)) / segmentLength
    : 0;
  return { left, right, fraction, distance };
}
