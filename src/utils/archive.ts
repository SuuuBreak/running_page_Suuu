import type { Activity } from '@/utils/utils';
import { convertMovingTime2Sec, titleForRun } from '@/utils/utils';

export const formatNumber = (value: number, digits = 0) =>
  new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number.isFinite(value) ? value : 0);
export const formatDate = (activity: Activity) =>
  new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(activity.start_date_local.replace(' ', 'T')));
export const formatPace = (meters: number, seconds: number) => {
  if (!(meters > 0 && seconds > 0)) return '—';
  const pace = Math.round(seconds / (meters / 1000));
  return `${Math.floor(pace / 60)}′${String(pace % 60).padStart(2, '0')}″`;
};
export const formatDuration = (seconds: number) =>
  `${Math.floor(seconds / 3600)}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
export const activityName = (activity: Activity) =>
  titleForRun(activity) ||
  (activity.type === 'VirtualRun' ? '室内跑步' : '户外跑步');
export const summarizeActivities = (runs: Activity[]) => {
  let distance = 0,
    seconds = 0,
    elevation = 0,
    hrTotal = 0,
    hrSeconds = 0;
  for (const run of runs) {
    const time = convertMovingTime2Sec(run.moving_time);
    distance += run.distance || 0;
    seconds += time;
    elevation += run.elevation_gain || 0;
    if (run.average_heartrate && time > 0) {
      hrTotal += run.average_heartrate * time;
      hrSeconds += time;
    }
  }
  return {
    distance,
    seconds,
    count: runs.length,
    days: new Set(runs.map((r) => r.start_date_local.slice(0, 10))).size,
    pace: formatPace(distance, seconds),
    elevation,
    heartRate: hrSeconds ? Math.round(hrTotal / hrSeconds) : null,
  };
};
