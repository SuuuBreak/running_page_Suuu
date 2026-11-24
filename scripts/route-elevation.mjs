import fs from 'node:fs';
import path from 'node:path';
import polyline from '@mapbox/polyline';

const meters = (a, b) => {
  const rad = Math.PI / 180;
  const x = (a[1] - b[1]) * rad * Math.cos(((a[0] + b[0]) * rad) / 2);
  return 6371008.8 * Math.hypot(x, (a[0] - b[0]) * rad);
};
const round = (n, precision = 1) => Number(n.toFixed(precision));

// Build only local GPX-derived display data. Never modify the source activities or GPX.
export function generateElevation(root) {
  const activities = JSON.parse(
    fs.readFileSync(path.join(root, 'src/static/activities.json'), 'utf8')
  );
  const folder = path.join(root, 'GPX_OUT');
  const files = fs.existsSync(folder)
    ? fs.readdirSync(folder).filter((f) => f.endsWith('.gpx'))
    : [];
  const byId = new Map(
    files.map((file) => [String(Number(path.basename(file, '.gpx'))), file])
  );
  const output = path.join(root, 'public/route-elevation');
  fs.mkdirSync(output, { recursive: true });
  const manifest = {};
  for (const run of activities) {
    const id = String(run.run_id),
      file = byId.get(id);
    if (!file || !run.summary_polyline) continue;
    let route;
    try {
      route = polyline.decode(run.summary_polyline);
    } catch {
      continue;
    }
    if (route.length < 2 || !route.some((p) => meters(p, route[0]) > 1))
      continue;
    const xml = fs.readFileSync(path.join(folder, file), 'utf8');
    // Numeric GPX track points; extensions and personal metadata are not exported.
    const segments = [];
    let missingElevation = false;
    for (const segment of xml.matchAll(
      /<(?:\w+:)?trkseg\b[^>]*>([\s\S]*?)<\/(?:\w+:)?trkseg>/g
    )) {
      const points = [];
      for (const match of segment[1].matchAll(
        /<(?:\w+:)?trkpt\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?trkpt>/g
      )) {
        const lat = Number(match[1].match(/\blat=["']([^"']+)/)?.[1]);
        const lng = Number(match[1].match(/\blon=["']([^"']+)/)?.[1]);
        const elevation = Number(
          match[2].match(/<(?:\w+:)?ele>([^<]+)<\//)?.[1]
        );
        if (!Number.isFinite(elevation)) missingElevation = true;
        if (
          [lat, lng, elevation].every(Number.isFinite) &&
          Math.abs(lat) <= 90 &&
          Math.abs(lng) <= 180
        )
          points.push([lat, lng, elevation]);
      }
      if (points.length > 1) segments.push(points);
    }
    // Separate segments cannot be joined without inventing unrecorded movement.
    if (segments.length !== 1 || missingElevation) continue;
    let points = segments[0];
    const closest = (target) =>
      points.reduce(
        (best, p, i) =>
          meters(p, target) < best.distance
            ? { i, distance: meters(p, target) }
            : best,
        { i: 0, distance: Infinity }
      );
    const first = closest(route[0]),
      last = closest(route.at(-1));
    // Keep the same published endpoints; do not reintroduce trimmed start/end positions.
    if (first.distance > 30 || last.distance > 30 || last.i <= first.i)
      continue;
    points = points.slice(first.i, last.i + 1);
    const distance = [0];
    for (let i = 1; i < points.length; i++)
      distance.push(distance.at(-1) + meters(points[i - 1], points[i]));
    const total = distance.at(-1);
    if (total < 2) continue;
    // Resample by distance (at least every 10 m, at most 2001 points), then a 3-point
    // median removes isolated spikes and a 30 m triangular window reduces GPS noise.
    const interval = Math.max(10, total / 2000);
    const sampled = [];
    let cursor = 1;
    for (let d = 0; d < total + interval; d += interval) {
      d = Math.min(d, total);
      while (cursor < distance.length - 1 && distance[cursor] < d) cursor++;
      const span = distance[cursor] - distance[cursor - 1];
      const t = span > 0 ? (d - distance[cursor - 1]) / span : 0;
      sampled.push([
        d,
        ...points[cursor].map(
          (v, k) => points[cursor - 1][k] * (1 - t) + v * t
        ),
      ]);
      if (d === total) break;
    }
    const medians = sampled
      .map((_, i) =>
        sampled
          .slice(Math.max(0, i - 1), i + 2)
          .map((p) => p[3])
          .sort((a, b) => a - b)
      )
      .map((a) => a[Math.floor(a.length / 2)]);
    const rows = sampled
      .map((p, i) => {
        let sum = 0,
          weights = 0;
        for (
          let j = Math.max(0, i - 3);
          j <= Math.min(sampled.length - 1, i + 3);
          j++
        ) {
          const weight = Math.max(0, 1 - Math.abs(sampled[j][0] - p[0]) / 15);
          sum += medians[j] * weight;
          weights += weight;
        }
        return [
          round(p[0]),
          round(p[1], 6),
          round(p[2], 6),
          round(p[3]),
          round(sum / weights),
        ];
      })
      .reduce((result, row) => {
        if (result.length && row[0] === result.at(-1)[0])
          result[result.length - 1] = row;
        else result.push(row);
        return result;
      }, []);
    const raw = points.map((p) => p[2]);
    const info = {
      source: 'GPX',
      points: points.length,
      rawMin: round(Math.min(...raw)),
      rawMax: round(Math.max(...raw)),
      distance: round(total),
    };
    const data = {
      ...info,
      columns: [
        'distance_m',
        'latitude',
        'longitude',
        'raw_elevation_m',
        'smoothed_elevation_m',
      ],
      samples: rows,
    };
    fs.writeFileSync(path.join(output, `${id}.json`), JSON.stringify(data));
    manifest[id] = info;
  }
  // A manifest makes missing GPX explicit and avoids a 404 for each indoor activity.
  // Remove only this generator's obsolete numeric JSON outputs. Source GPX files
  // are never changed, including when an activity is removed from the archive.
  for (const file of fs.readdirSync(output)) {
    if (/^\d+\.json$/.test(file) && !manifest[path.basename(file, '.json')]) {
      const target = path.resolve(output, file);
      if (path.dirname(target) !== path.resolve(output))
        throw new Error('Invalid output path');
      fs.unlinkSync(target);
    }
  }
  fs.writeFileSync(path.join(output, 'index.json'), JSON.stringify(manifest));
  console.log(
    `[route-elevation] ${Object.keys(manifest).length}/${activities.length} activities with aligned GPX elevation`
  );
  return manifest;
}

export default function routeElevationPlugin() {
  let root;
  return {
    name: 'route-elevation',
    configResolved(config) {
      root = config.root;
    },
    buildStart() {
      generateElevation(root);
    },
    configureServer(server) {
      const inputs = [
        path.join(root, 'GPX_OUT'),
        path.join(root, 'src/static/activities.json'),
      ];
      server.watcher.add(inputs);
      let timer;
      const refresh = (file) => {
        file = path.resolve(file);
        if (
          !inputs.some(
            (input) => file === input || file.startsWith(input + path.sep)
          )
        )
          return;
        clearTimeout(timer);
        timer = setTimeout(() => {
          generateElevation(root);
          server.ws.send({ type: 'full-reload' });
        }, 300);
      };
      server.watcher
        .on('change', refresh)
        .on('add', refresh)
        .on('unlink', refresh);
      server.httpServer?.once('close', () => clearTimeout(timer));
    },
  };
}
