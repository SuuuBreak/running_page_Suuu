import { useEffect, useState } from 'react';
import type { Activity } from '@/utils/utils';

export type ElevationProfile = {
  source: 'GPX';
  points: number;
  rawMin: number;
  rawMax: number;
  distance: number;
  // distance, latitude, longitude, original elevation, smoothed elevation (meters)
  samples: [number, number, number, number, number][];
};
const cache = new Map<number, ElevationProfile>();
let manifest: Promise<Record<string, unknown>> | undefined;
const base = `${import.meta.env.BASE_URL}route-elevation/`;

export default function useRouteElevation(activity?: Activity) {
  const id = activity?.run_id;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    id?: number;
    profile?: ElevationProfile;
    status: 'loading' | 'ready' | 'missing' | 'error';
  }>({ status: 'loading' });
  useEffect(() => {
    if (!id) {
      setState({ id, status: 'missing' });
      return;
    }
    if (cache.has(id)) {
      setState({ id, profile: cache.get(id), status: 'ready' });
      return;
    }
    let active = true;
    const controller = new AbortController();
    setState({ id, status: 'loading' });
    if (!manifest)
      manifest = fetch(`${base}index.json`)
        .then((r) => {
          if (!r.ok) throw new Error('manifest');
          return r.json();
        })
        .catch((error) => {
          manifest = undefined;
          throw error;
        });
    manifest
      .then(async (index) => {
        if (!active) return;
        if (!index[String(id)]) {
          setState({ id, status: 'missing' });
          return;
        }
        const response = await fetch(`${base}${id}.json`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('profile');
        const profile: ElevationProfile = await response.json();
        cache.set(id, profile);
        if (active) setState({ id, profile, status: 'ready' });
      })
      .catch(() => {
        if (active) setState({ id, status: 'error' });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [id, attempt]);
  const current =
    state.id === id
      ? state
      : { status: 'loading' as const, profile: undefined };
  return { ...current, retry: () => setAttempt((previous) => previous + 1) };
}

export type RouteElevationState = ReturnType<typeof useRouteElevation>;
