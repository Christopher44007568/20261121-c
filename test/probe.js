'use strict';
const { scene, CHECK_POINTS } = require('../src/scene');
const { render } = require('../src/rasterizer');

const res = render(scene, { tracePoints: CHECK_POINTS.map((p) => p.pixel) });
console.log('stats', res.stats);
res.traces.forEach((tr, i) => {
  const cp = CHECK_POINTS[i];
  console.log('\n==', cp.id, cp.pixel, 'final', tr.final, 'depth', tr.depth);
  tr.attempts.forEach((a) => {
    console.log('  ', a.triangleId, 'covered=', a.covered, 'reason=', a.reason, 'planes=', a.planesHit.join('+'));
  });
  tr.events.forEach((e) => {
    console.log('   EVENT', e.triangleId, 'zWin=', e.depth.window.toFixed(4), 'pass=', e.depth.pass, 'blend=', e.blended, 'rgb=', e.result);
  });
});
