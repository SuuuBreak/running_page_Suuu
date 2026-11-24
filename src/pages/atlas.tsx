import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import Layout from '@/components/Layout';
import { ArchiveFooter } from '@/components/ArchiveUI';
import RunScan, { decodeRoute } from '@/components/RunScan';
import useActivities from '@/hooks/useActivities';
import { geoJsonForMap, geoJsonForRuns, type Activity } from '@/utils/utils';
import {
  activityName,
  formatDate,
  formatNumber,
  summarizeActivities,
} from '@/utils/archive';
import { buildVisits, mergeRegions, type Region } from '@/utils/footprint';
import '@/styles/atlas.css';
import '@/styles/atlas-preview.css';

const RunMap = lazy(() => import('@/components/RunMap'));
const FootprintMap = lazy(() => import('@/components/FootprintMap'));
function routePath(points: ReturnType<typeof decodeRoute>) {
  const cos = Math.cos(
    ((points.reduce((s, p) => s + p[0], 0) / points.length) * Math.PI) / 180
  );
  const xs = points.map((p) => p[1] * cos),
    ys = points.map((p) => -p[0]);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minY = Math.min(...ys),
    maxY = Math.max(...ys);
  const scale = 78 / Math.max(maxX - minX, maxY - minY, 1e-8);
  const step = Math.max(1, Math.ceil(points.length / 500));
  return points
    .filter((_, i) => i % step === 0 || i === points.length - 1)
    .map(
      ([lat, lng], i) =>
        `${i ? 'L' : 'M'}${(50 + (lng * cos - (minX + maxX) / 2) * scale).toFixed(2)},${(50 + (-lat - (minY + maxY) / 2) * scale).toFixed(2)}`
    )
    .join(' ');
}
const routeColor = (distance: number) =>
  distance >= 40000 ? '#ff8976' : distance >= 20000 ? '#f1bd65' : '#d1e66c';

const runDetailsUrl = (run: Activity) =>
  `/map?year=${run.start_date_local.slice(0, 4)}&run=${run.run_id}`;

function RoutePreview({ run, close }: { run: Activity; close: () => void }) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
    panel.current?.scrollIntoView({ block: 'nearest' });
  }, [run.run_id]);
  return (
    <section
      className="atlas-preview"
      id="atlas-route-preview"
      ref={panel}
      tabIndex={-1}
      aria-label="轨迹预览"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.preventDefault();
          close();
        }
      }}
    >
      <div className="atlas-preview-heading">
        <div>
          <h2>{activityName(run)}</h2>
          <p>
            <time dateTime={run.start_date_local.slice(0, 10)}>
              {formatDate(run)}
            </time>
            <span>{formatNumber(run.distance / 1000, 2)} km</span>
          </p>
        </div>
        <div className="atlas-preview-actions">
          <Link to={runDetailsUrl(run)}>查看完整轨迹</Link>
          <button type="button" onClick={close}>
            关闭预览
          </button>
        </div>
      </div>
      <RunScan key={run.run_id} activity={run} compact />
    </section>
  );
}

function Gallery({
  runs,
  routes,
  scope,
  runScope,
}: {
  runs: Activity[];
  routes: { run: Activity; points: ReturnType<typeof decodeRoute> }[];
  scope: string;
  runScope: string;
}) {
  const [params, setParams] = useSearchParams();
  const min = ['5', '10', '20', '40'].includes(params.get('min') || '')
    ? Number(params.get('min'))
    : 0;
  const sort = params.get('order') === 'distance' ? 'distance' : 'date';
  // Filter changes can reuse each route's drawing and formatted labels.
  const atlas = useMemo(
    () =>
      routes.map(({ run, points }) => ({
        run,
        path: routePath(points),
        date: formatDate(run),
        distanceLabel: formatNumber(run.distance / 1000, 2),
      })),
    [routes]
  );
  const entries = useMemo(
    () =>
      atlas
        .filter(({ run }) => run.distance >= min * 1000)
        .sort((a, b) =>
          sort === 'distance'
            ? b.run.distance - a.run.distance
            : b.run.start_date_local.localeCompare(a.run.start_date_local)
        ),
    [atlas, min, sort]
  );
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [columns, setColumns] = useState(1);
  const grid = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLAnchorElement>(null);
  const selectedIndex = entries.findIndex(
    ({ run }) => run.run_id === previewId
  );
  const previewRun = entries[selectedIndex]?.run;
  const rowEnd = Math.min(
    entries.length,
    (Math.floor(selectedIndex / columns) + 1) * columns
  );
  useEffect(() => {
    const element = grid.current;
    if (!element) return;
    const measure = () =>
      setColumns(
        getComputedStyle(element).gridTemplateColumns.split(/\s+/).length
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!previewRun && previewId !== null) setPreviewId(null);
  }, [previewRun, previewId]);
  const closePreview = () => {
    setPreviewId(null);
    requestAnimationFrame(() => opener.current?.focus());
  };
  const distance = entries.reduce((sum, { run }) => sum + run.distance, 0);
  const withoutRoute =
    runs.filter((r) => r.distance >= min * 1000).length - entries.length;
  const change = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    next.set(key, value);
    setParams(next);
  };
  const download = () => {
    const cols = 10,
      height = 165 + Math.ceil(entries.length / cols) * 118 + 85;
    const title = `${scope} · ${min ? `${min} km 以上` : '全部'}跑步轨迹`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1240" height="${height}" viewBox="0 0 1240 ${height}"><rect width="1240" height="${height}" fill="#0b0d0b"/><g font-family="sans-serif"><text x="40" y="65" fill="#f1f3e9" font-size="34">Suuu / ${title}</text><text x="40" y="102" fill="#a0ab97" font-size="15">${entries.length} 次跑步 · ${formatNumber(distance / 1000, 1)} km</text>${entries.map(({ run, path, date }, i) => `<g transform="translate(${35 + (i % cols) * 117},${140 + Math.floor(i / cols) * 118})"><path d="${path}" fill="none" stroke="${routeColor(run.distance)}" stroke-width="1.4"/><text x="50" y="110" fill="#a0ab97" text-anchor="middle" font-size="10">${date} / ${(run.distance / 1000).toFixed(2)} km</text></g>`).join('')}<text x="40" y="${height - 35}" fill="#a0ab97" font-size="14">独立缩放，保留路线比例 · ≥20 km / ≥40 km 使用暖色标记</text></g></svg>`;
    const url = URL.createObjectURL(
      new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `Suuu-routes-${scope}-${min}km.svg`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const tiles = entries.map(({ run, path, date, distanceLabel }) => {
    const expanded = previewId === run.run_id;
    return (
      <Link
        className="atlas-route"
        key={run.run_id}
        to={runDetailsUrl(run)}
        role="button"
        aria-label={`${date}，${distanceLabel} 公里，预览轨迹`}
        aria-expanded={expanded}
        aria-controls={expanded ? 'atlas-route-preview' : undefined}
        onClick={(event) => {
          if (
            event.button ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            event.altKey
          )
            return;
          event.preventDefault();
          opener.current = event.currentTarget;
          if (expanded) closePreview();
          else setPreviewId(run.run_id);
        }}
        onKeyDown={(event) => {
          if (event.key === ' ') {
            event.preventDefault();
            if (!event.repeat) event.currentTarget.click();
          }
        }}
      >
        <svg width="100" height="100" viewBox="0 0 100 100" aria-hidden="true">
          <path
            d={path}
            fill="none"
            stroke={routeColor(run.distance)}
            strokeWidth="1.3"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <span>
          <time dateTime={run.start_date_local.slice(0, 10)}>{date}</time>
          <strong>
            {distanceLabel}
            <small> km</small>
          </strong>
        </span>
      </Link>
    );
  });
  if (previewRun) {
    tiles.splice(
      rowEnd,
      0,
      <RoutePreview key="preview" run={previewRun} close={closePreview} />
    );
  }
  return (
    <section className="archive-panel atlas-gallery" aria-label="跑步轨迹合集">
      <div className="atlas-gallery-toolbar">
        <div className="atlas-controls">
          <select
            aria-label="轨迹合集最低距离"
            value={min}
            onChange={(e) => change('min', e.target.value)}
          >
            {[0, 5, 10, 20, 40].map((value) => (
              <option key={value} value={value}>
                {value ? `≥ ${value} km` : '全部距离'}
              </option>
            ))}
          </select>
          <select
            aria-label="轨迹合集排序"
            value={sort}
            onChange={(e) => change('order', e.target.value)}
          >
            <option value="date">最近出发</option>
            <option value="distance">最长距离</option>
          </select>
          <button
            type="button"
            title="下载完整轨迹 SVG 海报"
            disabled={!entries.length}
            onClick={download}
          >
            导出海报
          </button>
        </div>
        <p className="atlas-result" role="status">
          <strong>{entries.length}</strong> 条匹配 /{' '}
          {formatNumber(distance / 1000, 1)} km
        </p>
      </div>
      <div className="atlas-legend">
        <span>
          <i />
          常规跑步
        </span>
        <span>
          <i style={{ background: '#f1bd65' }} />≥ 20 km
        </span>
        <span>
          <i style={{ background: '#ff8976' }} />≥ 40 km
        </span>
        <span className="atlas-legend-help">选择一条轨迹预览</span>
      </div>
      <div className="atlas-route-grid" ref={grid}>
        {tiles}
      </div>
      {!entries.length && (
        <div className="workspace-empty">
          当前范围没有符合距离条件的有效轨迹。调整年份或距离后重试。
        </div>
      )}
      <div className="atlas-note atlas-gallery-note">
        <span>
          每条轨迹独立缩放，保留形状比例。
          {withoutRoute > 0 &&
            `另有 ${withoutRoute} 次符合距离条件的活动没有有效定位。`}
        </span>
        <Link to={runScope}>浏览单次跑步 ↗</Link>
      </div>
    </section>
  );
}

export default function Atlas() {
  const { activities, years } = useActivities();
  const [params, setParams] = useSearchParams();
  const requestedYear = params.get('year') || 'all';
  const year = years.includes(requestedYear) ? requestedYear : 'all';
  const requestedMonth = Number(params.get('month') || 0);
  const month =
    Number.isInteger(requestedMonth) &&
    requestedMonth >= 1 &&
    requestedMonth <= 12
      ? requestedMonth
      : 0;
  const panel = ['footprint', 'overlay'].includes(params.get('panel') || '')
    ? params.get('panel')!
    : 'gallery';
  const runs = useMemo(
    () =>
      activities.filter(
        (r) =>
          (year === 'all' || r.start_date_local.startsWith(year)) &&
          (!month || Number(r.start_date_local.slice(5, 7)) === month)
      ),
    [activities, year, month]
  );
  const stats = useMemo(() => summarizeActivities(runs), [runs]);
  const routes = useMemo(
    () =>
      runs.flatMap((run) => {
        const points = decodeRoute(run);
        return points.length ? [{ run, points }] : [];
      }),
    [runs]
  );
  const [regions, setRegions] = useState<Region[]>([]);
  const [regionError, setRegionError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const showFootprint = panel === 'footprint';
  useEffect(() => {
    if (regions.length) return;
    let active = true;
    setRegionError(false);
    const load = () =>
      geoJsonForMap()
        .then((data) => {
          if (active)
            setRegions(
              mergeRegions(
                data.features.filter(
                  (f) => f.geometry.type !== 'LineString'
                ) as Region[]
              )
            );
        })
        .catch(() => {
          if (active) setRegionError(true);
        });
    // Drawing the route sheet is independent of the large regional outlines.
    let cancel: (() => void) | undefined;
    if (showFootprint) {
      void load();
    } else if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(load, { timeout: 1500 });
      cancel = () => window.cancelIdleCallback(id);
    } else {
      const id = window.setTimeout(load, 150);
      cancel = () => window.clearTimeout(id);
    }
    return () => {
      active = false;
      cancel?.();
    };
  }, [loadAttempt, regions.length, showFootprint]);
  const visits = useMemo(
    () => (regions.length ? buildVisits(runs, regions) : []),
    [runs, regions]
  );
  const [provinceCount, cityCount] = useMemo(
    () => [
      new Set(visits.flatMap((v) => (v.province ? [v.province] : []))).size,
      new Set(visits.flatMap((v) => (v.city ? [v.city] : []))).size,
    ],
    [visits]
  );
  const change = (values: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    Object.entries(values).forEach(([k, v]) =>
      v ? next.set(k, v) : next.delete(k)
    );
    setParams(next);
  };
  const [view, setView] = useState({
    longitude: 104,
    latitude: 35,
    zoom: 3.2,
    bearing: 0,
    pitch: 0,
  });
  const data = useMemo(
    () =>
      geoJsonForRuns(panel === 'overlay' ? routes.map(({ run }) => run) : []),
    [panel, routes]
  );
  const scope = `${year === 'all' ? '全部年份' : year}${month ? ` · ${month}月` : ''}`;
  const runScope = `/map?year=${year}${month ? `&month=${month}` : ''}`;
  return (
    <Layout variant="journal">
      <Helmet>
        <title>Suuu · 足迹图册</title>
      </Helmet>
      <div className="atlas-intro">
        <h1 className="workspace-title">足迹图册</h1>
        <div className="atlas-period">
          {month > 0 && (
            <button
              className="atlas-clear-month"
              type="button"
              aria-label={`清除 ${month} 月筛选`}
              onClick={() => change({ month: null })}
            >
              {month} 月 ×
            </button>
          )}
          <select
            aria-label="选择统计年份"
            value={year}
            onChange={(e) =>
              change({ year: e.target.value, month: null, run: null })
            }
          >
            <option value="all">全部年份</option>
            {years.map((value) => (
              <option key={value} value={value}>
                {value} 年
              </option>
            ))}
          </select>
        </div>
        <dl className="atlas-summary" aria-label={`${scope}足迹统计`}>
          <div>
            <dt>有效轨迹</dt>
            <dd>{routes.length} 条</dd>
          </div>
          <div>
            <dt>累计距离</dt>
            <dd>{formatNumber(stats.distance / 1000, 1)} km</dd>
          </div>
          <div>
            <dt>点亮省区</dt>
            <dd>{regions.length ? `${provinceCount} 个` : '—'}</dd>
          </div>
          <div>
            <dt>记录城市</dt>
            <dd>{regions.length ? `${cityCount} 座` : '—'}</dd>
          </div>
        </dl>
      </div>
      <div className="atlas-tabbar">
        <div className="atlas-tabs" role="group" aria-label="足迹展示方式">
          {[
            ['gallery', '轨迹合集'],
            ['footprint', '点亮地图'],
            ['overlay', '全部路线叠加'],
          ].map(([value, label]) => (
            <button
              type="button"
              aria-pressed={panel === value}
              key={value}
              onClick={() => change({ panel: value })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {panel === 'gallery' ? (
        <Gallery
          runs={runs}
          routes={routes}
          scope={scope}
          runScope={runScope}
        />
      ) : panel === 'footprint' ? (
        regions.length ? (
          <Suspense fallback={<FootprintLoading />}>
            <FootprintMap
              key={scope}
              regions={regions}
              visits={visits}
              scope={scope}
            />
          </Suspense>
        ) : (
          <FootprintLoading
            onRetry={
              regionError ? () => setLoadAttempt((n) => n + 1) : undefined
            }
          />
        )
      ) : (
        <section className="archive-panel atlas-overlay">
          <div className="panel-heading">
            <h2>{scope} · 全部路线叠加</h2>
            <span>{routes.length} 条，保留真实地理位置</span>
          </div>
          <div className="atlas-overlay-map">
            <Suspense
              fallback={<div className="workspace-empty">正在加载地图…</div>}
            >
              <RunMap
                title={`${scope} · 全部轨迹`}
                geoData={data}
                viewState={view}
                setViewState={(state) => setView((v) => ({ ...v, ...state }))}
                thisYear={year}
                changeYear={(value) =>
                  change({ year: value === 'Total' ? 'all' : value })
                }
                height="100%"
                showYearButtons={false}
                onReset={() =>
                  setView({
                    longitude: 104,
                    latitude: 35,
                    zoom: 3.2,
                    bearing: 0,
                    pitch: 0,
                  })
                }
              />
            </Suspense>
          </div>
          <p className="atlas-note">
            路线按实际经纬度叠加，可缩放到日常跑步的街区；查看点亮的行政区域请切换“点亮地图”。
          </p>
        </section>
      )}
      <ArchiveFooter />
    </Layout>
  );
}

function FootprintLoading({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="archive-panel workspace-empty" role="status">
      {onRetry ? (
        <>
          地图数据加载失败。
          <button type="button" onClick={onRetry}>
            重新加载
          </button>
        </>
      ) : (
        '正在读取足迹地图…'
      )}
    </div>
  );
}
