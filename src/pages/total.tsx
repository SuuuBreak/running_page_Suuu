import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import Layout from '@/components/Layout';
import {
  ArchiveFooter,
  ArchiveMetrics,
  ArchivePageHead,
  YearFilter,
} from '@/components/ArchiveUI';
import { decodeRoute, RouteMini } from '@/components/RunScan';
import useActivities from '@/hooks/useActivities';
import {
  activityName,
  formatDate,
  formatDuration,
  formatNumber,
  formatPace,
  summarizeActivities,
} from '@/utils/archive';
import { Activity, convertMovingTime2Sec, locationForRun } from '@/utils/utils';
import '@/styles/summary.css';

type Period = 'month' | 'week' | 'day';
type Bucket = {
  key: string;
  label: string;
  description: string;
  runs: Activity[];
  distance: number;
};

const DAY = 86400000;
const timestamp = (run: Activity) =>
  Date.parse(`${run.start_date_local.slice(0, 10)}T00:00:00Z`);
const dateKey = (stamp: number) => new Date(stamp).toISOString().slice(0, 10);
const shortStamp = (stamp: number) =>
  new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(stamp));

function buildBuckets(
  runs: Activity[],
  year: string,
  period: Period,
  month: number
): Bucket[] {
  if (!runs.length && year === 'all') return [];
  const bucket = (
    key: string,
    label: string,
    description: string,
    start: number,
    end: number
  ): Bucket => {
    const items = runs.filter((run) => {
      const stamp = timestamp(run);
      return stamp >= start && stamp < end;
    });
    return {
      key,
      label,
      description,
      runs: items,
      distance: items.reduce((sum, run) => sum + run.distance, 0) / 1000,
    };
  };
  if (period === 'month') {
    const dates = runs.map((run) => run.start_date_local.slice(0, 7)).sort();
    const firstYear =
      year === 'all' ? Number(dates[0]?.slice(0, 4)) : Number(year);
    const lastYear =
      year === 'all'
        ? Number(dates[dates.length - 1]?.slice(0, 4))
        : Number(year);
    const firstMonth = year === 'all' ? Number(dates[0]?.slice(5)) - 1 : 0;
    const lastMonth =
      year === 'all' ? Number(dates[dates.length - 1]?.slice(5)) - 1 : 11;
    const result: Bucket[] = [];
    for (let y = firstYear; y <= lastYear; y++) {
      for (
        let m = y === firstYear ? firstMonth : 0;
        m <= (y === lastYear ? lastMonth : 11);
        m++
      ) {
        result.push(
          bucket(
            `${y}-${String(m + 1).padStart(2, '0')}`,
            year === 'all'
              ? `${String(y).slice(2)}/${m + 1}`
              : String(m + 1).padStart(2, '0'),
            `${y} 年 ${m + 1} 月`,
            Date.UTC(y, m, 1),
            Date.UTC(y, m + 1, 1)
          )
        );
      }
    }
    return result;
  }
  const numericYear = Number(year);
  if (period === 'day') {
    const days = new Date(Date.UTC(numericYear, month, 0)).getUTCDate();
    return Array.from({ length: days }, (_, index) => {
      const start = Date.UTC(numericYear, month - 1, index + 1);
      return bucket(
        dateKey(start),
        String(index + 1).padStart(2, '0'),
        `${numericYear} 年 ${month} 月 ${index + 1} 日`,
        start,
        start + DAY
      );
    });
  }
  const jan = Date.UTC(numericYear, 0, 1);
  const nextYear = Date.UTC(numericYear + 1, 0, 1);
  const monday = jan - ((new Date(jan).getUTCDay() + 6) % 7) * DAY;
  const weeks = Math.ceil((nextYear - monday) / (7 * DAY));
  return Array.from({ length: weeks }, (_, index) => {
    const start = monday + index * 7 * DAY;
    const end = start + 7 * DAY;
    return bucket(
      `week-${dateKey(start)}`,
      String(index + 1).padStart(2, '0'),
      `${numericYear} 年第 ${index + 1} 周 · ${shortStamp(Math.max(jan, start))}–${shortStamp(Math.min(nextYear - DAY, end - DAY))}`,
      start,
      end
    );
  });
}

function mapLink(run: Activity) {
  return `/map?${new URLSearchParams({
    year: run.start_date_local.slice(0, 4),
    month: String(Number(run.start_date_local.slice(5, 7))),
    run: String(run.run_id),
  })}`;
}

const HomePage = () => {
  const { activities, years, thisYear } = useActivities();
  const [params, setParams] = useSearchParams();
  const [hovered, setHovered] = useState<string | null>(null);
  const requestedYear = params.get('year') || thisYear;
  const year =
    years.includes(requestedYear) || requestedYear === 'all'
      ? requestedYear
      : thisYear;
  const period: Period =
    year === 'all'
      ? 'month'
      : params.get('period') === 'day'
        ? 'day'
        : params.get('period') === 'week'
          ? 'week'
          : 'month';
  const requestedMonth = Number(params.get('month') || 0);
  const month =
    Number.isInteger(requestedMonth) &&
    requestedMonth > 0 &&
    requestedMonth <= 12
      ? requestedMonth
      : 0;
  const scopeRuns = useMemo(
    () =>
      activities.filter(
        (run) => year === 'all' || run.start_date_local.startsWith(year)
      ),
    [activities, year]
  );
  const chartYear = year === 'all' && period !== 'month' ? thisYear : year;
  const chartRuns = useMemo(
    () =>
      chartYear === year
        ? scopeRuns
        : scopeRuns.filter((run) => run.start_date_local.startsWith(chartYear)),
    [chartYear, year, scopeRuns]
  );
  const latest = useMemo(
    () =>
      [...chartRuns].sort((a, b) =>
        b.start_date_local.localeCompare(a.start_date_local)
      )[0],
    [chartRuns]
  );
  const detailMonth =
    month || (latest ? Number(latest.start_date_local.slice(5, 7)) : 1);
  const buckets = useMemo(
    () => buildBuckets(chartRuns, chartYear, period, detailMonth),
    [chartRuns, chartYear, period, detailMonth]
  );
  const activeBucket = buckets.find(
    (item) => item.key === params.get('bucket')
  );
  const selectedMonth =
    period === 'day' ? detailMonth : period === 'month' ? month : 0;
  const monthRoutes = useMemo(() => {
    if (period !== 'month' || !month) return [];
    return scopeRuns
      .filter(
        (run) =>
          Number(run.start_date_local.slice(5, 7)) === month &&
          decodeRoute(run).length > 1
      )
      .sort((a, b) => b.start_date_local.localeCompare(a.start_date_local));
  }, [scopeRuns, period, month]);
  const selectedRuns = useMemo(
    () =>
      [
        ...(activeBucket?.runs ||
          (selectedMonth
            ? scopeRuns.filter(
                (run) =>
                  Number(run.start_date_local.slice(5, 7)) === selectedMonth
              )
            : scopeRuns)),
      ].sort((a, b) => b.start_date_local.localeCompare(a.start_date_local)),
    [activeBucket, selectedMonth, scopeRuns]
  );
  const summary = useMemo(
    () => summarizeActivities(selectedRuns),
    [selectedRuns]
  );
  const yearly = useMemo(
    () =>
      years.map((y) => ({
        year: y,
        ...summarizeActivities(
          activities.filter((run) => run.start_date_local.startsWith(y))
        ),
      })),
    [activities, years]
  );
  const scopeLabel =
    activeBucket?.description ||
    `${year === 'all' ? '全部年份' : `${year} 年`}${selectedMonth ? ` · ${selectedMonth} 月` : ''}`;
  const selectedMonthReadout: Bucket | undefined = selectedMonth
    ? period === 'month' && year !== 'all'
      ? buckets.find(
          (item) =>
            item.key === `${year}-${String(selectedMonth).padStart(2, '0')}`
        )
      : {
          key: `selected-month-${selectedMonth}`,
          label: String(selectedMonth),
          description: `${year === 'all' ? '全部年份' : `${year} 年`} ${selectedMonth} 月合计`,
          runs: selectedRuns,
          distance: summary.distance / 1000,
        }
    : undefined;
  const highlighted =
    buckets.find((item) => item.key === hovered) ||
    activeBucket ||
    selectedMonthReadout ||
    [...buckets].reverse().find((item) => item.runs.length > 0);
  const maxDistance = Math.max(1, ...buckets.map((item) => item.distance));
  const maxYearDistance = Math.max(1, ...yearly.map((item) => item.distance));
  const pageCount = Math.max(1, Math.ceil(selectedRuns.length / 6));
  const page = Math.min(
    pageCount,
    Math.max(1, parseInt(params.get('page') || '1', 10) || 1)
  );
  const longest = [...selectedRuns].sort((a, b) => b.distance - a.distance)[0];
  const fastest = selectedRuns
    .filter(
      (run) =>
        run.distance >= 5000 && convertMovingTime2Sec(run.moving_time) > 0
    )
    .sort(
      (a, b) =>
        convertMovingTime2Sec(a.moving_time) / a.distance -
        convertMovingTime2Sec(b.moving_time) / b.distance
    )[0];

  const update = (values: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    Object.entries(values).forEach(([key, value]) =>
      value ? next.set(key, value) : next.delete(key)
    );
    if (!('page' in values)) next.delete('page');
    setHovered(null);
    setParams(next);
  };
  const changeYear = (value: string) =>
    update({ year: value, month: null, bucket: null, run: null });
  const changePeriod = (value: Period) =>
    update({
      period: value,
      year: value !== 'month' && year === 'all' ? thisYear : year,
      month: value === 'day' ? String(detailMonth) : null,
      bucket: null,
      run: null,
    });
  const selectBucket = (item: Bucket) => {
    const selected = activeBucket?.key === item.key;
    update({
      year:
        year === 'all' && period === 'month' && !selected
          ? item.key.slice(0, 4)
          : year,
      bucket: selected ? null : item.key,
      month:
        !selected && period === 'month'
          ? String(Number(item.key.slice(5, 7)))
          : period === 'day'
            ? String(detailMonth)
            : null,
      run: null,
    });
  };

  return (
    <Layout variant="journal">
      <Helmet>
        <html lang="zh-CN" />
        <title>Suuu · 数据总览</title>
      </Helmet>
      <div className="summary-workspace">
        <ArchivePageHead
          eyebrow="跑步数据档案"
          title="数据总览"
          description="每一份积累，都看得见。从单次出发到全年里程，回看你的奔跑节奏。选择图表中的一个周期，继续探索那段时间的跑步记录。"
          aside={<YearFilter years={years} year={year} onChange={changeYear} />}
        />
        <div className="summary-scope">
          <span>
            <i aria-hidden="true" />
            统计范围 <strong>{scopeLabel}</strong>
          </span>
          {month || activeBucket ? (
            <button
              type="button"
              onClick={() =>
                update({
                  month: null,
                  bucket: null,
                  period: 'month',
                  run: null,
                })
              }
            >
              查看{year === 'all' ? '全部' : '全年'}记录 ×
            </button>
          ) : (
            <span>所有数据均来自实际跑步记录</span>
          )}
        </div>
        <ArchiveMetrics
          items={[
            {
              label: '累计里程',
              value: formatNumber(summary.distance / 1000, 1),
              unit: 'km',
            },
            {
              label: '出发次数',
              value: formatNumber(summary.count),
              unit: '次',
              note: `${summary.days} 个出发日`,
            },
            { label: '平均配速', value: summary.pace, unit: '/km' },
            {
              label: '奔跑时长',
              value: formatNumber(summary.seconds / 3600, 1),
              unit: 'h',
            },
          ]}
        />

        <div className="summary-analysis-grid">
          <section
            className="archive-panel summary-trend"
            aria-labelledby="summary-trend-title"
          >
            <div className="panel-heading">
              <div>
                <h2 id="summary-trend-title">里程趋势</h2>
                <p>
                  {chartYear === 'all'
                    ? '连续月份，记录每一段积累'
                    : `${chartYear} 年的奔跑节奏`}
                </p>
              </div>
              <div
                className="summary-period-switch"
                role="group"
                aria-label="趋势统计周期"
              >
                {(
                  [
                    { value: 'month', label: '按月' },
                    { value: 'week', label: '按周' },
                    { value: 'day', label: '按日' },
                  ] as const
                ).map((item) => (
                  <button
                    type="button"
                    key={item.value}
                    aria-pressed={period === item.value}
                    onClick={() => changePeriod(item.value)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="summary-chart-readout">
              <div>
                <span>{highlighted?.description || '暂无记录'}</span>
                <strong>
                  {formatNumber(highlighted?.distance || 0, 1)}
                  <small>km</small>
                </strong>
                <span>{highlighted?.runs.length || 0} 次出发</span>
              </div>
              {period === 'day' ? (
                <label className="summary-month-field">
                  查看月份{' '}
                  <select
                    aria-label="日趋势月份"
                    value={detailMonth}
                    onChange={(event) =>
                      update({
                        month: event.target.value,
                        bucket: null,
                        run: null,
                      })
                    }
                  >
                    {Array.from({ length: 12 }, (_, index) => (
                      <option key={index} value={index + 1}>
                        {index + 1} 月
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <span className="summary-chart-unit">
                  {period === 'week' ? '每周里程 / km' : '每月里程 / km'}
                </span>
              )}
            </div>
            <div className="summary-trend-plot">
              <div className="summary-y-axis" aria-hidden="true">
                {[1, 0.75, 0.5, 0.25, 0].map((ratio) => (
                  <span key={ratio}>{formatNumber(maxDistance * ratio)}</span>
                ))}
              </div>
              <div
                className="summary-trend-scroll"
                role="group"
                aria-label="点击一个周期筛选跑步记录"
              >
                <div
                  className="summary-trend-bars"
                  style={{
                    minWidth:
                      buckets.length <= 12
                        ? '0px'
                        : `${buckets.length * (period === 'month' ? 32 : 25)}px`,
                  }}
                >
                  {buckets.map((item) => {
                    const selected = activeBucket
                      ? item.key === activeBucket.key
                      : period === 'month' && month > 0
                        ? Number(item.key.slice(5, 7)) === month
                        : false;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        className={`summary-trend-bar ${selected ? 'is-selected' : ''}`}
                        aria-pressed={selected}
                        aria-label={`${item.description}，${formatNumber(item.distance, 1)} 公里，${item.runs.length} 次出发，点击筛选`}
                        title={`${item.description} · ${formatNumber(item.distance, 1)} km · ${item.runs.length} 次`}
                        onClick={() => selectBucket(item)}
                        onMouseEnter={() => setHovered(item.key)}
                        onMouseLeave={() => setHovered(null)}
                        onFocus={() => setHovered(item.key)}
                        onBlur={() => setHovered(null)}
                      >
                        <span className="summary-bar-track">
                          <span
                            style={{
                              height:
                                item.distance > 0
                                  ? `${Math.max(1, (item.distance / maxDistance) * 100)}%`
                                  : '0%',
                            }}
                          />
                        </span>
                        <span className="summary-bar-label">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="summary-chart-foot">
              <span>
                <i aria-hidden="true" />
                点击图柱，筛选这一周期
              </span>
              <span>
                {period === 'week'
                  ? '周一开始，年初与年末按实际天数统计'
                  : period === 'day'
                    ? `${detailMonth} 月，包含休息日`
                    : '没有记录的周期显示为零'}
              </span>
            </div>
            {period === 'month' && month > 0 && (
              <div className="summary-month-routes">
                <div className="summary-month-route-heading">
                  <strong>
                    {month} 月路线 · {monthRoutes.length} 条
                  </strong>
                  <Link
                    to={`/atlas?year=${year}&month=${month}&panel=footprint`}
                  >
                    点亮地图 ↗
                  </Link>
                </div>
                {monthRoutes.length > 0 ? (
                  <>
                    <div className="summary-month-samples">
                      {monthRoutes.slice(0, 4).map((run) => (
                        <Link
                          to={mapLink(run)}
                          key={run.run_id}
                          aria-label={`查看 ${formatDate(run)} ${formatNumber(run.distance / 1000, 2)} 公里的轨迹`}
                        >
                          <RouteMini activity={run} />
                          <time dateTime={run.start_date_local.slice(0, 10)}>
                            {formatDate(run).slice(-5)}
                          </time>
                          <span>{formatNumber(run.distance / 1000, 2)} km</span>
                        </Link>
                      ))}
                    </div>
                    <Link
                      className="summary-all-month"
                      to={`/atlas?year=${year}&month=${month}`}
                    >
                      查看本月轨迹合集 ↗
                    </Link>
                  </>
                ) : (
                  <p>这个月没有可展示的 GPS 路线。</p>
                )}
              </div>
            )}
          </section>

          <section
            className="archive-panel summary-comparison"
            aria-labelledby="summary-comparison-title"
          >
            <div className="panel-heading">
              <div>
                <h2 id="summary-comparison-title">年度积累</h2>
                <p>把时间拉长，看见走过的路。</p>
              </div>
              <span className="summary-panel-glyph" aria-hidden="true">
                ↗
              </span>
            </div>
            <div className="summary-year-bars">
              {yearly.map((item) => (
                <button
                  className={
                    year === item.year
                      ? 'summary-year-row is-selected'
                      : 'summary-year-row'
                  }
                  key={item.year}
                  type="button"
                  aria-pressed={year === item.year}
                  aria-label={`查看 ${item.year} 年，${formatNumber(item.distance / 1000, 1)} 公里，${item.count} 次出发`}
                  onClick={() => changeYear(item.year)}
                >
                  <span className="summary-year-top">
                    <strong>{item.year}</strong>
                    <span>
                      {formatNumber(item.distance / 1000, 1)}
                      <small> km</small>
                    </span>
                  </span>
                  <span className="summary-year-track">
                    <span
                      style={{
                        width: `${(item.distance / maxYearDistance) * 100}%`,
                      }}
                    />
                  </span>
                  <span className="summary-year-meta">
                    <span>{item.count} 次出发</span>
                    <span>{item.days} 个出发日</span>
                  </span>
                </button>
              ))}
            </div>
            <div className="summary-comparison-note">
              <span>里程累计</span>
              <strong>
                {formatNumber(
                  activities.reduce((sum, run) => sum + run.distance, 0) / 1000,
                  1
                )}
                <small> km</small>
              </strong>
              <p>按已保存的记录统计，各年份覆盖时长可能不同。</p>
            </div>
          </section>
        </div>

        <section className="summary-milestones" aria-label="当前范围的跑步亮点">
          <div className="archive-panel summary-milestone">
            <span className="summary-insight-label">
              <i className="summary-distance-icon" aria-hidden="true" />
              最远的一次
            </span>
            {longest ? (
              <>
                <strong>
                  {formatNumber(longest.distance / 1000, 2)}
                  <small>km</small>
                </strong>
                <span>
                  {formatDate(longest)} · {activityName(longest)}
                </span>
                <Link to={mapLink(longest)}>
                  探索这次轨迹 <span aria-hidden="true">↗</span>
                </Link>
              </>
            ) : (
              <div className="summary-insight-empty">当前范围暂无跑步记录</div>
            )}
          </div>
          <div className="archive-panel summary-milestone">
            <span className="summary-insight-label">
              <i className="summary-pace-icon" aria-hidden="true" />
              最快的 5km+ 活动
            </span>
            {fastest ? (
              <>
                <strong>
                  {formatPace(
                    fastest.distance,
                    convertMovingTime2Sec(fastest.moving_time)
                  )}
                  <small>/km</small>
                </strong>
                <span>
                  {formatDate(fastest)} ·{' '}
                  {formatNumber(fastest.distance / 1000, 2)} km
                </span>
                <Link to={mapLink(fastest)}>
                  探索这次轨迹 <span aria-hidden="true">↗</span>
                </Link>
              </>
            ) : (
              <div className="summary-insight-empty">
                当前范围暂无 5 公里以上活动
              </div>
            )}
          </div>
          <div className="archive-panel summary-training-facts">
            <span className="summary-insight-label">训练侧写</span>
            <dl>
              <div>
                <dt>每次平均距离</dt>
                <dd>
                  {summary.count
                    ? formatNumber(summary.distance / summary.count / 1000, 2)
                    : '—'}
                  <small> km</small>
                </dd>
              </div>
              <div>
                <dt>平均心率</dt>
                <dd>
                  {summary.heartRate ?? '—'}
                  <small> bpm</small>
                </dd>
              </div>
              <div>
                <dt>累计爬升</dt>
                <dd>
                  {formatNumber(summary.elevation)}
                  <small> m</small>
                </dd>
              </div>
            </dl>
            <p>心率按有数据的活动时长加权；最快活动按各次平均配速比较。</p>
          </div>
        </section>

        <section
          className="archive-panel summary-records"
          aria-labelledby="summary-records-title"
        >
          <div className="panel-heading">
            <div>
              <h2 id="summary-records-title">
                周期记录{' '}
                <span className="count-badge">{selectedRuns.length}</span>
              </h2>
              <p>{scopeLabel} · 选择一条记录，进入交互轨迹</p>
            </div>
            <Link
              className="summary-records-map"
              to={`/map?${new URLSearchParams({ year, ...(selectedMonth ? { month: String(selectedMonth) } : {}), ...(selectedRuns[0] ? { run: String(selectedRuns[0].run_id) } : {}) })}`}
            >
              在地图中查看 <span aria-hidden="true">↗</span>
            </Link>
          </div>
          {selectedRuns.length > 0 ? (
            <div className="summary-records-scroll">
              <table className="summary-records-table">
                <caption className="sr-only">
                  当前统计周期的真实跑步记录
                </caption>
                <thead>
                  <tr>
                    <th scope="col">出发日期 / 活动</th>
                    <th scope="col">
                      距离 <small>km</small>
                    </th>
                    <th scope="col">
                      平均配速 <small>/km</small>
                    </th>
                    <th scope="col" className="summary-time-column">
                      用时
                    </th>
                    <th scope="col" className="summary-hr-column">
                      心率 <small>bpm</small>
                    </th>
                    <th scope="col">轨迹</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedRuns.slice((page - 1) * 6, page * 6).map((run) => (
                    <tr key={run.run_id}>
                      <td>
                        <Link
                          to={mapLink(run)}
                          className="summary-record-link"
                          aria-label={`查看 ${formatDate(run)} ${activityName(run)} ${formatNumber(run.distance / 1000, 2)} 公里的轨迹`}
                        >
                          <time
                            dateTime={run.start_date_local.replace(' ', 'T')}
                          >
                            {formatDate(run)}
                          </time>
                          <span>
                            {activityName(run)}
                            {locationForRun(run).city && (
                              <small>{locationForRun(run).city}</small>
                            )}
                          </span>
                        </Link>
                      </td>
                      <td className="summary-record-distance">
                        {formatNumber(run.distance / 1000, 2)}
                      </td>
                      <td>
                        {formatPace(
                          run.distance,
                          convertMovingTime2Sec(run.moving_time)
                        )}
                      </td>
                      <td className="summary-time-column">
                        {formatDuration(convertMovingTime2Sec(run.moving_time))}
                      </td>
                      <td className="summary-hr-column">
                        {run.average_heartrate
                          ? formatNumber(run.average_heartrate)
                          : '—'}
                      </td>
                      <td>
                        <Link
                          className="summary-route-link"
                          to={mapLink(run)}
                          aria-label={`探索 ${formatDate(run)} 的跑步轨迹`}
                        >
                          <RouteMini activity={run} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="summary-empty" role="status">
              <strong>这个周期还没有记录</strong>
              <p>试试其他图柱，或回到全年的跑步档案。</p>
              <button
                type="button"
                onClick={() =>
                  update({
                    month: null,
                    bucket: null,
                    period: 'month',
                    run: null,
                  })
                }
              >
                查看全年记录
              </button>
            </div>
          )}
          <div className="summary-pagination">
            <span aria-live="polite">
              {selectedRuns.length
                ? `${(page - 1) * 6 + 1}–${Math.min(page * 6, selectedRuns.length)}`
                : '0'}{' '}
              / {selectedRuns.length} 条记录
            </span>
            <div>
              <button
                type="button"
                aria-label="上一页周期记录"
                disabled={page <= 1}
                onClick={() => update({ page: String(page - 1) })}
              >
                ←
              </button>
              <span>
                {page} / {pageCount}
              </span>
              <button
                type="button"
                aria-label="下一页周期记录"
                disabled={page >= pageCount}
                onClick={() => update({ page: String(page + 1) })}
              >
                →
              </button>
            </div>
          </div>
        </section>
      </div>
      <ArchiveFooter />
    </Layout>
  );
};

export default HomePage;
