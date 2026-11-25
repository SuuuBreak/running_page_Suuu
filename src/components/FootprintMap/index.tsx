import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from 'react-router-dom';
import {
  regionKey,
  regionName,
  type Region,
  type Visit,
} from '@/utils/footprint';
import { formatDate, formatNumber } from '@/utils/archive';
import {
  cameraValue,
  clamp,
  distanceScale,
  fitCityRoutes,
  focusRegion,
  overview,
  readCamera,
  type Camera,
} from './mapGeometry';
import './city-routes.css';

const shortName = (name: string) =>
  name.replace(
    /维吾尔自治区|壮族自治区|回族自治区|特别行政区|自治区|省|市/g,
    ''
  );
const footprintKeys = [
  'fpArea',
  'fpLights',
  'fpRegion',
  'fpCity',
  'fpPage',
  'fpGeo',
  'fpLocal',
] as const;
const noVisits: Visit[] = [];
type ViewPatch = Partial<Record<(typeof footprintKeys)[number], string | null>>;
export default function FootprintMap({
  regions,
  visits,
  scope,
}: {
  regions: Region[];
  visits: Visit[];
  scope: string;
}) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const returnState = { fromFootprint: location.pathname + location.search };
  const read = (key: (typeof footprintKeys)[number]) =>
    params.get('fpScope') === scope ? params.get(key) : null;
  const write = (patch: ViewPatch) => {
    const next = new URLSearchParams(params);
    if (next.get('fpScope') !== scope)
      footprintKeys.forEach((key) => next.delete(key));
    next.set('fpScope', scope);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace: true, preventScrollReset: true });
  };
  const area = read('fpArea') === 'world' ? 'world' : 'china';
  const lights = read('fpLights') !== 'off';
  const selected = read('fpRegion') || '';
  const page = Math.max(1, Math.floor(Number(read('fpPage'))) || 1);
  const [draggedCamera, setDraggedCamera] = useState<Camera | null>(null);
  const [hoveredRun, setHoveredRun] = useState<string | null>(null);
  const [size, setSize] = useState({ width: 800, height: 500 });
  const surface = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    camera: Camera;
    moved: boolean;
  } | null>(null);
  const grouped = useMemo(() => {
    const result = new Map<string, Visit[]>();
    for (const visit of visits)
      for (const key of [visit.province, visit.country])
        if (key) {
          const entries = result.get(key);
          if (entries) entries.push(visit);
          else result.set(key, [visit]);
        }
    return result;
  }, [visits]);
  const displayed = useMemo(
    () =>
      regions.filter((r) =>
        area === 'china' ? !!r.properties?.id : !r.properties?.id
      ),
    [area, regions]
  );
  const ranked = displayed
    .filter((r) => grouped.has(regionKey(r)))
    .sort(
      (a, b) =>
        (grouped.get(regionKey(b))?.length || 0) -
        (grouped.get(regionKey(a))?.length || 0)
    );
  const activeRegion = displayed.find((r) => regionKey(r) === selected);
  const regional = activeRegion ? grouped.get(selected) ?? noVisits : visits;
  const cityCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const { city } of regional)
      if (city) counts.set(city, (counts.get(city) || 0) + 1);
    return counts;
  }, [regional]);
  const requestedCity = read('fpCity') || '';
  const city = cityCounts.has(requestedCity) ? requestedCity : '';
  const scoped = useMemo(
    () =>
      regional
        .filter((v) => !city || v.city === city)
        .sort((a, b) =>
          b.activity.start_date_local.localeCompare(a.activity.start_date_local)
        ),
    [regional, city]
  );
  const maxPage = Math.max(1, Math.ceil(scoped.length / 6));
  const currentPage = Math.min(maxPage, page);
  const cameraKey = city ? 'fpLocal' : 'fpGeo';
  const camera = draggedCamera || readCamera(read(cameraKey));
  const saveCamera = (value: Camera) =>
    write({ [cameraKey]: cameraValue(value) });
  const cityLayer = useMemo(
    () => fitCityRoutes(city ? scoped : [], size.width, size.height),
    [city, scoped, size]
  );
  const scale = distanceScale(cityLayer.pixelsPerMetre * camera.zoom);
  const hovered =
    hoveredRun &&
    cityLayer.routes.find(
      ({ activity }) => String(activity.run_id) === hoveredRun
    );
  const width = city ? size.width : 1000,
    height = city ? size.height : 600;
  const project = useCallback(
    (lng: number, lat: number): [number, number] =>
      area === 'china'
        ? [500 + (lng - 104) * 14.2, 300 + (36 - lat) * 15.6]
        : [
            ((lng + 180) / 360) * 1000,
            300 -
              Math.log(
                Math.tan(Math.PI / 4 + (clamp(lat, -82, 82) * Math.PI) / 360)
              ) *
                150,
          ],
    [area]
  );
  const paths = useMemo(
    () =>
      displayed.map((region) => {
        const polygons =
          region.geometry.type === 'Polygon'
            ? [region.geometry.coordinates]
            : region.geometry.coordinates;
        const path = polygons
          .flatMap((polygon) =>
            polygon.map(
              (ring) =>
                ring
                  .map(
                    ([lng, lat], i) =>
                      `${i ? 'L' : 'M'}${project(lng, lat)
                        .map((n) => n.toFixed(1))
                        .join(',')}`
                  )
                  .join(' ') + 'Z'
            )
          )
          .join(' ');
        return { region, path };
      }),
    [displayed, project]
  );
  const choose = (key: string) => {
    const region = displayed.find((item) => regionKey(item) === key);
    setDraggedCamera(null);
    setHoveredRun(null);
    write({
      fpRegion: key,
      fpCity: null,
      fpPage: null,
      fpLocal: null,
      fpGeo: region ? cameraValue(focusRegion(region, project)) : null,
    });
  };
  const switchArea = (value: 'china' | 'world') => {
    setDraggedCamera(null);
    setHoveredRun(null);
    write({
      fpArea: value,
      fpRegion: null,
      fpCity: null,
      fpPage: null,
      fpGeo: null,
      fpLocal: null,
    });
  };
  const openCity = (name: string) => {
    setDraggedCamera(null);
    setHoveredRun(null);
    write({ fpCity: name, fpPage: null, fpLocal: null });
  };
  const zoom = (factor: number) => {
    const next = clamp(camera.zoom * factor, 0.8, 8);
    const ratio = next / camera.zoom;
    saveCamera({ x: camera.x * ratio, y: camera.y * ratio, zoom: next });
  };
  const down = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 || drag.current) return;
    svg.current?.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    const layer = event.currentTarget.querySelector('.footprint-camera');
    const transform = layer ? getComputedStyle(layer).transform : 'none';
    const visible =
      transform === 'none' ? null : new DOMMatrixReadOnly(transform);
    const startCamera = visible
      ? {
          x: visible.e - ((1 - visible.a) * width) / 2,
          y: visible.f - ((1 - visible.d) * height) / 2,
          zoom: visible.a,
        }
      : camera;
    drag.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      camera: startCamera,
      moved: false,
    };
    setDraggedCamera(startCamera);
  };
  const move = (event: ReactPointerEvent<SVGSVGElement>) => {
    const start = drag.current;
    if (!start || event.pointerId !== start.id) return;
    const dx = event.clientX - start.x,
      dy = event.clientY - start.y;
    if (Math.hypot(dx, dy) < 4 && !start.moved) return;
    start.moved = true;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(rect.width / width, rect.height / height);
    setDraggedCamera({
      ...start.camera,
      x: start.camera.x + dx / ratio,
      y: start.camera.y + dy / ratio,
    });
  };
  const up = (event: ReactPointerEvent<SVGSVGElement>) => {
    const start = drag.current;
    if (!start || start.id !== event.pointerId) return;
    // Pointer capture changes the click target. Resolve the region from the
    // release position only for a click, so dragging never selects a province.
    if (event.type === 'pointerup') {
      if (start.moved) {
        const rect = event.currentTarget.getBoundingClientRect();
        const ratio = Math.min(rect.width / width, rect.height / height);
        saveCamera({
          ...start.camera,
          x: start.camera.x + (event.clientX - start.x) / ratio,
          y: start.camera.y + (event.clientY - start.y) / ratio,
        });
      } else {
        const target = document
          .elementFromPoint(event.clientX, event.clientY)
          ?.closest('[data-region],[data-city],[data-run]');
        const id = target?.getAttribute('data-run');
        const cityTarget = target?.getAttribute('data-city');
        const regionKey = target?.getAttribute('data-region');
        if (id) {
          const visit = scoped.find((v) => String(v.activity.run_id) === id);
          if (visit)
            navigate(
              `/map?year=${visit.activity.start_date_local.slice(0, 4)}&run=${id}`,
              { state: returnState }
            );
        } else if (cityTarget) openCity(cityTarget);
        else if (regionKey) choose(regionKey);
      }
    }
    setDraggedCamera(null);
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const visitMarkers = useMemo(
    () =>
      regional
        .filter((v) => v.point && (area === 'world' || v.province))
        .filter(
          (v, index, list) =>
            list.findIndex(
              (p) =>
                p.point &&
                v.point &&
                Math.abs(p.point[0] - v.point[0]) < 0.08 &&
                Math.abs(p.point[1] - v.point[1]) < 0.08
            ) === index
        ),
    [regional, area]
  );
  const unknown = visits.filter((v) =>
    area === 'china' ? !v.province : !v.country
  ).length;
  return (
    <div className="footprint-layout">
      <section
        className="archive-panel footprint-panel"
        ref={surface}
        aria-label="点亮足迹地图"
      >
        <div className="footprint-toolbar">
          <div className="atlas-tabs" role="group" aria-label="地图范围">
            <button
              type="button"
              aria-pressed={area === 'china'}
              onClick={() => switchArea('china')}
            >
              中国
            </button>
            <button
              type="button"
              aria-pressed={area === 'world'}
              onClick={() => switchArea('world')}
            >
              世界
            </button>
          </div>
          {!city && (
            <button
              className="footprint-lights"
              type="button"
              aria-pressed={lights}
              onClick={() => write({ fpLights: lights ? 'off' : null })}
            >
              {lights ? '☀ 区域已点亮' : '☀ 点亮区域'}
            </button>
          )}
          <button
            type="button"
            className="footprint-fullscreen"
            aria-label="切换足迹地图全屏"
            onClick={() =>
              document.fullscreenElement
                ? void document.exitFullscreen()
                : void surface.current?.requestFullscreen()
            }
          >
            ⛶
          </button>
        </div>
        <div className="city-navigation">
          {city ? (
            <button
              type="button"
              onClick={() => openCity('')}
              aria-label="返回区域地图"
            >
              ←{' '}
              {activeRegion
                ? shortName(regionName(activeRegion))
                : area === 'china'
                  ? '中国'
                  : '世界'}
            </button>
          ) : (
            <span>
              {activeRegion ? shortName(regionName(activeRegion)) : '城市路线'}
            </span>
          )}
          <select
            aria-label="聚焦城市路线"
            value={city}
            onChange={(e) => openCity(e.target.value)}
            disabled={!cityCounts.size}
          >
            <option value="">选择城市</option>
            {[...cityCounts]
              .sort((a, b) => b[1] - a[1])
              .map(([name]) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
          </select>
        </div>
        <div className="footprint-surface">
          <svg
            ref={svg}
            viewBox={`0 0 ${width} ${height}`}
            role="group"
            tabIndex={0}
            aria-label={
              city
                ? `${city}的 GPS 路线，点击路线查看活动`
                : `${scope}跑步足迹地图，可拖动平移，使用加减按钮缩放，点击区域查看活动`
            }
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            onLostPointerCapture={() => {
              drag.current = null;
              setDraggedCamera(null);
            }}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return;
              if (e.key === '+' || e.key === '=') {
                e.preventDefault();
                zoom(1.25);
              }
              if (e.key === '-') {
                e.preventDefault();
                zoom(0.8);
              }
              if (e.key === 'Home') {
                e.preventDefault();
                saveCamera(overview);
              }
              if (e.key.startsWith('Arrow')) {
                e.preventDefault();
                saveCamera({
                  ...camera,
                  x:
                    camera.x +
                    (e.key === 'ArrowLeft'
                      ? 35
                      : e.key === 'ArrowRight'
                        ? -35
                        : 0),
                  y:
                    camera.y +
                    (e.key === 'ArrowUp'
                      ? 35
                      : e.key === 'ArrowDown'
                        ? -35
                        : 0),
                });
              }
            }}
          >
            <defs>
              {city && scale && (
                <pattern
                  id="city-metre-grid"
                  patternUnits="userSpaceOnUse"
                  x={(width / 2 + camera.x) % scale.width}
                  y={(height / 2 + camera.y) % scale.width}
                  width={scale.width}
                  height={scale.width}
                >
                  <path
                    d={`M ${scale.width} 0 H 0 V ${scale.width}`}
                    fill="none"
                    stroke="var(--line)"
                  />
                  <circle cx="1" cy="1" r="1" fill="var(--muted)" />
                </pattern>
              )}
              <pattern
                id="atlas-dots"
                width="5"
                height="5"
                patternUnits="userSpaceOnUse"
              >
                <circle cx="1" cy="1" r="0.65" fill="currentColor" />
              </pattern>
            </defs>
            {city && scale && (
              <rect
                width={width}
                height={height}
                fill="url(#city-metre-grid)"
                opacity=".45"
                pointerEvents="none"
              />
            )}
            <g
              key={city || area}
              className={!draggedCamera ? 'footprint-camera' : undefined}
              transform={`translate(${width / 2 + camera.x} ${height / 2 + camera.y}) scale(${camera.zoom}) translate(${-width / 2} ${-height / 2})`}
            >
              {!city &&
                paths.map(({ region, path }) => {
                  const key = regionKey(region),
                    count = grouped.get(key)?.length || 0;
                  return (
                    <g
                      key={key}
                      className={`footprint-region ${count && lights ? 'is-visited' : ''} ${selected === key ? 'is-active' : ''}`}
                    >
                      <path
                        d={path}
                        fillRule="evenodd"
                        data-region={key}
                        tabIndex={0}
                        role="button"
                        aria-label={`${regionName(region)}，${count} 次活动`}
                        aria-pressed={selected === key}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            choose(key);
                          }
                        }}
                        vectorEffect="non-scaling-stroke"
                      >
                        <title>
                          {regionName(region)} · {count} 次活动
                        </title>
                      </path>
                      {!!count && lights && (
                        <path
                          className="footprint-dotfill"
                          d={path}
                          fill="url(#atlas-dots)"
                          fillRule="evenodd"
                          aria-hidden="true"
                        />
                      )}
                    </g>
                  );
                })}
              {!city &&
                area === 'china' &&
                ranked.map((region) => {
                  const cp = region.properties?.cp;
                  if (!Array.isArray(cp)) return null;
                  const p = project(cp[0], cp[1]);
                  return (
                    <text
                      key={regionKey(region)}
                      x={p[0]}
                      y={p[1]}
                      className="footprint-map-label"
                      textAnchor="middle"
                      fontSize={13 / Math.sqrt(camera.zoom)}
                    >
                      {shortName(regionName(region))}
                    </text>
                  );
                })}
              {!city &&
                lights &&
                visitMarkers.map((visit, i) => {
                  const p = project(...visit.point!);
                  return (
                    <g key={i} data-city={visit.city || undefined}>
                      {visit.city && (
                        <circle
                          cx={p[0]}
                          cy={p[1]}
                          r={14 / camera.zoom}
                          className="city-marker-target"
                        >
                          <title>{visit.city} · 查看城市路线</title>
                        </circle>
                      )}
                      <circle
                        cx={p[0]}
                        cy={p[1]}
                        r={4 / Math.sqrt(camera.zoom)}
                        className="footprint-visit-point"
                      />
                    </g>
                  );
                })}
              {city && (
                <>
                  {cityLayer.routes.map(({ activity, path }) => (
                    <path
                      key={activity.run_id}
                      d={path}
                      className="city-route-line"
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                  {hovered && (
                    <path
                      d={hovered.path}
                      className="city-route-highlight"
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                  {cityLayer.routes.map(({ activity, path }) => (
                    <path
                      key={activity.run_id}
                      d={path}
                      data-run={String(activity.run_id)}
                      className="city-route-hit"
                      vectorEffect="non-scaling-stroke"
                      aria-hidden="true"
                      onPointerEnter={(e) => {
                        if (e.pointerType === 'mouse' && !drag.current)
                          setHoveredRun(String(activity.run_id));
                      }}
                      onPointerLeave={() => setHoveredRun(null)}
                    />
                  ))}
                </>
              )}
            </g>
          </svg>
          {city && scale && (
            <div className="city-map-reference" aria-hidden="true">
              <span>↑ 北</span>
              <span className="city-scale" style={{ width: scale.width }}>
                {scale.label}
              </span>
            </div>
          )}
          {city && !cityLayer.routes.length && (
            <p className="city-map-empty" role="status">
              这座城市的活动没有可绘制的 GPS 路线。
            </p>
          )}
          <div className="footprint-map-tools">
            <button
              type="button"
              aria-label="放大足迹地图"
              onClick={() => zoom(1.25)}
            >
              ＋
            </button>
            <button
              type="button"
              aria-label="缩小足迹地图"
              onClick={() => zoom(0.8)}
            >
              −
            </button>
            <button
              type="button"
              aria-label="复位足迹地图"
              onClick={() => saveCamera(overview)}
            >
              ⌖
            </button>
          </div>
          <div className="footprint-map-status">
            <strong>{city ? cityLayer.routes.length : ranked.length}</strong>
            <span>
              {city
                ? `${city} · GPS 路线`
                : `已点亮${area === 'china' ? '省级区域' : '国家 / 地区'}`}
            </span>
            <small>
              {hovered
                ? `${formatDate(hovered.activity)} · ${formatNumber(hovered.activity.distance / 1000, 2)} km`
                : `${scope} · ${camera.zoom.toFixed(1)}×`}
            </small>
          </div>
        </div>
        <div className="atlas-note">
          {city
            ? '点击路线查看这次跑步。重合的路线可按日期从活动列表打开。'
            : '点选区域聚焦，选择城市查看当地的 GPS 路线。点亮范围依据活动记录的地点。'}
        </div>
      </section>
      <aside
        className="archive-panel footprint-details"
        aria-label="已点亮区域与活动"
      >
        <div className="panel-heading">
          <h2>
            {activeRegion
              ? shortName(regionName(activeRegion))
              : '跑到过的地方'}
          </h2>
          {(activeRegion || city) && (
            <button
              type="button"
              className="text-action"
              onClick={() => choose('')}
            >
              查看全部
            </button>
          )}
        </div>
        <div className="footprint-region-list">
          {ranked.map((region) => (
            <button
              type="button"
              key={regionKey(region)}
              aria-pressed={selected === regionKey(region)}
              onClick={() => choose(regionKey(region))}
            >
              <span>{shortName(regionName(region))}</span>
              <strong>
                {grouped.get(regionKey(region))!.length}
                <small> 次</small>
              </strong>
            </button>
          ))}
        </div>
        {!!cityCounts.size && (
          <div className="footprint-cities" aria-label="城市筛选">
            {[...cityCounts]
              .sort((a, b) => b[1] - a[1])
              .map(([name, count]) => (
                <button
                  type="button"
                  key={name}
                  aria-pressed={city === name}
                  onClick={() => {
                    openCity(city === name ? '' : name);
                    if (window.matchMedia('(max-width: 900px)').matches)
                      surface.current?.scrollIntoView({ block: 'start' });
                  }}
                >
                  {name}
                  <span>{count}</span>
                </button>
              ))}
          </div>
        )}
        <div className="footprint-activities-heading">
          <h3>
            {city ||
              (activeRegion ? shortName(regionName(activeRegion)) : '全部地点')}
            的活动
          </h3>
          <span>{scoped.length} 次</span>
        </div>
        <div className="footprint-activities">
          {scoped
            .slice((currentPage - 1) * 6, currentPage * 6)
            .map(({ activity, city: location }) => (
              <Link
                key={activity.run_id}
                to={`/map?year=${activity.start_date_local.slice(0, 4)}&run=${activity.run_id}`}
                state={returnState}
                onPointerEnter={(e) => {
                  if (e.pointerType === 'mouse')
                    setHoveredRun(String(activity.run_id));
                }}
                onPointerLeave={() => setHoveredRun(null)}
                onFocus={() => setHoveredRun(String(activity.run_id))}
                onBlur={() => setHoveredRun(null)}
              >
                <span>
                  <time>{formatDate(activity)}</time>
                  <small>{location || '未记录城市'}</small>
                </span>
                <strong>
                  {formatNumber(activity.distance / 1000, 2)}
                  <small> km ↗</small>
                </strong>
              </Link>
            ))}
        </div>
        {!scoped.length && (
          <p className="workspace-empty">这个区域暂时没有跑步记录。</p>
        )}
        <div className="footprint-pagination">
          <button
            type="button"
            aria-label="上一页足迹活动"
            disabled={currentPage <= 1}
            onClick={() => write({ fpPage: String(currentPage - 1) })}
          >
            ←
          </button>
          <span>
            {currentPage} / {maxPage}
          </span>
          <button
            type="button"
            aria-label="下一页足迹活动"
            disabled={currentPage >= maxPage}
            onClick={() => write({ fpPage: String(currentPage + 1) })}
          >
            →
          </button>
        </div>
        {unknown > 0 && (
          <p className="footprint-unlocated">
            {unknown} 次活动无法定位到
            {area === 'china' ? '国内省级区域' : '国家 / 地区'}
            ，保留在活动统计中。
          </p>
        )}
      </aside>
    </div>
  );
}
