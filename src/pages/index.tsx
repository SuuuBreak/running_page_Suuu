import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Helmet } from 'react-helmet-async';
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from 'react-router-dom';
import { WebMercatorViewport } from '@math.gl/web-mercator';
import Layout from '@/components/Layout';
import RunScan, { decodeRoute, RouteMini } from '@/components/RunScan';
import {
  ActivitySearch,
  ArchiveFooter,
  ArchiveMetrics,
  ArchivePageHead,
  YearFilter,
} from '@/components/ArchiveUI';
import useActivities from '@/hooks/useActivities';
import ElevationChart from '@/components/ElevationChart';
import useRouteElevation from '@/hooks/useRouteElevation';
import {
  Activity,
  convertMovingTime2Sec,
  geoJsonForRuns,
  IViewState,
  locationForRun,
} from '@/utils/utils';
import {
  activityName,
  formatDate,
  formatDuration,
  formatNumber,
  formatPace,
  summarizeActivities,
} from '@/utils/archive';
import '@/styles/map-workspace.css';

const RunMap = lazy(() => import('@/components/RunMap'));
const PAGE_SIZE = 6;

const fitRoute = (
  runs: Activity[]
): IViewState & { bearing: number; pitch: number } => {
  const points = runs.flatMap((run) => decodeRoute(run));
  if (points.length < 2)
    return {
      longitude: 108.94,
      latitude: 34.26,
      zoom: 10,
      bearing: 0,
      pitch: 0,
    };
  let minLat = 90,
    maxLat = -90,
    minLng = 180,
    maxLng = -180;
  for (const [lat, lng] of points) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  }
  if (Math.max(maxLat - minLat, maxLng - minLng) < 0.00001)
    return {
      longitude: minLng,
      latitude: minLat,
      zoom: 15,
      bearing: 0,
      pitch: 0,
    };
  const { longitude, latitude, zoom } = new WebMercatorViewport({
    width: 850,
    height: 500,
  }).fitBounds(
    [
      [minLng, minLat],
      [maxLng, maxLat],
    ],
    { padding: 95, maxZoom: 17 }
  );
  return { longitude, latitude, zoom, bearing: 0, pitch: 0 };
};

export default function MapWorkspace() {
  const { activities, years, thisYear } = useActivities();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const fromFootprint = location.state?.fromFootprint;
  const returnToFootprint =
    typeof fromFootprint === 'string' && /^\/atlas(?:\?|$)/.test(fromFootprint)
      ? fromFootprint
      : null;
  const hashRun = location.hash.startsWith('#run_')
    ? location.hash.slice(5)
    : '';
  const requestedId = params.get('run') || hashRun;
  const linkedRun = activities.find(
    (run) => requestedId !== null && run.run_id === Number(requestedId)
  );
  const requestedYear =
    params.get('year') || linkedRun?.start_date_local.slice(0, 4) || thisYear;
  const validYear =
    years.includes(requestedYear) || requestedYear === 'all'
      ? requestedYear
      : thisYear;
  const year =
    linkedRun &&
    validYear !== 'all' &&
    !linkedRun.start_date_local.startsWith(validYear)
      ? linkedRun.start_date_local.slice(0, 4)
      : validYear;
  const requestedMonth = Number(params.get('month') || 0);
  const month =
    Number.isInteger(requestedMonth) &&
    requestedMonth >= 1 &&
    requestedMonth <= 12
      ? requestedMonth
      : 0;
  const search = params.get('q') || '';
  const [shareResult, setShareResult] = useState<{
    copied: boolean;
    url: string;
  } | null>(null);
  const copyAttempt = useRef(0);
  const [showContext, setShowContext] = useState(false);
  const [smoothed, setSmoothed] = useState(true);
  const [previewPosition, setPreviewPosition] = useState<number | null>(null);
  const [chartSeek, setChartSeek] = useState<{
    runId: number;
    position: number | null;
  }>();
  const [replayPosition, setReplayPosition] = useState<number | null>(null);
  const [elevationCursor, setElevationCursor] = useState<{
    runId: number;
    position: number;
  } | null>(null);
  const routeHeading = useRef<HTMLHeadingElement>(null);
  const routeScene = useRef<HTMLDivElement>(null);
  const view = params.get('view');
  const mode = view === 'map' ? 'map' : 'scan';

  const update = (values: Record<string, string | null>, replace = false) => {
    const next = new URLSearchParams(params);
    Object.entries(values).forEach(([key, value]) =>
      value ? next.set(key, value) : next.delete(key)
    );
    if (!('mapPage' in values)) next.delete('mapPage');
    setParams(next, {
      replace,
      state: location.state,
      preventScrollReset: true,
    });
  };

  // Keep the selected activity when normalizing old shared URLs.
  useEffect(() => {
    const linkedYear = linkedRun?.start_date_local.slice(0, 4);
    const wrongYear =
      linkedRun && validYear !== 'all' && validYear !== linkedYear;
    const wrongMonth =
      linkedRun &&
      month > 0 &&
      Number(linkedRun.start_date_local.slice(5, 7)) !== month;
    const hasUnknownView = view !== null && view !== 'map';
    if (!hashRun && !wrongYear && !wrongMonth && !hasUnknownView) return;
    const next = new URLSearchParams(params);
    if (hashRun) next.set('run', hashRun);
    if (linkedYear && (hashRun || wrongYear)) next.set('year', linkedYear);
    if (hashRun || wrongMonth) next.delete('month');
    if (hashRun) next.delete('q');
    if (hashRun || wrongYear || wrongMonth) next.delete('mapPage');
    if (hasUnknownView) next.delete('view');
    navigate(
      { pathname: location.pathname, search: `?${next}`, hash: '' },
      { replace: true, state: location.state, preventScrollReset: true }
    );
  }, [
    hashRun,
    linkedRun,
    validYear,
    month,
    location.pathname,
    location.state,
    navigate,
    params,
    view,
  ]);

  const yearRuns = useMemo(
    () =>
      activities
        .filter(
          (run) => year === 'all' || run.start_date_local.startsWith(year)
        )
        .sort((a, b) => b.start_date_local.localeCompare(a.start_date_local)),
    [activities, year]
  );
  const monthRuns = useMemo(
    () =>
      month
        ? yearRuns.filter(
            (run) => Number(run.start_date_local.slice(5, 7)) === month
          )
        : yearRuns,
    [yearRuns, month]
  );
  const runs = useMemo(
    () =>
      monthRuns.filter(
        (run) =>
          !search ||
          `${run.name} ${activityName(run)} ${formatDate(run)} ${run.start_date_local} ${locationForRun(run).city}`
            .toLowerCase()
            .includes(search.trim().toLowerCase())
      ),
    [monthRuns, search]
  );
  const selected =
    monthRuns.find(
      (run) => requestedId !== null && run.run_id === Number(requestedId)
    ) || monthRuns[0];
  const elevation = useRouteElevation(selected);
  const pinnedCursor =
    elevationCursor?.runId === selected?.run_id
      ? elevationCursor?.position ?? null
      : null;
  const cursor = previewPosition ?? pinnedCursor;
  const runId = selected?.run_id;
  const pinPosition = useCallback(
    (position: number | null) => {
      setPreviewPosition(null);
      setElevationCursor(
        position === null || runId == null ? null : { runId, position }
      );
    },
    [runId]
  );
  const compactOptions = useMemo(
    () =>
      monthRuns.map((run) => (
        <option key={run.run_id} value={String(run.run_id)}>
          {`${run.start_date_local.slice(year === 'all' ? 2 : 5, 10).replaceAll('-', '/')} · ${formatNumber(run.distance / 1000, 1)}\u202fkm`}
        </option>
      )),
    [monthRuns, year]
  );
  const selectedSeconds = selected
    ? convertMovingTime2Sec(selected.moving_time)
    : 0;
  const scopeStats = useMemo(() => summarizeActivities(runs), [runs]);
  const points = useMemo(() => decodeRoute(selected), [selected]);
  const hasRoute = points.length > 1;
  const maxPage = Math.max(1, Math.ceil(runs.length / PAGE_SIZE));
  const selectedPage = selected
    ? Math.floor(runs.indexOf(selected) / PAGE_SIZE) + 1
    : 1;
  const page = Math.max(
    1,
    Math.min(
      maxPage,
      parseInt(params.get('mapPage') || String(selectedPage), 10) || 1
    )
  );
  const pageRuns = runs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const selectedLocation = selected ? locationForRun(selected) : null;
  const selectedCity =
    selectedLocation?.city ||
    selectedLocation?.province ||
    (selected?.type === 'VirtualRun' ? '室内跑步' : '未记录地点');
  const mapRuns = useMemo(
    () =>
      showContext
        ? runs.filter((run) => decodeRoute(run).length > 1)
        : selected && hasRoute
          ? [selected]
          : [],
    [runs, selected, hasRoute, showContext]
  );
  const geoData = useMemo(() => {
    const data = geoJsonForRuns(mapRuns);
    return {
      ...data,
      features: data.features.map((feature, index) => ({
        ...feature,
        properties: {
          ...feature.properties,
          selected: mapRuns[index]?.run_id === selected?.run_id,
        },
      })),
    };
  }, [mapRuns, selected]);
  const [viewState, setViewState] = useState<IViewState>(() =>
    fitRoute(selected ? [selected] : [])
  );
  const initialMapView = useMemo(() => fitRoute(mapRuns), [mapRuns]);
  useEffect(() => {
    setViewState(initialMapView);
  }, [initialMapView]);
  useEffect(() => {
    setElevationCursor(null);
    setPreviewPosition(null);
    setReplayPosition(null);
    setChartSeek(undefined);
  }, [selected]);
  useEffect(() => {
    setShareResult(null);
    return () => {
      copyAttempt.current++;
    };
  }, [selected, mode]);
  useEffect(() => {
    if (!shareResult?.copied) return;
    const timeout = window.setTimeout(() => setShareResult(null), 1800);
    return () => window.clearTimeout(timeout);
  }, [shareResult]);
  useEffect(() => {
    if (mode !== 'scan') setReplayPosition(null);
  }, [mode]);

  const selectActivity = (runId: string, keepPage?: boolean) => {
    setShowContext(false);
    setElevationCursor(null);
    update({
      run: runId,
      ...(keepPage ? { mapPage: String(page) } : {}),
    });
    if (keepPage && window.matchMedia('(max-width: 760px)').matches) {
      routeHeading.current?.focus();
    }
  };

  const jumpToRoute = () => {
    const canvas = routeScene.current?.querySelector('canvas');
    canvas?.focus({ preventScroll: true });
    canvas?.scrollIntoView({ block: 'center' });
  };

  const copyLink = async () => {
    if (!selected) return;
    const share = new URL(window.location.href);
    share.search = new URLSearchParams({
      year: selected.start_date_local.slice(0, 4),
      run: String(selected.run_id),
    }).toString();
    share.hash = '';
    const url = share.toString();
    const attempt = ++copyAttempt.current;
    try {
      await navigator.clipboard.writeText(url);
      if (attempt === copyAttempt.current)
        setShareResult({ copied: true, url });
    } catch {
      if (attempt === copyAttempt.current)
        setShareResult({ copied: false, url });
    }
  };

  return (
    <Layout variant="journal">
      <Helmet>
        <html lang="zh-CN" />
        <title>Suuu · 轨迹探索</title>
      </Helmet>
      <div className="map-workspace">
        {returnToFootprint && (
          <Link className="map-back-footprint" to={returnToFootprint} replace>
            ← 返回点亮地图
          </Link>
        )}
        <ArchivePageHead
          title="轨迹探索"
          description="选一场跑步，查看路线和沿途海拔。"
        />
        {requestedId && !linkedRun && (
          <div className="map-link-notice" role="status">
            没有找到链接中的活动，当前展示筛选范围内最近的记录。
          </div>
        )}

        <div className="map-workbench">
          <div className="map-analysis">
            <section
              className="map-focus archive-panel"
              aria-label="活动轨迹工作台"
            >
              <div className="map-focus-heading">
                <div>
                  <div className="map-focus-date">
                    {selected ? (
                      <>
                        <time
                          dateTime={selected.start_date_local.replace(' ', 'T')}
                        >
                          {formatDate(selected)}
                        </time>
                        <span className="map-focus-place">{selectedCity}</span>
                      </>
                    ) : (
                      '选择一条跑步记录'
                    )}
                  </div>
                  <h2 id="current-run" ref={routeHeading} tabIndex={-1}>
                    {selected ? activityName(selected) : '轨迹等待下一次出发'}
                  </h2>
                </div>
                {selected && monthRuns.length > 1 && (
                  <label className="map-compact-picker">
                    <span className="sr-only">更换跑步记录</span>
                    <select
                      value={String(selected.run_id)}
                      onChange={(event) => selectActivity(event.target.value)}
                    >
                      {compactOptions}
                    </select>
                  </label>
                )}
                <div
                  className="map-mode-switch"
                  role="group"
                  aria-label="轨迹显示方式"
                >
                  <button
                    type="button"
                    aria-pressed={mode === 'scan'}
                    onClick={() =>
                      update({ view: null, mapPage: String(page) })
                    }
                  >
                    立体轨迹
                  </button>
                  <button
                    type="button"
                    aria-pressed={mode === 'map'}
                    onClick={() =>
                      update({ view: 'map', mapPage: String(page) })
                    }
                  >
                    地理地图
                  </button>
                </div>
              </div>
              {selected && hasRoute ? (
                <>
                  <div
                    className={`map-scene ${mode === 'map' ? 'is-geographic' : 'is-pointcloud'}`}
                    ref={routeScene}
                  >
                    {mode === 'scan' ? (
                      <RunScan
                        key={selected.run_id}
                        activity={selected}
                        elevation={elevation}
                        compact
                        cursor={cursor}
                        smoothed={smoothed}
                        onSmoothedChange={setSmoothed}
                        onPositionSelect={pinPosition}
                        chartSeek={
                          chartSeek?.runId === selected.run_id
                            ? chartSeek
                            : undefined
                        }
                        onReplayPosition={setReplayPosition}
                      />
                    ) : (
                      <Suspense
                        fallback={
                          <div className="map-scene-loading" role="status">
                            正在加载地理地图…
                          </div>
                        }
                      >
                        <RunMap
                          key={selected.run_id}
                          title={`${formatDate(selected)} · ${activityName(selected)}`}
                          geoData={geoData}
                          viewState={viewState}
                          setViewState={setViewState}
                          thisYear={year}
                          changeYear={(value) =>
                            update({
                              year: value === 'Total' ? 'all' : value,
                              run: null,
                              month: null,
                              q: null,
                            })
                          }
                          height="100%"
                          showYearButtons={false}
                          defaultLights
                          onReset={() => setViewState(initialMapView)}
                        />
                      </Suspense>
                    )}
                  </div>
                  {(mode !== 'scan' || pinnedCursor !== null) && (
                    <div className="map-scene-caption">
                      {mode === 'map' && (
                        <span>
                          <i aria-hidden="true" />
                          拖动平移 · 滚轮缩放 · 地理底图与 GPS 轨迹
                        </span>
                      )}
                      {mode === 'scan' && pinnedCursor !== null && (
                        <button
                          type="button"
                          className="workspace-link"
                          onClick={() => {
                            const chart = document.getElementById(
                              'run-elevation-profile'
                            );
                            chart?.focus({ preventScroll: true });
                            chart?.scrollIntoView({ block: 'center' });
                          }}
                        >
                          查看对应海拔 ↓
                        </button>
                      )}
                      {mode === 'map' && (
                        <label className="map-context-toggle">
                          <input
                            type="checkbox"
                            checked={showContext}
                            onChange={(e) => setShowContext(e.target.checked)}
                          />
                          叠加筛选范围内的轨迹
                        </label>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="map-no-route">
                  <svg
                    width="64"
                    height="64"
                    viewBox="0 0 64 64"
                    fill="none"
                    stroke="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M9 48 24 15l17 27 14-23" strokeDasharray="3 4" />
                    <circle cx="9" cy="48" r="3" />
                    <circle cx="55" cy="19" r="3" />
                  </svg>
                  <h3>
                    {selected ? '这次跑步没有 GPS 轨迹' : '没有可展示的轨迹'}
                  </h3>
                  <p>
                    {selected
                      ? '室内跑步或未保存定位的活动，仍会计入距离与训练统计。'
                      : '清除筛选，或在活动档案里选择其他记录。'}
                  </p>
                  <a className="text-action" href="#map-activity-library">
                    查看活动档案
                  </a>
                </div>
              )}
            </section>
            {selected && hasRoute && (
              <ElevationChart
                elevation={elevation}
                key={selected.run_id}
                activity={selected}
                cursor={cursor}
                pinnedCursor={pinnedCursor}
                replayPosition={mode === 'scan' ? replayPosition : null}
                onPreviewChange={setPreviewPosition}
                smoothed={smoothed}
                onSmoothedChange={setSmoothed}
                onJumpToRoute={mode === 'scan' ? jumpToRoute : undefined}
                onCursorChange={(position) => {
                  pinPosition(position);
                  setChartSeek({ runId: selected.run_id, position });
                }}
              />
            )}
            {selected && (
              <div className="map-run-numbers archive-panel" aria-live="polite">
                <div>
                  <span>本次距离</span>
                  <strong>
                    {formatNumber(selected.distance / 1000, 2)}
                    <small>km</small>
                  </strong>
                </div>
                <div>
                  <span>平均配速</span>
                  <strong>
                    {formatPace(selected.distance, selectedSeconds)}
                    <small>/km</small>
                  </strong>
                </div>
                <div>
                  <span>运动用时</span>
                  <strong>{formatDuration(selectedSeconds)}</strong>
                </div>
                <div>
                  <span>平均心率</span>
                  <strong>
                    {selected.average_heartrate
                      ? formatNumber(selected.average_heartrate)
                      : '—'}
                    <small>
                      {selected.average_heartrate ? 'bpm' : '未记录'}
                    </small>
                  </strong>
                </div>
              </div>
            )}
          </div>
          <aside
            className="map-activity-browser archive-panel"
            id="map-activity-library"
            tabIndex={-1}
            aria-label="选择跑步活动"
          >
            <div className="panel-heading">
              <h2>
                活动档案 <span className="map-count">{runs.length}</span>
              </h2>
              <span className="map-side-note">最近出发</span>
            </div>
            <YearFilter
              years={years}
              year={year}
              onChange={(value) => {
                setShowContext(false);
                update({ year: value, run: null, month: null, q: null });
              }}
            />
            <ActivitySearch
              className="map-search"
              label="搜索地图活动"
              value={search}
              onChange={(value) => update({ q: value }, true)}
            />
            {month > 0 && (
              <button
                className="map-month-filter"
                type="button"
                onClick={() => update({ month: null, run: null })}
                aria-label={`清除 ${month} 月筛选`}
              >
                {month} 月记录 <span aria-hidden="true">×</span>
              </button>
            )}
            <div className="map-activity-list">
              {pageRuns.map((run) => {
                const seconds = convertMovingTime2Sec(run.moving_time);
                const active = selected?.run_id === run.run_id;
                return (
                  <button
                    key={run.run_id}
                    type="button"
                    className={`map-activity-item ${active ? 'is-selected' : ''}`}
                    aria-pressed={active}
                    aria-label={`查看 ${formatDate(run)} ${activityName(run)} ${formatNumber(run.distance / 1000, 2)} 公里的轨迹`}
                    onClick={() => selectActivity(String(run.run_id), true)}
                  >
                    <div className="map-activity-date">
                      <time dateTime={run.start_date_local.replace(' ', 'T')}>
                        {formatDate(run)}
                      </time>
                      <span>{active ? '查看中' : activityName(run)}</span>
                    </div>
                    <div className="map-activity-values">
                      <strong>
                        {formatNumber(run.distance / 1000, 2)}
                        <small> km</small>
                      </strong>
                      <span>
                        {formatPace(run.distance, seconds)} <small>/km</small>
                      </span>
                      <RouteMini activity={run} />
                    </div>
                  </button>
                );
              })}
            </div>
            {!runs.length && (
              <div className="map-search-empty">
                <strong>没有匹配的活动</strong>
                <p>换一个关键词，或清除月份和搜索条件。</p>
                <button
                  className="text-action"
                  type="button"
                  onClick={() => update({ q: null, month: null, run: null })}
                >
                  清除筛选
                </button>
              </div>
            )}
            <div className="map-list-pagination">
              <span aria-live="polite">
                {runs.length
                  ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, runs.length)}`
                  : '0'}{' '}
                / {runs.length}
              </span>
              <div>
                <button
                  type="button"
                  aria-label="上一页地图活动"
                  disabled={page <= 1}
                  onClick={() => update({ mapPage: String(page - 1) })}
                >
                  ←
                </button>
                <span>
                  {page} / {maxPage}
                </span>
                <button
                  type="button"
                  aria-label="下一页地图活动"
                  disabled={page >= maxPage}
                  onClick={() => update({ mapPage: String(page + 1) })}
                >
                  →
                </button>
              </div>
            </div>
          </aside>
        </div>

        {selected && (
          <section className="map-activity-details" aria-label="单次活动详情">
            <div>
              <span className="map-details-kicker">本次出发</span>
              <h2>
                {formatDate(selected)}
                <span>{selected.start_date_local.slice(11, 16)}</span>
              </h2>
              <p>
                {selectedCity} ·{' '}
                {selected.type === 'VirtualRun' ? '室内跑步' : '户外跑步'}
              </p>
            </div>
            <dl>
              <div>
                <dt>轨迹状态</dt>
                <dd>
                  {hasRoute
                    ? `${formatNumber(points.length)} 个 GPS 采样点`
                    : '未保存 GPS'}
                </dd>
              </div>
              <div>
                <dt>累计爬升</dt>
                <dd>
                  {selected.elevation_gain == null
                    ? '未记录'
                    : `${formatNumber(selected.elevation_gain)} m`}
                </dd>
              </div>
              <div>
                <dt>单次均距参考</dt>
                <dd>
                  {formatNumber(
                    scopeStats.distance / Math.max(1, scopeStats.count) / 1000,
                    2
                  )}{' '}
                  km
                </dd>
              </div>
            </dl>
            <div className="map-detail-actions">
              <button
                type="button"
                className="map-copy-link"
                onClick={copyLink}
                aria-label="复制活动链接"
              >
                {shareResult?.copied ? '链接已复制' : '复制活动链接'}
                <span
                  aria-hidden="true"
                  className="motion-glyph"
                  key={String(shareResult?.copied)}
                >
                  {shareResult?.copied ? '✓' : '↗'}
                </span>
              </button>
              <Link
                to={`/summary?year=${selected.start_date_local.slice(0, 4)}`}
              >
                查看这一年的统计
              </Link>
              <span className="sr-only" role="status">
                {shareResult?.copied
                  ? '活动链接已复制'
                  : shareResult
                    ? '可手动复制活动链接'
                    : ''}
              </span>
            </div>
            {shareResult && !shareResult.copied && (
              <input
                className="workspace-input map-manual-link motion-feedback"
                aria-label="活动链接"
                value={shareResult.url}
                readOnly
                onFocus={(event) => event.currentTarget.select()}
              />
            )}
          </section>
        )}
        <div className="map-scope-overview">
          <ArchiveMetrics
            items={[
              {
                label: '筛选范围内的里程',
                value: formatNumber(scopeStats.distance / 1000, 1),
                unit: 'km',
                note: `${year === 'all' ? '全部年份' : year}${month ? ` · ${month}月` : ''}`,
              },
              {
                label: '活动记录',
                value: formatNumber(runs.length),
                unit: '次',
              },
              { label: '平均配速', value: scopeStats.pace, unit: '/km' },
              {
                label: '运动时长',
                value: formatNumber(scopeStats.seconds / 3600, 1),
                unit: 'h',
              },
            ]}
          />
          <div className="atlas-entry-links">
            <span>看看所有跑过的路</span>
            <Link to="/atlas?year=all">全部轨迹合集 ↗</Link>
            <Link to="/atlas?year=all&panel=footprint">点亮地图 ↗</Link>
            <Link to="/atlas?year=all&panel=overlay">全部路线叠加 ↗</Link>
          </div>
        </div>
        <ArchiveFooter />
      </div>
    </Layout>
  );
}
