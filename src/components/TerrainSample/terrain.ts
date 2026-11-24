type Point = { x: number; y: number; z: number };
type Screen = { x: number; y: number };
type Line = [Point, Point];
export type Camera = { yaw: number; pitch: number; zoom: number };
export const initialCamera: Camera = { yaw: -0.42, pitch: 0.61, zoom: 1 };
export const clamp = (n: number, low: number, high: number) =>
  Math.min(high, Math.max(low, n));

type Grid = {
  runId: string;
  cols: number;
  rows: number;
  bounds: [number, number, number, number];
  elevations: number[];
};

export function readGrid(input: unknown, runId: string): Grid {
  const g = input as Partial<Grid> | null;
  if (
    !g ||
    g.runId !== runId ||
    !Number.isInteger(g.cols) ||
    !Number.isInteger(g.rows) ||
    g.cols! < 2 ||
    g.rows! < 2 ||
    g.cols! * g.rows! > 150_000 ||
    !Array.isArray(g.bounds) ||
    g.bounds.length !== 4 ||
    !g.bounds.every(Number.isFinite) ||
    g.bounds[0] >= g.bounds[2] ||
    g.bounds[1] >= g.bounds[3] ||
    !Array.isArray(g.elevations) ||
    g.elevations.length !== g.cols! * g.rows! ||
    !g.elevations.every(Number.isFinite)
  )
    throw new Error('Invalid terrain grid');
  return g as Grid;
}

type Cell = {
  at: number;
  shade: number;
  contours: Line[];
  edges: [number, number][];
};

function interpolate(a: Point, b: Point, t: number): Point {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

function contourTriangle(
  a: Point,
  b: Point,
  c: Point,
  step: number,
  result: Line[]
) {
  const triangle = [a, b, c];
  const low = Math.min(a.z, b.z, c.z),
    high = Math.max(a.z, b.z, c.z);
  for (let level = Math.ceil(low / step) * step; level < high; level += step) {
    const crossings: Point[] = [];
    for (let i = 0; i < 3; i++) {
      const start = triangle[i],
        end = triangle[(i + 1) % 3];
      if (start.z <= level !== end.z <= level)
        crossings.push(
          interpolate(start, end, (level - start.z) / (end.z - start.z))
        );
    }
    if (crossings.length === 2) result.push([crossings[0], crossings[1]]);
  }
}

export function makeSurface(grid: Grid, route: [number, number][]) {
  const [west, south, east, north] = grid.bounds;
  const metres = (Math.PI * 6371008.8) / 180;
  const width =
    (east - west) * metres * Math.cos(((north + south) * Math.PI) / 360);
  const depth = (north - south) * metres;
  const { cols, rows, elevations } = grid;
  const cellWidth = width / (cols - 1),
    cellDepth = depth / (rows - 1);
  const vertices = elevations.map((z, i) => ({
    x: (i % cols) * cellWidth - width / 2,
    y: depth / 2 - Math.floor(i / cols) * cellDepth,
    z,
  }));
  let low = Infinity,
    high = -Infinity;
  for (const z of elevations) {
    low = Math.min(low, z);
    high = Math.max(high, z);
  }
  const interval =
    [5, 10, 20, 50, 100, 200, 500].find((step) => (high - low) / step <= 24) ??
    1000;
  const cells: Cell[] = [];
  for (let row = 0; row < rows - 1; row++)
    for (let col = 0; col < cols - 1; col++) {
      const at = row * cols + col;
      const a = vertices[at],
        b = vertices[at + 1],
        c = vertices[at + cols + 1],
        d = vertices[at + cols];
      const contours: Line[] = [];
      contourTriangle(a, b, c, interval, contours);
      contourTriangle(a, c, d, interval, contours);
      const eastSlope = (b.z + c.z - a.z - d.z) / (2 * cellWidth);
      const northSlope = (a.z + b.z - c.z - d.z) / (2 * cellDepth);
      // Oblique northwest light makes shallow slopes readable at true vertical scale.
      const light =
        (0.74 * eastSlope - 0.49 * northSlope + 0.46) /
        Math.hypot(eastSlope, northSlope, 1);
      const height =
        ((a.z + b.z + c.z + d.z) / 4 - low) / Math.max(1, high - low);
      const shade = Math.round(
        63 * clamp(0.4 + (light - 0.46) * 1.0 + (height - 0.5) * 0.24, 0, 1)
      );
      const edges: [number, number][] = [];
      if (!row) edges.push([at, at + 1]);
      if (row === rows - 2) edges.push([at + cols + 1, at + cols]);
      if (!col) edges.push([at + cols, at]);
      if (col === cols - 2) edges.push([at + 1, at + cols + 1]);
      cells.push({ at, shade, contours, edges });
    }

  // Use the same two triangles for the surface height and its projected route.
  const elevationAt = (gx: number, gy: number) => {
    const c = Math.min(cols - 2, Math.floor(gx)),
      r = Math.min(rows - 2, Math.floor(gy));
    const u = gx - c,
      v = gy - r,
      i = r * cols + c;
    return u >= v
      ? elevations[i] * (1 - u) +
          elevations[i + 1] * (u - v) +
          elevations[i + cols + 1] * v
      : elevations[i] * (1 - v) +
          elevations[i + cols] * (v - u) +
          elevations[i + cols + 1] * u;
  };
  const surfaceAt = (gx: number, gy: number): Point => ({
    x: gx * cellWidth - width / 2,
    y: depth / 2 - gy * cellDepth,
    z: elevationAt(gx, gy),
  });
  const track: Line[] = [];
  let start: Point | undefined, end: Point | undefined;
  let previous: [number, number] | null = null;
  for (const [lat, lon] of route) {
    const x = ((lon - west) * (cols - 1)) / (east - west),
      y = ((north - lat) * (rows - 1)) / (north - south);
    if (x < 0 || x > cols - 1 || y < 0 || y > rows - 1) {
      previous = null;
      continue;
    }
    if (previous) {
      const [px, py] = previous;
      const pieces = Math.max(1, Math.ceil(Math.hypot(x - px, y - py) * 3));
      let a = surfaceAt(px, py);
      start ??= a;
      for (let j = 1; j <= pieces; j++) {
        const b = surfaceAt(
          px + ((x - px) * j) / pieces,
          py + ((y - py) * j) / pieces
        );
        track.push([a, b]);
        a = b;
      }
      end = a;
    }
    previous = [x, y];
  }
  if (!start || !end) throw new Error('Route outside elevation coverage');
  return {
    vertices,
    cells,
    track,
    elevationAt,
    cellWidth,
    cellDepth,
    start,
    end,
    low,
    high,
    width,
    depth,
    interval,
    cols,
    rows,
  };
}
export type Surface = ReturnType<typeof makeSurface>;

const palette = (light: boolean) =>
  Array.from({ length: 64 }, (_, i) => {
    const t = i / 63;
    const from = light ? [86, 101, 77] : [26, 37, 34],
      to = light ? [218, 226, 195] : [154, 177, 131];
    return (
      'rgb(' +
      from.map((v, j) => Math.round(v + (to[j] - v) * t)).join(',') +
      ')'
    );
  });
const darkShades = palette(false),
  lightShades = palette(true);

export function drawSurface(
  ctx: CanvasRenderingContext2D,
  surface: Surface,
  w: number,
  h: number,
  camera: Camera,
  light: boolean
) {
  const { cells, vertices, cols, width, depth, low, high } = surface;
  const cy = Math.cos(camera.yaw),
    sy = Math.sin(camera.yaw),
    sp = Math.sin(camera.pitch),
    cp = Math.cos(camera.pitch);
  const planWidth = width * Math.abs(cy) + depth * Math.abs(sy);
  const planDepth = (width * Math.abs(sy) + depth * Math.abs(cy)) * sp;
  const scale =
    camera.zoom *
    Math.min(
      (w * 0.91) / planWidth,
      (h * 0.8) / (planDepth + (high - low) * cp)
    );
  const baseline = (high + low) * 0.5;
  const project = (p: Point): Screen => ({
    x: w * 0.5 + (p.x * cy + p.y * sy) * scale,
    y: h * 0.5 - ((-p.x * sy + p.y * cy) * sp + (p.z - baseline) * cp) * scale,
  });
  ctx.clearRect(0, 0, w, h);
  const projected = vertices.map(project);
  const shades = light ? lightShades : darkShades;
  const order = cells
    .map((cell, i) => ({
      i,
      forward: -vertices[cell.at].x * sy + vertices[cell.at].y * cy,
    }))
    .sort((a, b) => b.forward - a.forward);
  const path = (a: Screen, b: Screen, c: Screen, d: Screen) => {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.closePath();
  };
  const lines = (segments: Line[]) => {
    ctx.beginPath();
    for (const [start, end] of segments) {
      const a = project(start),
        b = project(end);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
  };
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const { i } of order) {
    const { at, edges, shade, contours } = cells[i];
    for (const [start, end] of edges) {
      // Only the two cut edges that face the viewer can obscure the surface.
      const sideX = vertices[start].x === vertices[end].x;
      const facing = sideX ? vertices[start].x * sy : -vertices[start].y * cy;
      if (facing <= 0) continue;
      path(
        projected[start],
        projected[end],
        project({ ...vertices[end], z: low }),
        project({ ...vertices[start], z: low })
      );
      ctx.fillStyle = light ? '#818d72' : '#26342d';
      ctx.fill();
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = 0.55;
      ctx.stroke();
    }
    path(
      projected[at],
      projected[at + 1],
      projected[at + cols + 1],
      projected[at + cols]
    );
    ctx.fillStyle = shades[shade];
    ctx.fill();
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = 0.65;
    ctx.stroke();
    if (contours.length) {
      lines(contours);
      ctx.lineWidth = 0.8;
      ctx.strokeStyle = light ? '#53694380' : '#c0d8a46b';
      ctx.stroke();
    }
  }

  // Test the sightline against the DEM before inking the route in a single pass.
  // The camera is orthographic, so all sightlines have the same direction.
  const step = Math.min(surface.cellWidth, surface.cellDepth) / 3;
  const rise = step * Math.tan(camera.pitch);
  const stepX = (sy * step) / surface.cellWidth;
  const stepY = (cy * step) / surface.cellDepth;
  const visible = (p: Point) => {
    let gx = (p.x + width / 2) / surface.cellWidth;
    let gy = (depth / 2 - p.y) / surface.cellDepth;
    for (let z = p.z + rise; z < high; z += rise) {
      gx += stepX;
      gy += stepY;
      if (gx < 0 || gx > cols - 1 || gy < 0 || gy > surface.rows - 1) break;
      if (surface.elevationAt(gx, gy) > z + 0.25) return false;
    }
    return true;
  };
  ctx.beginPath();
  let previous: Point | undefined;
  for (const [a, b] of surface.track) {
    if (!visible(interpolate(a, b, 0.5))) {
      previous = undefined;
      continue;
    }
    if (!previous || previous.x !== a.x || previous.y !== a.y) {
      const from = project(a);
      ctx.moveTo(from.x, from.y);
    }
    const to = project(b);
    ctx.lineTo(to.x, to.y);
    previous = b;
  }
  ctx.lineWidth = 4.1;
  ctx.strokeStyle = light ? '#f2f5dc' : '#233026';
  ctx.stroke();
  ctx.lineWidth = 2.25;
  ctx.strokeStyle = light ? '#344712' : '#e3fb79';
  ctx.stroke();

  const start = project(surface.start),
    end = project(surface.end);
  const label = (p: Screen, name: string, left = false, below = false) => {
    if (p.x < 0 || p.y < 0 || p.x > w || p.y > h) return;
    ctx.fillStyle = light ? '#23370d' : '#e3fb79';
    ctx.strokeStyle = light ? '#f9ffe4' : '#151c12';
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (name === '终') ctx.rect(p.x - 3, p.y - 3, 6, 6);
    else ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.font = '600 12px sans-serif';
    const textWidth = ctx.measureText(name).width;
    const x = clamp(left ? p.x - textWidth - 7 : p.x + 7, 3, w - textWidth - 3);
    const y = clamp(below ? p.y + 16 : p.y - 8, 14, h - 4);
    ctx.strokeStyle = light ? '#f0f3e6' : '#182017';
    ctx.lineWidth = 3;
    ctx.strokeText(name, x, y);
    ctx.fillStyle = light ? '#23370d' : '#f4f9d8';
    ctx.fillText(name, x, y);
  };
  const endpointMetres = Math.hypot(
    surface.start.x - surface.end.x,
    surface.start.y - surface.end.y
  );
  if (endpointMetres <= 10) label(start, '起 / 终');
  else if (Math.hypot(start.x - end.x, start.y - end.y) < 42) {
    label(start, '起', start.x <= end.x, start.y > end.y);
    label(end, '终', start.x > end.x, start.y <= end.y);
  } else {
    label(start, '起');
    label(end, '终');
  }

  // Screen-horizontal scale uses the orthographic horizontal scale exactly.
  const maxMetres = Math.min(90, w * 0.23) / scale;
  const base = 10 ** Math.floor(Math.log10(maxMetres));
  const length = ([5, 2, 1].find((n) => n * base <= maxMetres) ?? 1) * base;
  const bottom = h - 13,
    right = 12 + length * scale;
  const ink = light ? '#35432d' : '#d1dabb';
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(12, bottom - 3);
  ctx.lineTo(12, bottom);
  ctx.lineTo(right, bottom);
  ctx.lineTo(right, bottom - 3);
  ctx.stroke();
  ctx.font = '11px monospace';
  ctx.fillText(
    length >= 1000 ? length / 1000 + ' km' : length + ' m',
    12,
    bottom - 7
  );
  const dx = sy,
    dy = -cy * sp,
    norm = Math.hypot(dx, dy);
  const nx = dx / norm,
    ny = dy / norm,
    ax = w - 30,
    ay = 29;
  ctx.beginPath();
  ctx.moveTo(ax - nx * 7, ay - ny * 7);
  ctx.lineTo(ax + nx * 10, ay + ny * 10);
  ctx.lineTo(ax + nx * 5 - ny * 3, ay + ny * 5 + nx * 3);
  ctx.moveTo(ax + nx * 10, ay + ny * 10);
  ctx.lineTo(ax + nx * 5 + ny * 3, ay + ny * 5 - nx * 3);
  ctx.stroke();
  ctx.fillText('N', ax + nx * 16 - 3, ay + ny * 16 + 3);
}
