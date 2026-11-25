import { useEffect, useMemo, useRef, useState } from 'react';
import type { Activity } from '@/utils/utils';
import type {
  ElevationProfile,
  RouteElevationState,
} from '@/hooks/useRouteElevation';
import { formatNumber } from '@/utils/archive';
import { interpolate, profilePosition } from '@/utils/profilePosition';
import './chart.css';

const POSITION_STEPS = 1000;
const PLOT_LEFT = 54;
const PLOT_RIGHT = 32;
const PLOT_TOP = 18;
const PLOT_BOTTOM = 119;
const SVG_HEIGHT = 148;

type CursorProps = {
  cursor?: number | null;
  pinnedCursor?: number | null;
  replayPosition?: number | null;
  onPreviewChange?: (value: number | null) => void;
  onCursorChange?: (value: number | null) => void;
  onJumpToRoute?: () => void;
};

export default function ElevationChart({
  activity,
  elevation,
  cursor,
  pinnedCursor,
  replayPosition,
  onPreviewChange,
  onCursorChange,
  onJumpToRoute,
  smoothed,
  onSmoothedChange,
}: CursorProps & {
  activity: Activity;
  elevation: RouteElevationState;
  smoothed?: boolean;
  onSmoothedChange?: (value: boolean) => void;
}) {
  const { profile, status, retry } = elevation;
  const [localSmoothed, setLocalSmoothed] = useState(true);
  if (!profile)
    return (
      <div
        className="elevation-empty archive-panel"
        data-loading={status === 'loading'}
        id="run-elevation-profile"
        tabIndex={-1}
      >
        <p role="status">
          {status === 'loading'
            ? '正在读取海拔剖面…'
            : status === 'error'
              ? '海拔暂时无法读取。平面路线仍可浏览。'
              : '这条活动只有平面 GPS 路线。'}
        </p>
        {status === 'error' && (
          <button
            className="workspace-button motion-feedback"
            type="button"
            onClick={retry}
          >
            重试海拔
          </button>
        )}
      </div>
    );

  return (
    <ProfileChart
      key={activity.run_id}
      profile={profile}
      cursor={cursor}
      pinnedCursor={pinnedCursor}
      replayPosition={replayPosition}
      onPreviewChange={onPreviewChange}
      onCursorChange={onCursorChange}
      onJumpToRoute={onJumpToRoute}
      smoothed={smoothed ?? localSmoothed}
      onSmoothedChange={onSmoothedChange ?? setLocalSmoothed}
    />
  );
}

function ProfileChart({
  profile,
  cursor = null,
  pinnedCursor = null,
  replayPosition = null,
  onPreviewChange,
  onCursorChange,
  onJumpToRoute,
  smoothed,
  onSmoothedChange,
}: CursorProps & {
  profile: ElevationProfile;
  smoothed: boolean;
  onSmoothedChange: (value: boolean) => void;
}) {
  const plot = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(640);
  const altitudeIndex = smoothed ? 4 : 3;
  const plotWidth = Math.max(1, width - PLOT_LEFT - PLOT_RIGHT);

  useEffect(() => {
    const element = plot.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.max(1, Math.round(entry.contentRect.width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const { min, max, high, low, path } = useMemo(() => {
    const values = profile.samples.map((point) => point[altitudeIndex]);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const padding = Math.max(1, (max - min) * 0.15);
    const low = min - padding;
    const high = max + padding;
    const path = profile.samples
      .map((point, i) => {
        const x = PLOT_LEFT + (point[0] / profile.distance) * plotWidth;
        const y =
          PLOT_BOTTOM -
          ((point[altitudeIndex] - low) / (high - low)) *
            (PLOT_BOTTOM - PLOT_TOP);
        return `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');
    return { min, max, high, low, path };
  }, [profile, altitudeIndex, plotWidth]);

  const x = (ratio: number) => PLOT_LEFT + ratio * plotWidth;
  const y = (altitude: number) =>
    PLOT_BOTTOM - ((altitude - low) / (high - low)) * (PLOT_BOTTOM - PLOT_TOP);
  const shown = replayPosition ?? cursor;
  const position = profilePosition(profile, shown ?? 0);
  const altitude = interpolate(
    profile.samples[position.left][altitudeIndex],
    profile.samples[position.right][altitudeIndex],
    position.fraction
  );
  const distanceText = (position.distance / 1000).toFixed(2);
  const altitudeText = altitude.toFixed(1);
  const cursorFromPointer = (clientX: number) => {
    const rect = plot.current?.getBoundingClientRect();
    if (!rect?.width) return 0;
    const svgX = ((clientX - rect.left) / rect.width) * width;
    const ratio = (svgX - PLOT_LEFT) / plotWidth;
    return (
      Math.round(Math.min(1, Math.max(0, ratio)) * POSITION_STEPS) /
      POSITION_STEPS
    );
  };
  const pin = (value: number | null) => {
    onCursorChange?.(value);
  };

  return (
    <section
      id="run-elevation-profile"
      tabIndex={-1}
      className="archive-panel elevation-chart"
      aria-label="GPX 海拔剖面"
    >
      <div className="panel-heading">
        <div>
          <h2>海拔剖面</h2>
          <p>
            GPX 记录范围 {profile.rawMin.toFixed(1)}–{profile.rawMax.toFixed(1)}{' '}
            m · 高差 {formatNumber(profile.rawMax - profile.rawMin, 1)} m
          </p>
        </div>
        <label>
          <input
            type="checkbox"
            checked={!smoothed}
            onChange={(event) => onSmoothedChange(!event.target.checked)}
          />
          查看原始采样
        </label>
      </div>
      {onCursorChange && (
        <div className="elevation-cursor-values">
          {shown === null ? (
            <span>
              {onJumpToRoute
                ? '点曲线或轨迹上的公里标，查看同一位置的海拔。'
                : '选中曲线上的点，查看海拔。'}
            </span>
          ) : (
            <>
              {replayPosition !== null && <span>回放位置</span>}
              <span>
                <strong>{distanceText}</strong> km 处
              </span>
              <span>
                海拔 <strong>{altitudeText}</strong> m
              </span>
            </>
          )}
        </div>
      )}
      <svg
        ref={plot}
        className={`elevation-plot${onCursorChange ? ' is-interactive' : ''}`}
        viewBox={`0 0 ${width} ${SVG_HEIGHT}`}
        role="img"
        aria-label={`海拔剖面，${smoothed ? '距离窗口降噪' : '原始采样'}，最低 ${min.toFixed(1)} 米，最高 ${max.toFixed(1)} 米。横轴为 GPS 采样距离。`}
        onPointerMove={(event) => {
          if (event.pointerType === 'mouse')
            onPreviewChange?.(cursorFromPointer(event.clientX));
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') onPreviewChange?.(null);
        }}
        onClick={
          onCursorChange
            ? (event) => pin(cursorFromPointer(event.clientX))
            : undefined
        }
      >
        {[0, 0.5, 1].map((t) => {
          const altitude = interpolate(high, low, t);
          return (
            <g key={t}>
              <line
                x1={x(0)}
                x2={x(1)}
                y1={y(altitude)}
                y2={y(altitude)}
                stroke="var(--line)"
              />
              <text x={x(0) - 7} y={y(altitude) + 4} textAnchor="end">
                {altitude.toFixed(1)}
              </text>
            </g>
          );
        })}
        <path
          d={`${path} L${x(1)},${PLOT_BOTTOM} L${x(0)},${PLOT_BOTTOM} Z`}
          fill="var(--accent)"
          opacity="0.08"
        />
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
        {(width < 450 ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1]).map((t) => (
          <text key={t} x={x(t)} y="140" textAnchor="middle">
            {((t * profile.distance) / 1000).toFixed(1)} km
          </text>
        ))}
        {shown !== null && (
          <g className="elevation-cursor" aria-hidden="true">
            <line x1={x(shown)} x2={x(shown)} y1={PLOT_TOP} y2={PLOT_BOTTOM} />
            <circle cx={x(shown)} cy={y(altitude)} r="5" />
          </g>
        )}
      </svg>
      {onCursorChange && (
        <div className="elevation-scrubber">
          <input
            type="range"
            min="0"
            max={POSITION_STEPS}
            step="1"
            aria-label="海拔定位距离"
            aria-valuetext={`距起点 ${distanceText} 公里，海拔 ${altitudeText} 米`}
            value={Math.round((shown ?? 0) * POSITION_STEPS)}
            onFocus={() => {
              if (pinnedCursor === null) pin(shown ?? 0);
            }}
            onChange={(event) =>
              pin(Number(event.target.value) / POSITION_STEPS)
            }
          />
          <button
            type="button"
            disabled={pinnedCursor === null}
            onClick={() => pin(null)}
          >
            清除标记
          </button>
          {onJumpToRoute && pinnedCursor !== null && (
            <button
              type="button"
              className="elevation-jump"
              onClick={onJumpToRoute}
            >
              查看轨迹标记
            </button>
          )}
        </div>
      )}
      <p className="atlas-note">
        横轴是 GPS
        轨迹距离，纵轴是海拔（米），两轴独立缩放。降噪仅用于显示，累计爬升沿用原始活动记录。
      </p>
    </section>
  );
}
