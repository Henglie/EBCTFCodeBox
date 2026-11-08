import assert from 'node:assert/strict';
import { APPLE_CORNER_COMMANDS, continuousCornerPath } from '../src/ui/continuousCorners.js';

// Independent verbatim decimal transcript from PixelCut's published Objective-C
// shape_1 category. The differing values at the four corners are intentional.
const source = `
TOP_LEFT M 1.52866483 0.00000000
TOP_RIGHT L 1.52866471 0.00000000
TOP_RIGHT C 1.08849323 0.00000000 0.86840689 0.00000000 0.66993427 0.06549600
TOP_RIGHT L 0.63149399 0.07491100
TOP_RIGHT C 0.37282392 0.16905899 0.16906013 0.37282401 0.07491176 0.63149399
TOP_RIGHT C 0.00000000 0.86840701 0.00000000 1.08849299 0.00000000 1.52866483
BOTTOM_RIGHT L 0.00000000 1.52866471
BOTTOM_RIGHT C 0.00000000 1.08849323 0.00000000 0.86840689 0.06549569 0.66993493
BOTTOM_RIGHT L 0.07491111 0.63149399
BOTTOM_RIGHT C 0.16905883 0.37282392 0.37282392 0.16905883 0.63149399 0.07491111
BOTTOM_RIGHT C 0.86840689 0.00000000 1.08849323 0.00000000 1.52866471 0.00000000
BOTTOM_LEFT L 1.52866483 0.00000000
BOTTOM_LEFT C 1.08849299 0.00000000 0.86840701 0.00000000 0.66993397 0.06549569
BOTTOM_LEFT L 0.63149399 0.07491111
BOTTOM_LEFT C 0.37282401 0.16905883 0.16906001 0.37282392 0.07491100 0.63149399
BOTTOM_LEFT C 0.00000000 0.86840689 0.00000000 1.08849323 0.00000000 1.52866471
TOP_LEFT L 0.00000000 1.52866483
TOP_LEFT C 0.00000000 1.08849299 0.00000000 0.86840701 0.06549600 0.66993397
TOP_LEFT L 0.07491100 0.63149399
TOP_LEFT C 0.16906001 0.37282401 0.37282401 0.16906001 0.63149399 0.07491100
TOP_LEFT C 0.86840701 0.00000000 1.08849299 0.00000000 1.52866483 0.00000000
`;
const entries = source.trim().split('\n').map(line => { const [corner, op, ...values] = line.trim().split(/\s+/); return { corner, op, values: values.map(Number) }; });
let checks = 0;
function expectedPath(width, height, radius, x = 0, y = 0) {
  const r = Math.min(radius, Math.min(width, height) / 2 / 1.52866483);
  return entries.map(({ corner, op, values }) => op + values.reduce((pairs, v, i) => {
    if (i % 2 === 0) {
      const px = x + (corner.endsWith('RIGHT') ? width - v * r : v * r);
      const py = y + (corner.startsWith('BOTTOM') ? height - values[i + 1] * r : values[i + 1] * r);
      pairs.push(`${Number(px.toFixed(10))} ${Number(py.toFixed(10))}`);
    }
    return pairs;
  }, []).join(' ')).join('') + 'Z';
}
for (const [width, height, radius] of [[200, 120, 1], [200, 120, 28], [200, 120, 90], [80, 160, 50], [320, 44, 12], [33.5, 29.25, 999]]) {
  for (const [x, y] of [[0, 0], [-3, -3], [7.25, 1.5]]) {
    assert.equal(continuousCornerPath(width, height, Array(4).fill(radius), x, y), expectedPath(width, height, radius, x, y)); checks++;
  }
}
const expected = entries.slice(1).reduce((list, entry) => {
  if (entry.op === 'L' && list.length % 5 === 0) list.push(['start', ...entry.values]);
  else list.push([entry.op, ...entry.values]);
  return list;
}, []);
for (const [i, corner] of APPLE_CORNER_COMMANDS.entries()) {
  assert.deepEqual(corner.start, expected[i * 5].slice(1)); checks++;
  assert.deepEqual(corner.commands, expected.slice(i * 5 + 1, i * 5 + 5)); checks++;
}
assert.notDeepEqual(APPLE_CORNER_COMMANDS[0].commands, APPLE_CORNER_COMMANDS[1].commands); checks++;
console.log(JSON.stringify({ verdict: 'PASS', checks, source: 'https://www.paintcodeapp.com/news/code-for-ios-7-rounded-rectangles', corners: 4, commands: 21, normalization: 'original limitedRadius' }));
