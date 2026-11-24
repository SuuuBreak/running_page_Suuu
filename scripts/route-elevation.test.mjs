import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import polyline from '@mapbox/polyline';
import { generateElevation } from './route-elevation.mjs';

test('GPX extraction keeps physical heights, published endpoints, and rejects incomplete tracks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'suuu-elevation-test-'));
  fs.mkdirSync(path.join(root, 'src/static'), { recursive: true });
  fs.mkdirSync(path.join(root, 'GPX_OUT'));
  const points = Array.from({ length: 101 }, (_, i) => [
    34 + i * 0.00001,
    109,
    i === 50 ? 450 : 400 + i / 100,
  ]);
  const route = polyline.encode(points.slice(5, 96).map((p) => p.slice(0, 2)));
  const activities = [
    { run_id: 1, summary_polyline: route },
    { run_id: 2, summary_polyline: route },
    {
      run_id: 3,
      summary_polyline: polyline.encode([
        [34, 109],
        [34, 109],
      ]),
    },
    { run_id: 4, summary_polyline: route },
  ];
  fs.writeFileSync(
    path.join(root, 'src/static/activities.json'),
    JSON.stringify(activities)
  );
  const xmlPoints = points
    .map(
      (p, i) => `<trkpt lat="${p[0]}" lon="${p[1]}"><ele>${p[2]}</ele></trkpt>`
    )
    .join('');
  fs.writeFileSync(
    path.join(root, 'GPX_OUT/1.gpx'),
    `<gpx><trk><trkseg>${xmlPoints}</trkseg></trk></gpx>`
  );
  fs.writeFileSync(
    path.join(root, 'GPX_OUT/2.gpx'),
    `<gpx><trk><trkseg>${xmlPoints.replace('<ele>400.1</ele>', '')}</trkseg></trk></gpx>`
  );
  fs.writeFileSync(
    path.join(root, 'GPX_OUT/3.gpx'),
    `<gpx><trk><trkseg>${xmlPoints}</trkseg></trk></gpx>`
  );
  fs.writeFileSync(
    path.join(root, 'GPX_OUT/4.gpx'),
    `<gpx><trk><trkseg>${xmlPoints}</trkseg><trkseg>${xmlPoints}</trkseg></trk></gpx>`
  );
  const before = fs.readFileSync(
    path.join(root, 'src/static/activities.json'),
    'utf8'
  );
  const index = generateElevation(root);
  assert.deepEqual(Object.keys(index), ['1']);
  const data = JSON.parse(
    fs.readFileSync(path.join(root, 'public/route-elevation/1.json'), 'utf8')
  );
  assert.equal(data.rawMax, 450); // Preserve raw evidence of the spike.
  assert.ok(data.samples.every((p) => p[4] >= 400 && p[4] <= 401)); // Display smoothing rejects it.
  assert.equal(data.samples[0][1], 34.00005); // Do not reintroduce trimmed positions.
  assert.equal(data.samples.at(-1)[1], 34.00095);
  assert.equal(data.samples[0][0], 0);
  assert.equal(data.samples.at(-1)[0], data.distance);
  assert.ok(data.samples.length < 30); // Distance resampling, not one sample per timestamp.
  assert.equal(
    fs.readFileSync(path.join(root, 'src/static/activities.json'), 'utf8'),
    before
  );
});

test('all published elevation rows are finite, ordered, bounded, with a flat latest run', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const index = generateElevation(root);
  assert.equal(Object.keys(index).length, 324);
  for (const id of Object.keys(index)) {
    const data = JSON.parse(
      fs.readFileSync(
        path.join(root, `public/route-elevation/${id}.json`),
        'utf8'
      )
    );
    assert.ok(data.samples.length >= 2 && data.samples.length <= 2002);
    data.samples.forEach((p, i) => {
      assert.ok(p.every(Number.isFinite));
      if (i) assert.ok(p[0] > data.samples[i - 1][0]);
      assert.ok(p[4] >= data.rawMin - 0.1 && p[4] <= data.rawMax + 0.1);
    });
  }
  assert.equal(
    index['9223370243748978000'].rawMax - index['9223370243748978000'].rawMin,
    1
  );
});
