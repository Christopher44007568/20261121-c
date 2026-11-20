// Interactive controller for the stroke-expansion preview.

'use strict';

const VIEW_W = 320;
const VIEW_H = 240;

function readOptions() {
  const dashText = document.getElementById('dasharray').value.trim();
  const dasharray = dashText
    ? dashText.split(/[,\s]+/).map((value) => Number(value)).filter((value) => !Number.isNaN(value))
    : null;
  const scaleX = Number(document.getElementById('scaleX').value) || 1;
  const scaleY = Number(document.getElementById('scaleY').value) || 1;
  return {
    width: Number(document.getElementById('width').value) || 1,
    lineJoin: document.getElementById('lineJoin').value,
    lineCap: document.getElementById('lineCap').value,
    miterLimit: Number(document.getElementById('miterLimit').value) || 4,
    dasharray,
    dashoffset: Number(document.getElementById('dashoffset').value) || 0,
    transform: [scaleX, 0, 0, scaleY, 0, 0],
  };
}

function render() {
  const d = document.getElementById('d').value;
  const options = readOptions();
  let fillD = '';
  let error = null;
  try {
    fillD = window.StrokeToPath.strokeToFillPath(d, options);
  } catch (err) {
    error = err.message;
  }

  const showReference = document.getElementById('showReference').checked;
  const dashAttr = options.dasharray
    ? ` stroke-dasharray="${options.dasharray.join(' ')}" stroke-dashoffset="${options.dashoffset}"`
    : '';
  const matrix = `matrix(${options.transform.join(' ')})`;

  const reference = showReference
    ? `<path d="${d}" fill="none" stroke="rgba(220,40,40,0.45)" stroke-width="${options.width}"
        stroke-linecap="${options.lineCap}" stroke-linejoin="${options.lineJoin}"
        stroke-miterlimit="${options.miterLimit}"${dashAttr} transform="${matrix}"/>`
    : '';

  document.getElementById('canvasWrap').innerHTML = error
    ? `<p style="color:#b00020">${error}</p>`
    : `<svg width="${VIEW_W}" height="${VIEW_H}" viewBox="0 0 ${VIEW_W} ${VIEW_H}"
         xmlns="http://www.w3.org/2000/svg">
         ${reference}
         <path d="${fillD}" fill="#111111" stroke="none"/>
       </svg>`;
  document.getElementById('fillOutput').textContent = error ? `错误：${error}` : fillD;
  return { fillD, error };
}

document.getElementById('apply').addEventListener('click', render);
document.getElementById('copy').addEventListener('click', async () => {
  const text = document.getElementById('fillOutput').textContent;
  try {
    await navigator.clipboard.writeText(text);
    document.getElementById('copy').textContent = '已复制';
    setTimeout(() => { document.getElementById('copy').textContent = '复制纯填充 path d'; }, 1200);
  } catch {
    /* clipboard unavailable in some file:// contexts */
  }
});

document.getElementById('download').addEventListener('click', () => {
  const text = document.getElementById('fillOutput').textContent;
  if (!text || text.startsWith('错误')) return;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${VIEW_W}" height="${VIEW_H}"
  viewBox="0 0 ${VIEW_W} ${VIEW_H}">
  <path d="${text}" fill="#111111" fill-rule="nonzero"/>
</svg>`;
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'fill-path.svg';
  link.click();
  URL.revokeObjectURL(url);
});

render();
