import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import type { Activity } from '@/utils/utils';
import { decodeRoute } from '@/components/RunScan';
import useRouteElevation from '@/hooks/useRouteElevation';
import { useThemeChangeCounter } from '@/hooks/useTheme';
import {
  clamp,
  drawSurface,
  initialCamera,
  makeSurface,
  readGrid,
} from './terrain';
import type { Camera, Surface } from './terrain';
import './terrain.css';

type Props = { activity: Activity; onExit: () => void };
type Load = {
  id: string;
  grid?: ReturnType<typeof readGrid>;
  failed?: boolean;
};
const limits = { minZoom: 0.65, maxZoom: 2.8, lowPitch: 0.22, highPitch: 1.48 };
const attribution =
  'https://github.com/tilezen/joerd/blob/master/docs/attribution.md';

export default function TerrainSample({ activity, onExit }: Props) {
  const id = String(activity.run_id);
  const [load, setLoad] = useState<Load>({ id });
  const [attempt, retry] = useState(0);
  const { profile } = useRouteElevation(activity);
  useEffect(() => {
    const request = new AbortController();
    setLoad({ id });
    const timer = window.setTimeout(() => request.abort(), 12000);
    let active = true;
    (async () => {
      try {
        const response = await fetch(
          `${import.meta.env.BASE_URL}terrain-sample/terrain.json`,
          { signal: request.signal, cache: attempt ? 'reload' : 'default' }
        );
        if (!response.ok) throw new Error('Terrain request failed');
        const grid = readGrid(await response.json(), id);
        if (active) setLoad({ id, grid });
      } catch {
        if (active) setLoad({ id, failed: true });
      } finally {
        window.clearTimeout(timer);
      }
    })();
    return () => {
      active = false;
      window.clearTimeout(timer);
      request.abort();
    };
  }, [id, attempt]);

  const grid = load.id === id ? load.grid : undefined;
  const surface = useMemo(() => {
    if (!grid) return undefined;
    try {
      const points: [number, number][] = profile
        ? profile.samples.map((p) => [p[1], p[2]])
        : decodeRoute(activity);
      return makeSurface(grid, points);
    } catch {
      return undefined;
    }
  }, [grid, profile, activity]);
  const failed = load.id === id && (load.failed || (grid && !surface));
  return (
    <section className="terrain-sample" aria-label="样例真实地形">
      {surface && !failed ? (
        <TerrainView
          key={id}
          surface={surface}
          gpxRange={
            profile
              ? `${profile.rawMin.toFixed(1)}–${profile.rawMax.toFixed(1)} m`
              : '—'
          }
          onExit={onExit}
        />
      ) : (
        <div className="terrain-notice">
          <p role="status">
            {failed ? '这次跑步的地形暂时无法显示。' : '正在读取当地地形…'}
          </p>
          <div>
            {failed && (
              <button type="button" onClick={() => retry((n) => n + 1)}>
                重试地形
              </button>
            )}
            <button type="button" onClick={onExit}>
              返回立体轨迹
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function TerrainView({
  surface,
  gpxRange,
  onExit,
}: {
  surface: Surface;
  gpxRange: string;
  onExit: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const [camera, setCamera] = useState<Camera>(initialCamera);
  const [unavailable, setUnavailable] = useState(false);
  const themeRevision = useThemeChangeCounter();
  const frame = useRef(0);
  const drawing = useRef({ surface, camera });
  drawing.current = { surface, camera };
  const redraw = useCallback(() => {
    if (frame.current) return;
    frame.current = window.requestAnimationFrame(() => {
      frame.current = 0;
      const el = canvas.current;
      if (!el) return;
      const context = el.getContext('2d');
      if (!context) {
        setUnavailable(true);
        return;
      }
      const width = el.clientWidth,
        height = el.clientHeight;
      if (!width || !height) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 1.75);
      const pxWidth = Math.round(width * ratio),
        pxHeight = Math.round(height * ratio);
      if (el.width !== pxWidth || el.height !== pxHeight) {
        el.width = pxWidth;
        el.height = pxHeight;
      }
      context.setTransform(pxWidth / width, 0, 0, pxHeight / height, 0, 0);
      const scene = drawing.current;
      drawSurface(
        context,
        scene.surface,
        width,
        height,
        scene.camera,
        document.documentElement.dataset.theme === 'light'
      );
    });
  }, []);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const observer = new ResizeObserver(redraw);
    observer.observe(el);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [redraw]);
  useEffect(redraw, [redraw, camera, surface, themeRevision]);
  const orbit = (yaw: number, pitch = 0) =>
    setCamera((c) => ({
      ...c,
      yaw: c.yaw + yaw,
      pitch: clamp(c.pitch + pitch, limits.lowPitch, limits.highPitch),
    }));
  const zoom = (factor: number) =>
    setCamera((c) => ({
      ...c,
      zoom: clamp(c.zoom * factor, limits.minZoom, limits.maxZoom),
    }));
  const reset = () => setCamera(initialCamera);
  const keyDown = (event: KeyboardEvent<HTMLCanvasElement>) => {
    switch (event.key) {
      case 'ArrowLeft':
        orbit(-0.18);
        break;
      case 'ArrowRight':
        orbit(0.18);
        break;
      case 'ArrowUp':
        orbit(0, 0.12);
        break;
      case 'ArrowDown':
        orbit(0, -0.12);
        break;
      case '+':
      case '=':
        zoom(1.22);
        break;
      case '-':
        zoom(1 / 1.22);
        break;
      case 'Home':
        reset();
        break;
      default:
        return;
    }
    event.preventDefault();
  };
  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 || pointers.current.size >= 2) return;
    e.currentTarget.focus({ preventScroll: true });
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    const points = pointers.current,
      last = points.get(e.pointerId);
    if (!last) return;
    const x = e.clientX,
      y = e.clientY;
    if (points.size === 2) {
      const other = [...points.entries()].find(
        ([id]) => id !== e.pointerId
      )![1];
      const before = Math.hypot(last.x - other.x, last.y - other.y),
        after = Math.hypot(x - other.x, y - other.y);
      if (before > 5 && after > 5) zoom(after / before);
    } else orbit((x - last.x) * 0.009, (y - last.y) * 0.008);
    points.set(e.pointerId, { x, y });
  };
  const end = (e: PointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(e.pointerId);
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  };
  if (unavailable)
    return (
      <div className="terrain-notice">
        <p role="status">浏览器暂时无法绘制地形。</p>
        <button type="button" onClick={onExit}>
          返回立体轨迹
        </button>
      </div>
    );
  return (
    <>
      <dl className="terrain-readout">
        <div>
          <dt>区域地表高程</dt>
          <dd>
            {Math.floor(surface.low)}–{Math.ceil(surface.high)} m
          </dd>
        </div>
        <div>
          <dt>沿途 GPX 海拔</dt>
          <dd>{gpxRange}</dd>
        </div>
        <div>
          <dt>高度比例</dt>
          <dd>1×</dd>
        </div>
      </dl>
      <div className="terrain-stage">
        <canvas
          ref={canvas}
          tabIndex={0}
          role="img"
          aria-label="三维地形与跑步路线。拖动旋转，双指缩放；方向键调整视角，加减号缩放，Home 复位。"
          data-yaw={camera.yaw.toFixed(3)}
          data-pitch={camera.pitch.toFixed(3)}
          data-zoom={camera.zoom.toFixed(3)}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onLostPointerCapture={(e) => pointers.current.delete(e.pointerId)}
          onKeyDown={keyDown}
        />
      </div>
      <div className="terrain-controls">
        <span className="terrain-hint">拖动旋转 · 双指缩放</span>
        <div role="group" aria-label="地形视角">
          <button
            type="button"
            aria-label="向左旋转地形"
            title="向左旋转"
            onClick={() => orbit(-Math.PI / 8)}
          >
            ↶
          </button>
          <button
            type="button"
            aria-label="向右旋转地形"
            title="向右旋转"
            onClick={() => orbit(Math.PI / 8)}
          >
            ↷
          </button>
          <button
            type="button"
            aria-label="缩小地形"
            disabled={camera.zoom <= limits.minZoom}
            onClick={() => zoom(1 / 1.22)}
          >
            −
          </button>
          <button
            type="button"
            aria-label="放大地形"
            disabled={camera.zoom >= limits.maxZoom}
            onClick={() => zoom(1.22)}
          >
            ＋
          </button>
          <button
            type="button"
            aria-label="复位地形"
            className="terrain-reset"
            onClick={reset}
          >
            复位
          </button>
        </div>
      </div>
      <div className="terrain-credit">
        <span>等高距 {surface.interval} m</span>
        <a href={attribution} target="_blank" rel="noreferrer">
          地形来源 · Mapzen / USGS 等 ↗
        </a>
      </div>
    </>
  );
}
