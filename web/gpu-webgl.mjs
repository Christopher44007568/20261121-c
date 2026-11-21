// 真实 GPU 离屏对照：用 WebGL1 渲染与软件光栅化相同的 6 个三角形，
// 读回帧缓冲与软件结果逐像素比较。WebGL 自带齐次裁剪、透视插值与 top-left 规则。
import { scene, W, H, triangles } from './scene.mjs';

const VERT = `
attribute vec4 aClip;
attribute vec3 aColor;
attribute float aAlpha;
varying vec3 vColor;
varying float vAlpha;
void main() {
  gl_Position = aClip;
  vColor = aColor;
  vAlpha = aAlpha;
}`;

const FRAG = `
precision mediump float;
varying vec3 vColor;
varying float vAlpha;
void main() { gl_FragColor = vec4(vColor / 255.0, vAlpha); }`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

export function renderWebGL() {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const gl = canvas.getContext('webgl', { antialias: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error('WebGL 不可用');
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  gl.useProgram(prog);

  gl.viewport(0, 0, W, H);
  gl.clearColor(scene.clearColor[0] / 255, scene.clearColor[1] / 255, scene.clearColor[2] / 255, 1);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LESS);
  gl.clearDepth(1);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  function bindAttrib(name, size, data) {
    const loc = gl.getAttribLocation(prog, name);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  }

  for (const tri of triangles) {
    const clip = [], col = [], alpha = [];
    for (const v of tri.vertices) {
      clip.push(v.pos[0], v.pos[1], v.pos[2], v.pos[3]);
      col.push(v.attr.color[0], v.attr.color[1], v.attr.color[2]);
      alpha.push(v.attr.alpha);
    }
    bindAttrib('aClip', 4, clip);
    bindAttrib('aColor', 3, col);
    bindAttrib('aAlpha', 1, alpha);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  const px = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  // WebGL 原点在左下，翻转 y 到软件光栅化的左上原点
  const flipped = new Uint8ClampedArray(W * H * 4);
  const row = W * 4;
  for (let y = 0; y < H; y++) flipped.set(px.subarray((H - 1 - y) * row, (H - y) * row), y * row);
  return { color: flipped, renderer: gl.getParameter(gl.RENDERER) };
}
