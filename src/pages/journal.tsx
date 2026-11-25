import { useMemo } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import Layout from '@/components/Layout';
import RunScan, { RouteMini } from '@/components/RunScan';
import {
  ActivitySearch,
  ArchivePageHead,
  ArchiveMetrics,
  ArchiveFooter,
  YearFilter,
} from '@/components/ArchiveUI';
import useActivities from '@/hooks/useActivities';
import {
  Activity,
  convertMovingTime2Sec,
  locationForRun,
  titleForRun,
} from '@/utils/utils';

const number = (value: number, digits = 0) =>
  new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
const dateOf = (run: Activity) =>
  new Date(run.start_date_local.replace(' ', 'T'));
const dateLabel = (run: Activity) =>
  new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(
    dateOf(run)
  );
const fullDate = (run: Activity) =>
  new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(dateOf(run));
const pace = (meters: number, seconds: number) => {
  if (meters <= 0 || seconds <= 0) return '—';
  const total = Math.round(seconds / (meters / 1000));
  return `${Math.floor(total / 60)}′${String(total % 60).padStart(2, '0')}″`;
};
const duration = (seconds: number) =>
  `${Math.floor(seconds / 3600)}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const runName = (run: Activity) =>
  titleForRun(run) || (run.type === 'VirtualRun' ? '室内跑步' : '户外跑步');

const Journal = () => {
  const { activities, years, thisYear } = useActivities();
  const [params, setParams] = useSearchParams();
  const linkedRun = activities.find(
    (run) => params.get('run') && run.run_id === Number(params.get('run'))
  );
  const requestedYear =
    params.get('year') || linkedRun?.start_date_local.slice(0, 4) || thisYear;
  const year =
    years.includes(requestedYear) || requestedYear === 'all'
      ? requestedYear
      : thisYear;
  const requestedMonth = Number(params.get('month') || 0);
  const month =
    Number.isInteger(requestedMonth) &&
    requestedMonth >= 1 &&
    requestedMonth <= 12
      ? requestedMonth
      : 0;
  const search = params.get('q') || '';
  const sort = params.get('sort') === 'distance' ? 'distance' : 'date';
  const scopeRuns = useMemo(
    () =>
      activities.filter(
        (r) => year === 'all' || r.start_date_local.startsWith(year)
      ),
    [activities, year]
  );
  const monthly = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => {
        const runs = scopeRuns.filter(
          (r) => Number(r.start_date_local.slice(5, 7)) === i + 1
        );
        return {
          distance: runs.reduce((sum, r) => sum + r.distance, 0) / 1000,
          count: runs.length,
        };
      }),
    [scopeRuns]
  );
  const monthRuns = useMemo(
    () =>
      (month
        ? scopeRuns.filter(
            (r) => Number(r.start_date_local.slice(5, 7)) === month
          )
        : [...scopeRuns]
      ).sort((a, b) => b.start_date_local.localeCompare(a.start_date_local)),
    [scopeRuns, month]
  );
  const filtered = useMemo(
    () =>
      monthRuns
        .filter(
          (r) =>
            !search ||
            `${runName(r)} ${r.name} ${r.start_date_local} ${locationForRun(r).city}`
              .toLowerCase()
              .includes(search.trim().toLowerCase())
        )
        .sort((a, b) =>
          sort === 'distance'
            ? b.distance - a.distance
            : b.start_date_local.localeCompare(a.start_date_local)
        ),
    [monthRuns, search, sort]
  );
  const selected =
    monthRuns.find((r) => r.run_id === Number(params.get('run'))) ||
    monthRuns[0];
  const maxPage = Math.max(1, Math.ceil(filtered.length / 7));
  const selectedPage = selected
    ? Math.floor(filtered.indexOf(selected) / 7) + 1
    : 1;
  const page = Math.min(
    maxPage,
    Math.max(1, parseInt(params.get('page') || String(selectedPage), 10) || 1)
  );
  const shown = filtered.slice((page - 1) * 7, page * 7);
  const stats = useMemo(() => {
    const distance = monthRuns.reduce((sum, r) => sum + r.distance, 0);
    const seconds = monthRuns.reduce(
      (sum, r) => sum + convertMovingTime2Sec(r.moving_time),
      0
    );
    return {
      distance,
      seconds,
      days: new Set(monthRuns.map((r) => r.start_date_local.slice(0, 10))).size,
    };
  }, [monthRuns]);
  const latest = useMemo(
    () =>
      [...activities].sort((a, b) =>
        b.start_date_local.localeCompare(a.start_date_local)
      )[0],
    [activities]
  );
  const heatYear = year === 'all' ? thisYear : year;
  const heat = useMemo(() => {
    const days = new Map<string, number>();
    activities
      .filter((r) => r.start_date_local.startsWith(heatYear))
      .forEach((r) => {
        const day = r.start_date_local.slice(0, 10);
        days.set(day, (days.get(day) || 0) + r.distance / 1000);
      });
    const jan = new Date(Number(heatYear), 0, 1);
    const pad = (jan.getDay() + 6) % 7;
    const count = Math.round(
      (new Date(Number(heatYear) + 1, 0, 1).getTime() - jan.getTime()) /
        86400000
    );
    const cells = Array.from(
      { length: Math.ceil((pad + count) / 7) * 7 },
      (_, i) => {
        if (i < pad || i >= pad + count) return null;
        const day = new Date(Number(heatYear), 0, i - pad + 1);
        const key = `${heatYear}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
        return { key, km: days.get(key) || 0 };
      }
    );
    return { cells, days: days.size };
  }, [activities, heatYear]);
  const update = (values: Record<string, string | null>, replace = false) => {
    const next = new URLSearchParams(params);
    Object.entries(values).forEach(([key, value]) =>
      value ? next.set(key, value) : next.delete(key)
    );
    if (!('page' in values)) next.delete('page');
    setParams(next, { replace, preventScrollReset: true });
  };

  const selectedIndex = selected
    ? filtered.findIndex((r) => r.run_id === selected.run_id)
    : -1;
  const chooseActivity = (index: number) => {
    const run = filtered[index];
    if (run)
      update({
        run: String(run.run_id),
        page: String(Math.floor(index / 7) + 1),
      });
  };
  const contextLink = (pathname: string) => {
    const next = new URLSearchParams({ year });
    if (month) next.set('month', String(month));
    if (selected) next.set('run', String(selected.run_id));
    return `${pathname}?${next.toString()}`;
  };

  // Preserve links shared before this redesign, including the existing run hash.
  if (window.location.hash.startsWith('#run_'))
    return <Navigate to={`/map${window.location.hash}`} replace />;

  return (
    <Layout variant="journal">
      <Helmet>
        <html lang="zh-CN" />
        <title>Suuu · 跑步档案</title>
        <meta
          name="description"
          content="Suuu 的跑步档案。用轨迹记录每一次出发，用时间积累每一公里。"
        />
      </Helmet>
      <ArchivePageHead
        eyebrow="Suuu 的个人跑步档案"
        title="跑步记录"
        description="一公里一公里，把日常跑成自己的地图。选中活动，即可旋转查看轨迹。"
        aside={
          <>
            <div className="workspace-status">
              <i className="status-dot" />
              记录更新至 {latest ? fullDate(latest) : '暂无记录'}
            </div>
            <YearFilter
              years={years}
              year={year}
              onChange={(value) =>
                update({ year: value, month: null, run: null, q: null })
              }
            />
          </>
        }
      />
      <ArchiveMetrics
        items={[
          {
            label: '累计距离',
            value: number(stats.distance / 1000, 1),
            unit: 'km',
            note: `${year === 'all' ? '所有年份' : year}${month ? ` · ${month}月` : ''}`,
          },
          { label: '出发次数', value: number(monthRuns.length), unit: '次' },
          {
            label: '平均配速',
            value: pace(stats.distance, stats.seconds),
            unit: '/km',
          },
          {
            label: '奔跑时长',
            value: number(stats.seconds / 3600, 1),
            unit: 'h',
          },
        ]}
      />
      <div className="atlas-entry-links">
        <span>把每一次出发放在一起</span>
        <Link to="/atlas?year=all">全部轨迹合集 ↗</Link>
        <Link to="/atlas?year=all&panel=footprint">点亮地图 ↗</Link>
      </div>
      <section className="home-workbench" aria-label="轨迹与活动详情">
        <div className="archive-panel home-scene" id="route-scan">
          <div className="panel-heading">
            <h2>轨迹扫描</h2>
            <span>
              {selected
                ? `${fullDate(selected)} · ${locationForRun(selected).city || '跑步记录'}`
                : '选择活动后查看'}
            </span>
          </div>
          <div className="home-scene-body">
            <RunScan activity={selected} />
          </div>
        </div>
        <aside
          className="archive-panel home-selected"
          aria-label="当前选中的活动"
        >
          <div className="home-selected-eyebrow">
            <span>
              <i className="status-dot" />
              当前活动
            </span>
            <span>
              {selectedIndex >= 0
                ? `${selectedIndex + 1} / ${filtered.length}`
                : '—'}
            </span>
          </div>
          <h2>{selected ? runName(selected) : '暂无匹配活动'}</h2>
          <p className="home-selected-date">
            {selected
              ? `${fullDate(selected)} ${selected.start_date_local.slice(11, 16)}`
              : '请调整下方筛选条件'}
          </p>
          <div className="home-distance">
            {selected ? number(selected.distance / 1000, 2) : '—'}
            <small>km</small>
          </div>
          <dl className="home-facts">
            <div>
              <dt>平均配速</dt>
              <dd>
                {selected
                  ? pace(
                      selected.distance,
                      convertMovingTime2Sec(selected.moving_time)
                    )
                  : '—'}
                <small>/km</small>
              </dd>
            </div>
            <div>
              <dt>运动用时</dt>
              <dd>
                {selected
                  ? duration(convertMovingTime2Sec(selected.moving_time))
                  : '—'}
              </dd>
            </div>
            <div>
              <dt>平均心率</dt>
              <dd>
                {selected?.average_heartrate
                  ? number(selected.average_heartrate)
                  : '—'}
                <small>{selected?.average_heartrate ? 'bpm' : '未记录'}</small>
              </dd>
            </div>
            <div>
              <dt>活动地点</dt>
              <dd>
                {selected
                  ? locationForRun(selected).city ||
                    (selected.type === 'VirtualRun' ? '室内' : '未记录')
                  : '—'}
              </dd>
            </div>
          </dl>
          <div className="home-record-controls">
            <span>切换活动，场景同步更新</span>
            <div>
              <button
                type="button"
                aria-label="上一条活动"
                disabled={selectedIndex <= 0}
                onClick={() => chooseActivity(selectedIndex - 1)}
              >
                ←
              </button>
              <button
                type="button"
                aria-label="下一条活动"
                disabled={
                  selectedIndex < 0 || selectedIndex >= filtered.length - 1
                }
                onClick={() => chooseActivity(selectedIndex + 1)}
              >
                →
              </button>
            </div>
          </div>
          {selected && (
            <Link
              className="workspace-button is-primary"
              to={contextLink('/map')}
            >
              打开完整轨迹工作台 <span aria-hidden="true">↗</span>
            </Link>
          )}
        </aside>
      </section>
      <div className="archive-divider">
        <span>每一公里，都算数。</span>
        <span className="mono">
          {number(activities.reduce((s, r) => s + r.distance, 0) / 1000, 1)} km
          累计
        </span>
      </div>

      <section className="data-section" aria-label="跑步数据">
        <div className="data-toolbar">
          <div>
            <h2>训练节奏与活动日志</h2>
            <span className="section-subtitle">
              {year === 'all' ? '全部年份' : `${year} 年`}
              {month ? ` · ${month} 月` : ''}
            </span>
          </div>
          <Link className="workspace-link" to={contextLink('/summary')}>
            进入数据总览 ↗
          </Link>
        </div>
        <div className="journal-data-grid">
          <section className="rhythm-panel" aria-labelledby="rhythm-title">
            <div className="panel-heading">
              <h3 id="rhythm-title">
                {year === 'all' ? '月度里程' : '年度节奏'}
              </h3>
              <span className="muted">距离 / km</span>
            </div>
            <div className="chart-topline">
              <span>
                {year === 'all' ? '各年份按月份汇总' : '每个月，向前一点'}
              </span>
              <span className="mono">
                {number(Math.max(...monthly.map((m) => m.distance), 0), 0)}
                <small> 最高月里程</small>
              </span>
            </div>
            <div
              className="month-chart"
              role="group"
              aria-label="按月份筛选跑步记录"
            >
              {monthly.map((m, i) => (
                <button
                  key={i}
                  type="button"
                  className={
                    month === i + 1 ? 'month-bar is-active' : 'month-bar'
                  }
                  aria-label={`${i + 1}月，${number(m.distance, 1)}公里，${m.count}次，点击筛选`}
                  aria-pressed={month === i + 1}
                  title={`${i + 1}月 · ${number(m.distance, 1)} km · ${m.count}次`}
                  onClick={() =>
                    update({
                      month: month === i + 1 ? null : String(i + 1),
                      run: null,
                    })
                  }
                >
                  <span className="bar-track">
                    <span
                      style={{
                        height: `${Math.max(2, (m.distance / Math.max(1, ...monthly.map((v) => v.distance))) * 100)}%`,
                      }}
                    />
                  </span>
                  <span className="bar-month">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                </button>
              ))}
            </div>
            <div className="heat-heading">
              <span>{heatYear} 的跑步足迹</span>
              <span className="muted">{heat.days} 个出发日</span>
            </div>
            <div
              className="run-heatmap"
              role="img"
              aria-label={`${heatYear} 年跑步日历，共 ${heat.days} 天有跑步记录。色块越亮，当日距离越长。`}
            >
              {heat.cells.map((cell, i) => (
                <span
                  key={i}
                  aria-hidden="true"
                  className={`heat-cell level-${cell ? (cell.km > 20 ? 4 : cell.km > 10 ? 3 : cell.km > 5 ? 2 : cell.km > 0 ? 1 : 0) : 'blank'}`}
                  title={
                    cell ? `${cell.key} · ${number(cell.km, 2)} km` : undefined
                  }
                />
              ))}
            </div>
            <div className="heat-legend">
              <span>每个亮点，都是一次出发。</span>
              <span>
                少{' '}
                {[0, 1, 2, 3, 4].map((i) => (
                  <i key={i} className={`heat-cell level-${i}`} />
                ))}{' '}
                多
              </span>
            </div>
            <Link to={contextLink('/summary')} className="text-action">
              查看完整统计 <span aria-hidden="true">↗</span>
            </Link>
          </section>

          <section
            className="records-panel"
            id="running-records"
            aria-labelledby="records-title"
          >
            <div className="panel-heading">
              <h3 id="records-title">
                活动日志 <span className="count-badge">{filtered.length}</span>
              </h3>
              <label className="sort-control">
                <span className="sr-only">记录排序</span>
                <select
                  aria-label="记录排序"
                  value={sort}
                  onChange={(e) => update({ sort: e.target.value })}
                >
                  <option value="date">最近出发</option>
                  <option value="distance">距离最长</option>
                </select>
              </label>
            </div>
            <div className="record-filters">
              <ActivitySearch
                className="search-field"
                label="搜索跑步记录"
                value={search}
                onChange={(value) => update({ q: value }, true)}
              />
              {month > 0 && (
                <button
                  className="filter-chip"
                  type="button"
                  aria-label={`清除 ${month} 月筛选`}
                  onClick={() => update({ month: null, run: null })}
                >
                  {month}月 <span aria-hidden="true">×</span>
                </button>
              )}
            </div>
            <div className="journal-table-wrap">
              <table
                className={
                  year === 'all' ? 'journal-table all-years' : 'journal-table'
                }
              >
                <caption className="sr-only">
                  选择跑步记录可查看点云轨迹
                </caption>
                <thead>
                  <tr>
                    <th scope="col">日期 / 活动</th>
                    <th scope="col">
                      距离 <small>km</small>
                    </th>
                    <th scope="col">
                      配速 <small>/km</small>
                    </th>
                    <th scope="col" className="duration-column">
                      用时
                    </th>
                    <th scope="col">轨迹</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((run) => (
                    <tr
                      key={run.run_id}
                      className={
                        run.run_id === selected?.run_id ? 'selected-run' : ''
                      }
                    >
                      <td>
                        <button
                          type="button"
                          className="run-select"
                          aria-label={`查看 ${fullDate(run)} ${runName(run)} ${number(run.distance / 1000, 2)} 公里的轨迹`}
                          aria-pressed={run.run_id === selected?.run_id}
                          onClick={() => {
                            update({
                              run: String(run.run_id),
                              page: String(page),
                            });
                            document
                              .getElementById('route-scan')
                              ?.scrollIntoView({
                                behavior: window.matchMedia(
                                  '(prefers-reduced-motion: reduce)'
                                ).matches
                                  ? 'auto'
                                  : 'smooth',
                                block: 'center',
                              });
                          }}
                        >
                          <time
                            dateTime={run.start_date_local.replace(' ', 'T')}
                          >
                            {year === 'all' ? fullDate(run) : dateLabel(run)}
                          </time>
                          <span>{runName(run)}</span>
                        </button>
                      </td>
                      <td className="distance-value">
                        {number(run.distance / 1000, 2)}
                      </td>
                      <td>
                        {pace(
                          run.distance,
                          convertMovingTime2Sec(run.moving_time)
                        )}
                      </td>
                      <td className="duration-column">
                        {duration(convertMovingTime2Sec(run.moving_time))}
                      </td>
                      <td className="mini-route">
                        <RouteMini activity={run} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!filtered.length && (
              <div className="empty-records">
                <strong>还没有匹配的记录</strong>
                <p>试试其他日期，或清除筛选查看全部记录。</p>
                <button
                  className="text-action"
                  type="button"
                  onClick={() => update({ q: null, month: null })}
                >
                  清除筛选
                </button>
              </div>
            )}
            <div className="records-pagination">
              <span aria-live="polite">
                {filtered.length
                  ? `${(page - 1) * 7 + 1}–${Math.min(page * 7, filtered.length)}`
                  : '0'}{' '}
                / {filtered.length} 条记录
              </span>
              <div>
                <button
                  type="button"
                  aria-label="上一页记录"
                  disabled={page <= 1}
                  onClick={() => update({ page: String(page - 1) })}
                >
                  ←
                </button>
                <span className="mono">
                  {page} / {maxPage}
                </span>
                <button
                  type="button"
                  aria-label="下一页记录"
                  disabled={page >= maxPage}
                  onClick={() => update({ page: String(page + 1) })}
                >
                  →
                </button>
              </div>
            </div>
          </section>
        </div>
      </section>
      <ArchiveFooter />
    </Layout>
  );
};

export default Journal;
