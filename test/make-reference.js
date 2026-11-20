// Render browser reference strokes and our expanded fill paths to PNG pairs.
// Output: artifacts/render/<id>-reference.png and <id>-candidate.png

'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { cases, VIEWBOX } = require('./cases');
const { strokeToFillPath } = require('../src/stroke-to-path');
const { mconcat, mtranslate, identity } = require('../src/geometry');

const OUT_DIR = path.join(__dirname, '..', 'artifacts', 'render');

function svgForScene(scene, mode) {
  const style = scene.style;
  const transformParts = [];
  if (scene.translate) transformParts.push(`translate(${scene.translate[0]} ${scene.translate[1]})`);
  if (scene.transform) {
    const [a, b, c, d, e, f] = scene.transform;
    transformParts.push(`matrix(${a} ${b} ${c} ${d} ${e} ${f})`);
  }
  const transformAttr = transformParts.length ? ` transform="${transformParts.join(' ')}"` : '';
  const dashAttr = style.dasharray
    ? ` stroke-dasharray="${style.dasharray.join(' ')}" stroke-dashoffset="${style.dashoffset ?? 0}"`
    : '';

  let element;
  if (mode === 'reference') {
    element = `<path d="${scene.d}" fill="none" stroke="#111111"
      stroke-width="${style.width}"
      stroke-linecap="${style.lineCap || 'butt'}"
      stroke-linejoin="${style.lineJoin || 'miter'}"
      stroke-miterlimit="${style.miterLimit ?? 4}"${dashAttr}${transformAttr}/>`;
  } else {
    const matrix = mconcat(
      scene.transform || identity(),
      scene.translate ? mtranslate(scene.translate[0], scene.translate[1]) : identity(),
    );
    const fillD = strokeToFillPath(scene.d, { ...style, transform: matrix });
    element = `<path d="${fillD}" fill="#111111" stroke="none"/>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${VIEWBOX.width}" height="${VIEWBOX.height}"
    viewBox="0 0 ${VIEWBOX.width} ${VIEWBOX.height}">
    ${element}
  </svg>`;
}

async function render() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: VIEWBOX.width, height: VIEWBOX.height } });

  for (const scene of cases) {
    const variants = scene.variants || [null];
    for (const variant of variants) {
      const merged = variant
        ? { ...scene, style: { ...scene.style, ...variant }, id: `${scene.id}-${variant.lineCap}` }
        : scene;
      for (const mode of ['reference', 'candidate']) {
        const svg = svgForScene(merged, mode);
        await page.setContent(`<!doctype html><body style="margin:0">${svg}</body>`);
        const file = path.join(OUT_DIR, `${merged.id}-${mode}.png`);
        await page.screenshot({ path: file, omitBackground: true });
      }
      if (variant) {
        // Persist the expanded fill path for the export-focused check too.
        const matrix = mconcat(
          merged.transform || identity(),
          merged.translate ? mtranslate(merged.translate[0], merged.translate[1]) : identity(),
        );
        const fillD = strokeToFillPath(merged.d, { ...merged.style, transform: matrix });
        fs.writeFileSync(path.join(OUT_DIR, `${merged.id}.path.txt`), fillD);
      }
    }
  }

  await browser.close();
  console.log(`rendered ${cases.length} scenes into ${OUT_DIR}`);
}

render().catch((error) => {
  console.error(error);
  process.exit(1);
});
