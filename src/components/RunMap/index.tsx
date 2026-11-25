import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import Map, { Layer, Marker, Source, type MapRef } from 'react-map-gl';
import type { FeatureCollection } from 'geojson';
import type { RPGeometry } from '@/static/run_countries';
import {
  type Coordinate,
  type IViewState,
  getMapStyle,
  isTouchDevice,
} from '@/utils/utils';
import {
  MAPBOX_TOKEN,
  MAP_HEIGHT,
  MAP_TILE_ACCESS_TOKEN,
  MAP_TILE_VENDOR,
} from '@/utils/const';
import { RouteAnimator } from '@/utils/routeAnimation';
import { useMapTheme, useThemeChangeCounter } from '@/hooks/useTheme';
import RunMapButtons from './RunMapButtons';
import './mapbox.css';
import styles from './style.module.css';

interface IRunMapProps {
  title: string;
  viewState: IViewState;
  setViewState: (viewState: IViewState) => void;
  changeYear: (year: string) => void;
  geoData: FeatureCollection<RPGeometry>;
  thisYear: string;
  animationTrigger?: number;
  height?: number | string;
  showYearButtons?: boolean;
  defaultLights?: boolean;
  onReset?: () => void;
}

// A device without a WebGL context can still use the Canvas point-cloud view.
class MapDeviceBoundary extends Component<
  PropsWithChildren,
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <div className={styles.deviceError} role="status">
          <strong>这个浏览器暂时无法打开地理地图</strong>
          <p>
            切换上方的“立体轨迹”仍可旋转、缩放并查看跑步记录。也可以尝试更新浏览器后重试。
          </p>
        </div>
      );
    return this.props.children;
  }
}

function cameraDuration() {
  return matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 0
    : parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(
          '--motion-camera'
        )
      );
}

function GeographicMap({
  title,
  viewState,
  setViewState,
  changeYear,
  geoData,
  thisYear,
  animationTrigger,
  height = MAP_HEIGHT,
  showYearButtons = true,
  defaultLights = true,
  onReset,
}: IRunMapProps) {
  const mapRef = useRef<MapRef>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const loadTimer = useRef<number | undefined>(undefined);
  const animatorRef = useRef<RouteAnimator | null>(null);
  const theme = useMapTheme();
  const themeCounter = useThemeChangeCounter();
  const [lights, setLights] = useState(defaultLights);
  const [offline, setOffline] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [animatedPoints, setAnimatedPoints] = useState<Coordinate[]>([]);
  const isLight = document.documentElement.dataset.theme === 'light';
  const accent = isLight ? '#52671a' : '#d1e66c';
  const baseStyle = useMemo(
    () => getMapStyle(MAP_TILE_VENDOR, theme, MAP_TILE_ACCESS_TOKEN),
    [theme]
  );
  const plainStyle = useMemo(
    () => ({
      version: 8 as const,
      sources: {},
      layers: [
        {
          id: 'archive-background',
          type: 'background' as const,
          paint: {
            'background-color': isLight ? '#e9ecdf' : '#11160e',
            'background-opacity': 0.87,
          },
        },
      ],
    }),
    [isLight, themeCounter]
  );
  const mapStyle = !lights || offline ? plainStyle : baseStyle;
  const points = useMemo(() => {
    const validFeatures = geoData.features.filter(
      (feature) =>
        feature.geometry.type === 'LineString' &&
        feature.geometry.coordinates.length > 1
    );
    const feature =
      validFeatures.find((feature) => feature.properties?.selected === true) ||
      validFeatures[0];
    return feature ? (feature.geometry.coordinates as Coordinate[]) : [];
  }, [geoData]);
  const single =
    geoData.features.length === 1 ||
    geoData.features.some((feature) => feature.properties?.selected === true);

  useEffect(() => {
    setPlaying(false);
    setAnimatedPoints([]);
    animatorRef.current?.stop();
    return () => animatorRef.current?.stop();
  }, [points]);

  useEffect(() => {
    const stopPlayback = () => {
      animatorRef.current?.stop();
      setPlaying(false);
    };
    const onVisibility = () => {
      if (document.hidden) stopPlayback();
    };
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onPreference = () => {
      if (preference.matches) stopPlayback();
    };
    window.addEventListener('blur', stopPlayback);
    document.addEventListener('visibilitychange', onVisibility);
    preference.addEventListener('change', onPreference);
    return () => {
      window.removeEventListener('blur', stopPlayback);
      document.removeEventListener('visibilitychange', onVisibility);
      preference.removeEventListener('change', onPreference);
      animatorRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    if (!lights || offline) return;
    setReady(false);
    loadTimer.current = window.setTimeout(() => {
      setOffline(true);
      setLoadError(true);
    }, 10000);
    return () => window.clearTimeout(loadTimer.current);
  }, [attempt, lights, offline, baseStyle]);

  const play = useCallback(() => {
    animatorRef.current?.stop();
    if (playing) {
      setPlaying(false);
      setAnimatedPoints([]);
      return;
    }
    if (points.length < 2 || !single) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setAnimatedPoints(points);
      return;
    }
    setPlaying(true);
    animatorRef.current = new RouteAnimator(points, setAnimatedPoints, () =>
      setPlaying(false)
    );
    animatorRef.current.start();
  }, [points, playing, single]);

  useEffect(() => {
    if (animationTrigger && single) play();
  }, [animationTrigger]);

  const retry = () => {
    setLoadError(false);
    setOffline(false);
    setLights(true);
    setReady(false);
    setAttempt((value) => value + 1);
  };
  const reset = () => {
    const map = mapRef.current?.getMap();
    map?.stop();
    // The parent owns the complete camera. Do not start an imperative animation
    // whose onMove events could overwrite that controlled reset.
    if (onReset) {
      onReset();
      return;
    }
    map?.resetNorthPitch({
      duration: cameraDuration(),
    });
  };
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void wrapperRef.current?.requestFullscreen();
  };

  return (
    <div ref={wrapperRef} className={styles.geoSurface} style={{ height }}>
      <Map
        key={attempt}
        {...viewState}
        ref={mapRef}
        style={{ width: '100%', height: '100%' }}
        mapStyle={mapStyle}
        mapboxAccessToken={MAPBOX_TOKEN}
        onMove={(event) => setViewState(event.viewState)}
        onLoad={() => {
          setReady(true);
          window.clearTimeout(loadTimer.current);
        }}
        onStyleData={() => {
          if (mapRef.current?.getMap().isStyleLoaded()) {
            setReady(true);
            window.clearTimeout(loadTimer.current);
          }
        }}
        onError={() => {
          if (!offline && lights) {
            window.clearTimeout(loadTimer.current);
            setOffline(true);
            setLoadError(true);
          }
        }}
        cooperativeGestures={isTouchDevice()}
        attributionControl={false}
      >
        <Source id="archive-route" type="geojson" data={geoData}>
          <Layer
            id="archive-route-glow"
            type="line"
            paint={{
              'line-color': accent,
              'line-width':
                geoData.features.length === 1
                  ? 7
                  : ['case', ['boolean', ['get', 'selected'], false], 7, 4],
              'line-blur': 4,
              'line-opacity':
                geoData.features.length === 1
                  ? 0.18
                  : [
                      'case',
                      ['boolean', ['get', 'selected'], false],
                      0.18,
                      0.035,
                    ],
            }}
            layout={{ 'line-join': 'round', 'line-cap': 'round' }}
          />
          <Layer
            id="archive-route-line"
            type="line"
            paint={{
              'line-color': accent,
              'line-width':
                geoData.features.length === 1
                  ? 2.5
                  : ['case', ['boolean', ['get', 'selected'], false], 2.8, 1.2],
              'line-opacity':
                geoData.features.length === 1
                  ? 1
                  : ['case', ['boolean', ['get', 'selected'], false], 1, 0.28],
            }}
            layout={{ 'line-join': 'round', 'line-cap': 'round' }}
          />
        </Source>
        {animatedPoints.length > 1 && (
          <Source
            id="archive-playback"
            type="geojson"
            data={{
              type: 'FeatureCollection',
              features: [
                {
                  type: 'Feature',
                  properties: {},
                  geometry: { type: 'LineString', coordinates: animatedPoints },
                },
              ],
            }}
          >
            <Layer
              id="archive-playback-line"
              type="line"
              paint={{
                'line-color': isLight ? '#1c3b22' : '#f7ffe4',
                'line-width': 4,
              }}
              layout={{ 'line-join': 'round', 'line-cap': 'round' }}
            />
          </Source>
        )}
        {single && points.length > 1 && (
          <>
            <Marker
              longitude={points[0][0]}
              latitude={points[0][1]}
              anchor="center"
            >
              <span className={styles.startMarker} aria-label="轨迹起点">
                起
              </span>
            </Marker>
            <Marker
              longitude={points[points.length - 1][0]}
              latitude={points[points.length - 1][1]}
              anchor="center"
            >
              <span className={styles.endMarker} aria-label="轨迹终点">
                终
              </span>
            </Marker>
          </>
        )}
        {playing && animatedPoints.length > 0 && (
          <Marker
            longitude={animatedPoints[animatedPoints.length - 1][0]}
            latitude={animatedPoints[animatedPoints.length - 1][1]}
            anchor="center"
          >
            <span className={styles.playbackMarker} />
          </Marker>
        )}
      </Map>
      {showYearButtons && (
        <RunMapButtons thisYear={thisYear} changeYear={changeYear} />
      )}
      <div className={styles.mapStatus} role="status">
        {!ready && !offline && lights
          ? '地理底图加载中…'
          : !lights || offline
            ? '纯轨迹视图'
            : '地理底图'}
        <span>{title}</span>
      </div>
      <div className={styles.mapTools} aria-label="地理地图工具">
        <button
          type="button"
          aria-label="放大地图"
          title="放大地图"
          onClick={() =>
            mapRef.current?.getMap().zoomIn({ duration: cameraDuration() })
          }
        >
          ＋
        </button>
        <button
          type="button"
          aria-label="缩小地图"
          title="缩小地图"
          onClick={() =>
            mapRef.current?.getMap().zoomOut({ duration: cameraDuration() })
          }
        >
          −
        </button>
        <button
          type="button"
          aria-label="复位地理地图"
          title="复位地理地图"
          onClick={reset}
        >
          ⌖
        </button>
        <button
          type="button"
          aria-label="切换地图全屏"
          title="切换地图全屏"
          onClick={toggleFullscreen}
        >
          ⛶
        </button>
      </div>
      <div className={styles.mapBottomTools}>
        <button
          type="button"
          aria-pressed={lights && !offline}
          onClick={() => {
            if (offline) {
              retry();
            } else setLights((value) => !value);
          }}
        >
          {lights && !offline ? '隐藏底图' : '显示地理底图'}
        </button>
        {single && (
          <button
            type="button"
            aria-label={playing ? '停止地图轨迹回放' : '回放地图轨迹'}
            onClick={play}
          >
            {playing ? '停止回放' : '▶ 轨迹回放'}
          </button>
        )}
      </div>
      {loadError && (
        <div className={styles.baseMapNotice} role="status">
          <span>在线底图暂未加载，GPS 轨迹仍可拖动、缩放和回放。</span>
          <button type="button" onClick={retry}>
            重试底图
          </button>
        </div>
      )}
      <div className={styles.mapAttribution}>
        <a
          href="https://www.mapbox.com/about/maps/"
          target="_blank"
          rel="noreferrer"
        >
          © Mapbox
        </a>
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
        >
          © OpenStreetMap
        </a>
      </div>
    </div>
  );
}

export default function RunMap(props: IRunMapProps) {
  return (
    <MapDeviceBoundary>
      <GeographicMap {...props} />
    </MapDeviceBoundary>
  );
}
