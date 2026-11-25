import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import * as polyline from '@mapbox/polyline';
import type { Activity } from '@/utils/utils';
import { useThemeChangeCounter } from '@/hooks/useTheme';
import useRouteElevation, {
  type RouteElevationState,
} from '@/hooks/useRouteElevation';
import {
  gpsDistances,
  pickRoute,
  routePosition,
  type RouteVertex,
} from './replayGeometry';
import './scene-cursor.css';

type Point = [number, number];
type Vertex = { x: number; y: number; z: number; tone: number };
type Camera = { yaw: number; pitch: number; zoom: number };
const INITIAL_CAMERA: Camera = { yaw: -0.35, pitch: 0.68, zoom: 1 };
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export function decodeRoute(activity?: Activity): Point[] {
  if (!activity?.summary_polyline) return [];
  try {
    const points = polyline
      .decode(activity.summary_polyline)
      .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
    if (
      points.length < 2 ||
      !points.some(
        (point) =>
          Math.abs(point[0] - points[0][0]) > 1e-7 ||
          Math.abs(point[1] - points[0][1]) > 1e-7
      )
    )
      return [];
    return points;
  } catch {
    return [];
  }
}
function normalize(points: Point[]): Point[] {
  if (points.length < 2) return [];
  const cos = Math.cos(
    ((points.reduce((s, p) => s + p[0], 0) / points.length) * Math.PI) / 180
  );
  const xs = points.map((p) => p[1] * cos),
    ys = points.map((p) => -p[0]);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minY = Math.min(...ys),
    maxY = Math.max(...ys);
  const scale = Math.max(maxX - minX, maxY - minY);
  if (scale < 1e-8) return [];
  return xs.map((x, i) => [
    (x - (minX + maxX) / 2) / (scale / 2),
    (ys[i] - (minY + maxY) / 2) / (scale / 2),
  ]);
}
export function RouteMini({ activity }: { activity: Activity }) {
  const points = useMemo(() => normalize(decodeRoute(activity)), [activity]);
  if (!points.length) return <span className="route-unavailable">无轨迹</span>;
  const step = Math.max(1, Math.ceil(points.length / 160));
  return (
    <svg width="60" height="34" viewBox="0 0 60 34" aria-hidden="true">
      <polyline
        points={points
          .filter((_, i) => i % step === 0 || i === points.length - 1)
          .map(([x, y]) => `${30 + x * 25},${17 + y * 13}`)
          .join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  );
}
function segmentDistance(x: number, y: number, a: Point, b: Point) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    length = dx * dx + dy * dy;
  const t = length
    ? clamp(((x - a[0]) * dx + (y - a[1]) * dy) / length, 0, 1)
    : 0;
  return (x - a[0] - t * dx) ** 2 + (y - a[1] - t * dy) ** 2;
}

// A real three-dimensional scene rendered without a continuous animation loop.
// Meter-based GPS geometry and recorded GPX elevation use the same scale.
// Surrounding dots stay on a flat reference plane: a route cannot define terrain.
export default function RunScan({
  activity,
  elevation,
  compact = false,
  cursor: controlledCursor,
  smoothed: controlledSmoothed,
  onSmoothedChange,
  onPositionSelect,
  onReplayPosition,
  chartSeek,
}: {
  activity?: Activity;
  elevation?: RouteElevationState;
  compact?: boolean;
  cursor?: number | null;
  smoothed?: boolean;
  onSmoothedChange?: (value: boolean) => void;
  onPositionSelect?: (ratio: number) => void;
  onReplayPosition?: (ratio: number | null) => void;
  chartSeek?: { position: number | null };
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [camera, setCamera] = useState<Camera>(INITIAL_CAMERA);
  const [progress, setProgress] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [following, setFollowing] = useState(false);
  const [localCursor, setLocalCursor] = useState<number | null>(null);
  const cursor =
    controlledCursor === undefined ? localCursor : controlledCursor;
  const reportReplay = useRef(onReplayPosition);
  reportReplay.current = onReplayPosition;
  const projected = useRef<{ route: RouteVertex[]; screen: Point[] } | null>(
    null
  );
  const markLabels = useRef(new Map<number, HTMLSpanElement>());
  const tap = useRef<{ id: number; x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [view, setView] = useState<'perspective' | 'top'>('perspective');
  const localElevation = useRouteElevation(elevation ? undefined : activity);
  const { profile, status } = elevation ?? localElevation;
  const [heightScale, setHeightScale] = useState(1);
  const [localSmoothed, setLocalSmoothed] = useState(true);
  const smoothed = controlledSmoothed ?? localSmoothed;
  const themeCounter = useThemeChangeCounter();
  const drawRef = useRef<() => void>(() => {});
  const frameRef = useRef<number | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{
    point: Point;
    distance: number;
    camera: Camera;
  } | null>(null);
  const geometry = useMemo(() => {
    const points: Point[] = profile
      ? profile.samples.map((p) => [p[1], p[2]])
      : decodeRoute(activity);
    const normalized = normalize(points);
    const cos = Math.cos(
      ((points.reduce((s, p) => s + p[0], 0) / (points.length || 1)) *
        Math.PI) /
        180
    );
    const xs = points.map((p) => p[1] * cos * 111195.08);
    const ys = points.map((p) => p[0] * 111195.08);
    const span = Math.max(
      Math.max(...xs) - Math.min(...xs),
      Math.max(...ys) - Math.min(...ys),
      1
    );
    const altitudes = profile?.samples.map((p) => p[smoothed ? 4 : 3]) || [];
    const minElevation = altitudes.length ? Math.min(...altitudes) : 0;
    const maxElevation = altitudes.length ? Math.max(...altitudes) : 0;
    const routeStep = profile
      ? 1
      : Math.max(1, Math.ceil(normalized.length / 1800));
    const distances = profile
      ? profile.samples.map((sample) => sample[0])
      : gpsDistances(points);
    const route = normalized
      .map(([x, y], i) => ({
        x,
        y,
        z: ((((altitudes[i] ?? 0) - minElevation) * 2) / span) * heightScale,
        altitude: altitudes[i],
        distance: distances[i],
      }))
      .filter((_, i) => i % routeStep === 0 || i === normalized.length - 1);
    const sampleStep = Math.max(1, Math.ceil(normalized.length / 110));
    const samples = normalized.filter(
      (_, i) => i % sampleStep === 0 || i === normalized.length - 1
    );
    const terrain: Vertex[][] = Array.from({ length: 12 }, () => []);
    for (let row = 0; row < 82; row++)
      for (let col = 0; col < 126; col++) {
        const x = -1.55 + (col * 3.1) / 125,
          y = -1.35 + (row * 2.7) / 81;
        const random = Math.sin(col * 127.1 + row * 311.7) * 43758.5453;
        if (random - Math.floor(random) < 0.08) continue;
        let distance = 4;
        for (let i = 1; i < samples.length; i++)
          distance = Math.min(
            distance,
            segmentDistance(x, y, samples[i - 1], samples[i])
          );
        const edge = Math.max(0, 1 - (x * x) / 4 - (y * y) / 3);
        const strength = clamp(
          edge * (0.13 + Math.exp(-distance * 16) * 0.6),
          0,
          1
        );
        const tone = clamp(Math.round(strength * 12), 0, 11);
        terrain[tone].push({
          x,
          y,
          z: 0,
          tone,
        });
      }
    return { terrain, route, minElevation, maxElevation, span };
  }, [activity, profile, smoothed, heightScale]);
  const totalMeters = geometry.route.at(-1)?.distance || 0;
  const milestones = useMemo(() => {
    if (!totalMeters) return [];
    const stops = Array.from(
      { length: Math.max(0, Math.ceil(totalMeters / 1000) - 1) },
      (_, i) => (i + 1) * 1000
    );
    return [0, ...stops, totalMeters];
  }, [totalMeters]);
  const visibleMarks = useMemo(() => {
    const interior = milestones.slice(1, -1);
    const stride = Math.max(1, Math.ceil(interior.length / 4));
    return interior
      .filter((_, i) => i % stride === 0)
      .map((meters) => ({
        meters,
        point: routePosition(geometry.route, meters / totalMeters)!,
      }));
  }, [geometry.route, milestones, totalMeters]);
  const cursorPoint = useMemo(
    () => (cursor === null ? null : routePosition(geometry.route, cursor)),
    [cursor, geometry.route]
  );
  const runner = useMemo(
    () => routePosition(geometry.route, progress),
    [geometry.route, progress]
  );
  const sceneRef = useRef({
    geometry,
    visibleMarks,
    camera,
    progress,
    cursorPoint,
    runner,
    following,
    playing,
  });
  sceneRef.current = {
    geometry,
    visibleMarks,
    camera,
    progress,
    cursorPoint,
    runner,
    following,
    playing,
  };
  const requestDraw = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      drawRef.current();
    });
  }, []);
  useEffect(() => {
    setPlaying(false);
    setFollowing(false);
    setLocalCursor(null);
    setProgress(1);
    setCamera(INITIAL_CAMERA);
    setView('perspective');
    setHeightScale(1);
    pointers.current.clear();
    tap.current = null;
    gesture.current = null;
    setDragging(false);
  }, [activity]);
  useEffect(() => {
    if (!chartSeek) return;
    setPlaying(false);
    setFollowing(false);
    setProgress(chartSeek.position ?? 1);
  }, [chartSeek]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let width = 0,
      height = 0;
    const render = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx || !width || !height) return;
      const {
        geometry,
        visibleMarks,
        camera: cam,
        progress: currentProgress,
        cursorPoint,
        runner: currentRunner,
        following: follow,
        playing: inPlayback,
      } = sceneRef.current;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const light = document.documentElement.dataset.theme === 'light';
      const narrow = width < 480;
      const size =
        Math.min(width * (narrow ? 0.31 : 0.255), height * 0.48) *
        cam.zoom *
        (follow ? 1.75 : 1);
      const cos = Math.cos(cam.yaw),
        sin = Math.sin(cam.yaw),
        cp = Math.cos(cam.pitch),
        sp = Math.sin(cam.pitch);
      const project = (x: number, y: number, z = 0): Point => {
        if (follow && currentRunner) {
          x -= currentRunner.x;
          y -= currentRunner.y;
          z -= currentRunner.z;
        }
        const rx = x * cos - y * sin,
          ry = x * sin + y * cos;
        const depth = ry * cp + z * sp,
          perspective = 4.5 / (4.5 + depth * 0.3);
        return [
          width * 0.5 + rx * size * perspective,
          height * 0.56 + (ry * sp - z * cp) * size * perspective,
        ];
      };
      // A true metric scale bar uses the same projection as the route, with no
      // independent vertical normalization that would turn a few meters into hills.
      const scaleMeters =
        geometry.span > 2000 ? 500 : geometry.span > 700 ? 200 : 50;
      const barWidth = ((scaleMeters * 2) / geometry.span) * size;
      if (geometry.route.length && barWidth < width * 0.5) {
        ctx.strokeStyle = light ? '#52671a' : '#b4c77d';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(24, 35);
        ctx.lineTo(24 + barWidth, 35);
        ctx.stroke();
        ctx.fillStyle = light ? '#52671a' : '#b4c77d';
        ctx.font = '11px sans-serif';
        ctx.fillText(`${scaleMeters} m · 水平比例`, 24, 25);
      }
      ctx.strokeStyle = light ? '#7082422e' : '#a9b98b1c';
      ctx.lineWidth = 0.6;
      for (let n = -1.6; n <= 1.61; n += 0.16)
        for (const axis of [0, 1]) {
          const a = axis ? project(n, -1.4) : project(-1.6, n),
            b = axis ? project(n, 1.4) : project(1.6, n);
          ctx.beginPath();
          ctx.moveTo(...a);
          ctx.lineTo(...b);
          ctx.stroke();
        }
      for (let tone = 1; tone < 12; tone++) {
        ctx.fillStyle = light
          ? `rgba(66,92,28,${0.05 + tone * 0.028})`
          : `rgba(174,191,131,${0.05 + tone * 0.035})`;
        for (const p of geometry.terrain[tone]) {
          const [x, y] = project(p.x, p.y, p.z);
          ctx.fillRect(x, y, tone > 9 ? 1.25 : 1, 1);
        }
      }
      const route = geometry.route;
      const screen = route.map((p) => project(p.x, p.y, p.z));
      projected.current = { route, screen };
      const landmarks: Point[] = [];
      if (currentRunner) {
        const path = (end: number, tip?: Point) => {
          ctx.beginPath();
          for (let i = 0; i < end; i++) {
            const q = screen[i];
            if (!i) ctx.moveTo(...q);
            else ctx.lineTo(...q);
          }
          if (tip) ctx.lineTo(...tip);
          ctx.stroke();
        };
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        if (currentProgress < 1) {
          ctx.strokeStyle = light ? '#52671a8c' : '#c3d98260';
          ctx.lineWidth = 1;
          ctx.setLineDash([1, 5]);
          path(route.length);
          ctx.setLineDash([]);
        }
        const tip = project(currentRunner.x, currentRunner.y, currentRunner.z);
        ctx.strokeStyle = light ? '#f0f1e9' : '#141a0f';
        ctx.lineWidth = narrow ? 4.6 : 4;
        path(currentRunner.left + 1, tip);
        ctx.strokeStyle = light ? '#435719' : '#dbea91';
        ctx.lineWidth = narrow ? 2.4 : 2;
        path(currentRunner.left + 1, tip);
        const first = route[0],
          last = currentRunner;
        const origin = screen[0];
        const nearbyEndpoints =
          Math.hypot(tip[0] - origin[0], tip[1] - origin[1]) < 55;
        const endIsLeft = tip[0] < origin[0];
        ctx.font = '600 11px "IBM Plex Sans", sans-serif';
        for (const [p, label] of [
          [first, '起点'],
          [last, currentProgress < 1 ? '跑者' : '终点'],
        ] as const) {
          const q = project(p.x, p.y, p.z);
          landmarks.push(q);
          ctx.fillStyle = light ? '#293e0b' : '#f4f9cf';
          ctx.beginPath();
          ctx.arc(...q, 3.5, 0, Math.PI * 2);
          ctx.fill();
          if (p === last && (follow || inPlayback)) {
            ctx.strokeStyle = light ? '#52671a' : '#dbea91';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(...q, 7, 0, Math.PI * 2);
            ctx.stroke();
          }
          const textWidth = ctx.measureText(label).width;
          const left = nearbyEndpoints && (p === last ? endIsLeft : !endIsLeft);
          const x = left ? q[0] - textWidth - 8 : q[0] + 8;
          const y = q[1] - 8;
          if (
            x >= 4 &&
            x + textWidth <= width - 4 &&
            y >= 12 &&
            y < height - 4
          ) {
            ctx.strokeStyle = light ? '#f0f1e9' : '#141a0f';
            ctx.lineWidth = 3;
            ctx.strokeText(label, x, y);
            ctx.fillText(label, x, y);
          }
        }
      }
      if (cursorPoint && !inPlayback) {
        const point = project(cursorPoint.x, cursorPoint.y, cursorPoint.z);
        landmarks.push(point);
        ctx.fillStyle = light ? '#52671a' : '#dbea91';
        ctx.strokeStyle = light ? '#f2f4ec' : '#151a0d';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(...point, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(...point, 10, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Keep dense loops legible. Every exact kilometre remains in the selector.
      const placed: Point[] = [];
      for (const { meters, point } of visibleMarks) {
        const label = markLabels.current.get(meters);
        if (!label) continue;
        const [x, y] = project(point.x, point.y, point.z);
        label.hidden =
          follow ||
          inPlayback ||
          placed.length >= (narrow ? 2 : 4) ||
          x < 5 ||
          x > width - 60 ||
          y < 50 ||
          y > height - 32 ||
          landmarks.some(
            ([px, py]) => Math.abs(px - x) < 47 && Math.abs(py - y) < 29
          ) ||
          placed.some(
            ([px, py]) => Math.abs(px - x) < 55 && Math.abs(py - y) < 22
          );
        if (!label.hidden) {
          label.style.transform = `translate(${x}px, ${y}px)`;
          placed.push([x, y]);
        }
      }
      ctx.strokeStyle = light ? '#74874788' : '#a9bd7288';
      ctx.lineWidth = 0.8;
      for (const [x, y] of [
        [16, 16],
        [width - 16, 16],
        [16, height - 16],
        [width - 16, height - 16],
      ]) {
        ctx.beginPath();
        ctx.moveTo(x - 4, y);
        ctx.lineTo(x + 4, y);
        ctx.moveTo(x, y - 4);
        ctx.lineTo(x, y + 4);
        ctx.stroke();
      }
    };
    drawRef.current = render;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      requestDraw();
    };
    const wheel = (event: WheelEvent) => {
      if (document.activeElement !== canvas && !event.ctrlKey) return;
      event.preventDefault();
      setCamera((c) => ({
        ...c,
        zoom: clamp(c.zoom * Math.exp(-event.deltaY * 0.0013), 0.55, 2.4),
      }));
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    canvas.addEventListener('wheel', wheel, { passive: false });
    resize();
    return () => {
      observer.disconnect();
      canvas.removeEventListener('wheel', wheel);
    };
  }, [requestDraw]);
  useEffect(
    () => requestDraw(),
    [
      geometry,
      themeCounter,
      camera,
      progress,
      cursorPoint,
      following,
      playing,
      requestDraw,
    ]
  );
  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    },
    []
  );
  useEffect(() => {
    const pause = () => {
      setPlaying(false);
      setDragging(false);
      gesture.current = null;
      tap.current = null;
      const canvas = canvasRef.current;
      for (const id of pointers.current.keys())
        if (canvas?.hasPointerCapture(id)) canvas.releasePointerCapture(id);
      pointers.current.clear();
    };
    const visibility = () => {
      if (document.hidden) pause();
    };
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const motion = () => {
      if (preference.matches) {
        setPlaying(false);
        setFollowing(false);
      }
    };
    window.addEventListener('blur', pause);
    document.addEventListener('visibilitychange', visibility);
    preference.addEventListener('change', motion);
    return () => {
      window.removeEventListener('blur', pause);
      document.removeEventListener('visibilitychange', visibility);
      preference.removeEventListener('change', motion);
    };
  }, []);
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let lastReport = -Infinity;
    const duration = following ? clamp(totalMeters * 2.2, 14000, 36000) : 8000;
    const started = performance.now() - sceneRef.current.progress * duration;
    const step = (time: number) => {
      const value = clamp((time - started) / duration, 0, 1);
      setProgress(value);
      if (time - lastReport >= 100 || value === 1) {
        reportReplay.current?.(value);
        lastReport = time;
      }
      if (value < 1) frame = requestAnimationFrame(step);
      else setPlaying(false);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      reportReplay.current?.(null);
    };
  }, [playing, activity, following, totalMeters]);
  // A paused follow view still frames a particular distance on the chart.
  useEffect(() => {
    if (!following || playing) return;
    reportReplay.current?.(progress);
    return () => reportReplay.current?.(null);
  }, [following, playing, progress]);
  const reset = () => {
    setFollowing(false);
    setPlaying(false);
    setCamera(INITIAL_CAMERA);
    setView('perspective');
  };
  const togglePlay = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (sceneRef.current.progress >= 0.999) {
      sceneRef.current.progress = 0;
      setProgress(0);
    }
    setPlaying(true);
  };
  const toggleFollow = () => {
    if (following) {
      setFollowing(false);
      return;
    }
    setFollowing(true);
    if (progress >= 1) {
      sceneRef.current.progress = 0;
      setProgress(0);
    }
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      setPlaying(true);
  };
  const selectPosition = (ratio: number, keepFollowing = false) => {
    setPlaying(false);
    if (!keepFollowing) setFollowing(false);
    setProgress(ratio);
    setLocalCursor(ratio);
    onPositionSelect?.(ratio);
  };
  const startGesture = () => {
    const list = [...pointers.current.values()];
    if (!list.length) {
      gesture.current = null;
      return;
    }
    gesture.current = {
      point: list[0],
      distance:
        list.length > 1
          ? Math.hypot(list[1][0] - list[0][0], list[1][1] - list[0][1])
          : 0,
      camera: sceneRef.current.camera,
    };
  };
  const down = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    tap.current = pointers.current.size
      ? null
      : { id: event.pointerId, x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, [event.clientX, event.clientY]);
    startGesture();
    setDragging(true);
  };
  const move = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!pointers.current.has(event.pointerId) || !gesture.current) return;
    if (tap.current) {
      if (
        Math.hypot(
          event.clientX - tap.current.x,
          event.clientY - tap.current.y
        ) < 5
      )
        return;
      tap.current = null;
    }
    pointers.current.set(event.pointerId, [event.clientX, event.clientY]);
    const list = [...pointers.current.values()],
      base = gesture.current;
    if (list.length > 1 && base.distance > 0) {
      const d = Math.hypot(list[1][0] - list[0][0], list[1][1] - list[0][1]);
      setCamera({
        ...base.camera,
        zoom: clamp((base.camera.zoom * d) / base.distance, 0.55, 2.4),
      });
    } else {
      setView('perspective');
      setCamera({
        ...base.camera,
        yaw: base.camera.yaw + (event.clientX - base.point[0]) * 0.007,
        pitch: clamp(
          base.camera.pitch + (event.clientY - base.point[1]) * 0.005,
          0.14,
          1.56
        ),
      });
    }
  };
  const up = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const candidate = tap.current;
    tap.current = null;
    if (
      event.type === 'pointerup' &&
      projected.current?.route === geometry.route &&
      candidate?.id === event.pointerId &&
      Math.hypot(candidate.x - event.clientX, candidate.y - event.clientY) < 5
    ) {
      const rect = event.currentTarget.getBoundingClientRect();
      let picked: number | null = null;
      for (const [meters, node] of markLabels.current) {
        if (node.hidden) continue;
        const box = node.getBoundingClientRect();
        if (
          event.clientX >= box.left - 3 &&
          event.clientX <= box.right + 3 &&
          event.clientY >= box.top - 3 &&
          event.clientY <= box.bottom + 3
        ) {
          picked = meters / totalMeters;
          break;
        }
      }
      picked ??= pickRoute(
        projected.current.screen,
        geometry.route,
        event.clientX - rect.left,
        event.clientY - rect.top,
        event.pointerType === 'mouse' ? 8 : 15,
        cursor ?? progress
      );
      if (picked !== null) selectPosition(picked);
    }
    pointers.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    startGesture();
    setDragging(pointers.current.size > 0);
  };
  const displayPoint = playing || following ? runner : cursorPoint;
  const hasRoute = geometry.route.length > 1;
  const playbackDistance = ((totalMeters * progress) / 1000).toFixed(2);
  const selectedStop =
    cursor === null
      ? undefined
      : milestones.find((m) => Math.abs(m - cursor * totalMeters) < 0.01);
  const key = (event: KeyboardEvent<HTMLCanvasElement>) => {
    if (
      ![
        'ArrowLeft',
        'ArrowRight',
        'ArrowUp',
        'ArrowDown',
        '+',
        '=',
        '-',
        'Home',
        ' ',
      ].includes(event.key)
    )
      return;
    event.preventDefault();
    if (event.key === 'Home') {
      reset();
      return;
    }
    if (event.key === ' ') {
      if (geometry.route.length) togglePlay();
      return;
    }
    setCamera((c) => ({
      ...c,
      yaw:
        c.yaw +
        (event.key === 'ArrowLeft'
          ? -0.12
          : event.key === 'ArrowRight'
            ? 0.12
            : 0),
      pitch: clamp(
        c.pitch +
          (event.key === 'ArrowUp'
            ? 0.08
            : event.key === 'ArrowDown'
              ? -0.08
              : 0),
        0.14,
        1.56
      ),
      zoom: clamp(
        c.zoom *
          (event.key === '+' || event.key === '='
            ? 1.12
            : event.key === '-'
              ? 1 / 1.12
              : 1),
        0.55,
        2.4
      ),
    }));
    setView('perspective');
  };
  return (
    <div
      className={`interactive-scan ${compact ? 'scan-compact' : ''}`}
      data-following={following}
      data-has-route={hasRoute}
    >
      {hasRoute && (
        <div
          className="scene-playback"
          role="group"
          aria-label="轨迹回放与定位"
        >
          <button
            type="button"
            className="scene-play"
            disabled={!geometry.route.length}
            aria-label={playing ? '暂停轨迹回放' : '播放轨迹回放'}
            aria-pressed={playing}
            onClick={togglePlay}
          >
            <span
              aria-hidden="true"
              className="motion-glyph"
              key={String(playing)}
            >
              {playing ? 'Ⅱ' : '▶'}
            </span>
            {playing ? '暂停' : '回放'}
          </button>
          <button
            className="scene-follow"
            type="button"
            aria-label="跟随跑者"
            aria-pressed={following}
            disabled={!totalMeters}
            onClick={toggleFollow}
          >
            {following ? '退出跟随' : '跟随跑者'}
          </button>
          {totalMeters > 0 && (
            <select
              className="scene-km-select"
              aria-label="选择路线里程"
              value={selectedStop ?? ''}
              onChange={(event) =>
                selectPosition(Number(event.target.value) / totalMeters)
              }
            >
              <option value="" disabled>
                里程定位
              </option>
              {milestones.map((m) => (
                <option key={m} value={m}>
                  {m === 0
                    ? '起点'
                    : m === totalMeters
                      ? '终点'
                      : `${m / 1000} km`}
                </option>
              ))}
            </select>
          )}
          <div className="scene-timeline">
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              aria-label="轨迹回放进度"
              aria-valuetext={`${playbackDistance} 公里，GPS 轨迹全长 ${(totalMeters / 1000).toFixed(2)} 公里`}
              value={Math.round(progress * 100)}
              disabled={!geometry.route.length}
              onChange={(event) =>
                selectPosition(Number(event.target.value) / 100, true)
              }
            />
            <span className="scene-progress" title="GPS 轨迹里程">
              {playbackDistance} <small>km</small>
            </span>
          </div>
        </div>
      )}
      <div className={`scene-viewport ${dragging ? 'is-dragging' : ''}`}>
        <canvas
          ref={canvasRef}
          className="run-scan-canvas"
          tabIndex={hasRoute ? 0 : -1}
          aria-hidden={!hasRoute || undefined}
          role="img"
          aria-label="可交互的跑步轨迹。点路线定位，拖动旋转，双指缩放。方向键调整视角，加减号缩放，Home 复位，空格回放。也可使用里程选择框定位。"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onLostPointerCapture={(event) => {
            pointers.current.delete(event.pointerId);
            if (!pointers.current.size) {
              gesture.current = null;
              setDragging(false);
            }
          }}
          onKeyDown={key}
        />
        {visibleMarks.map(({ meters }) => (
          <span
            key={meters}
            className="scene-km-mark"
            aria-hidden="true"
            hidden
            ref={(node) => {
              if (node) markLabels.current.set(meters, node);
              else markLabels.current.delete(meters);
            }}
          >
            {meters / 1000} km
          </span>
        ))}
        {displayPoint && (
          <div className="scene-profile-cursor">
            {(displayPoint.distance / 1000).toFixed(2)} km
            {displayPoint.altitude !== undefined &&
              ` · ${displayPoint.altitude.toFixed(1)} m`}
          </div>
        )}
        {!hasRoute && (
          <div className="scene-empty" role="status">
            <strong>
              {activity ? '该活动没有 GPS 轨迹' : '选择一条记录，查看轨迹'}
            </strong>
            <span>
              {activity
                ? '距离和时长仍可在活动详情中查看。'
                : '轨迹会随选中的跑步记录更新。'}
            </span>
          </div>
        )}
        {hasRoute && (
          <div className="scene-gesture-hint" aria-hidden="true">
            点路线定位 <span>·</span> 拖动旋转
          </div>
        )}
      </div>
      {hasRoute && (
        <>
          <div className="scene-toolbar">
            <div
              className="scene-view-switch"
              role="group"
              aria-label="轨迹视角"
            >
              <button
                type="button"
                aria-pressed={view === 'perspective'}
                onClick={() => {
                  setView('perspective');
                  setCamera((c) => ({ ...c, pitch: 0.68 }));
                }}
              >
                立体
              </button>
              <button
                type="button"
                aria-pressed={view === 'top'}
                onClick={() => {
                  setView('top');
                  setCamera((c) => ({ ...c, pitch: 1.56 }));
                }}
              >
                俯视
              </button>
            </div>
            <span
              className="scene-zoom-status"
              data-yaw={camera.yaw.toFixed(3)}
              data-pitch={camera.pitch.toFixed(3)}
            >
              {(camera.zoom * (following ? 1.75 : 1)).toFixed(1)}×
            </span>
            <div className="scene-tool-buttons">
              <button
                type="button"
                aria-label="向左旋转轨迹"
                title="向左旋转"
                onClick={() => setCamera((c) => ({ ...c, yaw: c.yaw - 0.2 }))}
              >
                ↶
              </button>
              <button
                type="button"
                aria-label="向右旋转轨迹"
                title="向右旋转"
                onClick={() => setCamera((c) => ({ ...c, yaw: c.yaw + 0.2 }))}
              >
                ↷
              </button>
              <button
                type="button"
                aria-label="缩小轨迹"
                title="缩小"
                onClick={() =>
                  setCamera((c) => ({
                    ...c,
                    zoom: clamp(c.zoom / 1.15, 0.55, 2.4),
                  }))
                }
              >
                −
              </button>
              <button
                type="button"
                aria-label="放大轨迹"
                title="放大"
                onClick={() =>
                  setCamera((c) => ({
                    ...c,
                    zoom: clamp(c.zoom * 1.15, 0.55, 2.4),
                  }))
                }
              >
                +
              </button>
              <button type="button" className="scene-reset" onClick={reset}>
                复位
              </button>
            </div>
          </div>
          {profile && (
            <div className="scene-elevation-tools">
              <label>
                高度比例
                <select
                  aria-label="高度放大倍数"
                  value={heightScale}
                  disabled={!profile}
                  onChange={(event) =>
                    setHeightScale(Number(event.target.value))
                  }
                >
                  <option value="1">真实比例 1×</option>
                  <option value="3">放大 3×</option>
                  <option value="5">放大 5×</option>
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={smoothed}
                  disabled={!profile}
                  onChange={(event) =>
                    (onSmoothedChange ?? setLocalSmoothed)(event.target.checked)
                  }
                />
                海拔降噪
              </label>
              <span>
                {geometry.minElevation.toFixed(1)}–
                {geometry.maxElevation.toFixed(1)} m
              </span>
            </div>
          )}
          <div className="scene-footnote">
            <span>
              {profile
                ? `GPX 记录海拔 · ${heightScale === 1 ? '等比例' : `高度放大 ${heightScale}×`}`
                : status === 'loading'
                  ? '正在读取海拔…'
                  : status === 'error'
                    ? '海拔暂时无法读取'
                    : '平面 GPS 轨迹'}
            </span>
            <span>{profile ? '点阵 · 水平参考面' : '地面投影'}</span>
          </div>
        </>
      )}
    </div>
  );
}
