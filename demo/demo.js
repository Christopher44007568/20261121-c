// Browser demo mirroring the Node-tested HDR bloom pipeline 1:1.
// Runs both variants against an animated subpixel filament on an 18% gray
// card and renders the tonemapped result to two canvases.

const W = 256;
const H = 256;
const MIPS = 4;
const HDR = 'rgba16float';

const SCENE_WGSL = `
struct SceneParams { resolution: vec2f, lineX: f32, lineWidth: f32,
  lineEnergy: f32, grayTarget: f32, _a: f32, tint: vec3f, _b: f32 }
@group(0) @binding(0) var<uniform> p: SceneParams;
struct V { @builtin(position) pos: vec4f, @location(0) frag: vec2f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> V {
  var tri = array<vec2f,3>(vec2f(-1,-3), vec2f(3,1), vec2f(-1,1));
  let xy = tri[i]; var o: V;
  o.pos = vec4f(xy, 0, 1);
  o.frag = (xy * vec2f(0.5,-0.5) + vec2f(0.5)) * p.resolution;
  return o;
}
fn coverage(px: f32) -> f32 {
  let left = p.lineX - p.lineWidth * 0.5;
  let right = p.lineX + p.lineWidth * 0.5;
  return clamp(right - px, 0.0, 1.0) - clamp(left - px, 0.0, 1.0);
}
@fragment fn fs(in: V) -> @location(0) vec4f {
  let c = coverage(in.frag.x);
  return vec4f(vec3f(p.grayTarget) + p.tint * (c * p.lineEnergy), 1.0);
}`;

const PREFILTER_WGSL = `
struct P { ts: vec2f, threshold: f32, knee: f32, strength: f32, exposure: f32, pad: vec2f }
@group(0) @binding(0) var t: texture_2d<f32>;
@group(0) @binding(1) var<uniform> p: P;
struct V { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> V {
  var tri = array<vec2f,3>(vec2f(-1,-3), vec2f(3,1), vec2f(-1,1));
  let xy = tri[i]; var o: V; o.pos = vec4f(xy,0,1);
  o.uv = xy * vec2f(0.5,-0.5) + vec2f(0.5); return o;
}
@fragment fn fs(in: V) -> @location(0) vec4f {
  let c = textureLoad(t, vec2i(in.pos.xy), 0).rgb;
  let b = max(max(c.r,c.g),c.b);
  let knee = max(p.knee, 1e-4);
  var soft = clamp(b - p.threshold + knee, 0.0, 2.0*knee);
  soft = soft*soft / max(4.0*knee, 1e-4);
  let k = max(soft, b - p.threshold);
  return vec4f(c * clamp(k / max(b,1e-4), 0.0, 1.0), 1.0);
}`;

const DOWN_WGSL = `
struct P { ts: vec2f, threshold: f32, knee: f32, strength: f32, exposure: f32, pad: vec2f }
@group(0) @binding(0) var t: texture_2d<f32>;
@group(0) @binding(1) var<uniform> p: P;
struct V { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> V {
  var tri = array<vec2f,3>(vec2f(-1,-3), vec2f(3,1), vec2f(-1,1));
  let xy = tri[i]; var o: V; o.pos = vec4f(xy,0,1);
  o.uv = xy * vec2f(0.5,-0.5) + vec2f(0.5); return o;
}
fn dims() -> vec2i { return vec2i(textureDimensions(t)); }
fn ld(c: vec2i) -> vec3f {
  let d = dims();
  return textureLoad(t, clamp(c, vec2i(0), d - vec2i(1)), 0).rgb;
}
@fragment fn naive(in: V) -> @location(0) vec4f {
  let d = dims();
  let c = clamp(vec2i(in.uv * vec2f(d)), vec2i(0), d - vec2i(1));
  return vec4f(textureLoad(t, c, 0).rgb, 1.0);
}
@fragment fn improved(in: V) -> @location(0) vec4f {
  let c = vec2i(in.uv * vec2f(vec2i(textureDimensions(t))));
  let box = (ld(c) + ld(c+vec2i(1,0)) + ld(c+vec2i(0,1)) + ld(c+vec2i(1,1))) * 0.25;
  return vec4f(box, 1.0);
}`;

const UP_WGSL = `
struct P { ts: vec2f, threshold: f32, knee: f32, strength: f32, exposure: f32, pad: vec2f }
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var add: texture_2d<f32>;
@group(0) @binding(2) var<uniform> p: P;
struct V { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> V {
  var tri = array<vec2f,3>(vec2f(-1,-3), vec2f(3,1), vec2f(-1,1));
  let xy = tri[i]; var o: V; o.pos = vec4f(xy,0,1);
  o.uv = xy * vec2f(0.5,-0.5) + vec2f(0.5); return o;
}
fn dims() -> vec2i { return vec2i(textureDimensions(src)); }
fn ld(c: vec2i) -> vec3f {
  let d = dims();
  return textureLoad(src, clamp(c, vec2i(0), d-vec2i(1)), 0).rgb;
}
@fragment fn naive(in: V) -> @location(0) vec4f {
  let d = dims();
  let up = textureLoad(src, clamp(vec2i(in.uv*vec2f(d)), vec2i(0), d-vec2i(1)), 0).rgb;
  let prev = textureLoad(add, vec2i(in.pos.xy), 0).rgb;
  return vec4f(prev + up, 1.0);
}
@fragment fn improved(in: V) -> @location(0) vec4f {
  let c = vec2i(in.uv * vec2f(vec2f(textureDimensions(src))));
  let sum = ld(c)*4.0 + (ld(c+vec2i(0,-1))+ld(c+vec2i(0,1))+ld(c+vec2i(-1,0))+ld(c+vec2i(1,0)))*2.0
    + ld(c+vec2i(-1,-1))+ld(c+vec2i(1,-1))+ld(c+vec2i(-1,1))+ld(c+vec2i(1,1));
  let prev = textureLoad(add, vec2i(in.pos.xy), 0).rgb;
  return vec4f(prev + sum*(1.0/16.0), 1.0);
}`;

const COMPOSITE_WGSL = `
struct P { ts: vec2f, threshold: f32, knee: f32, strength: f32, exposure: f32, pad: vec2f }
@group(0) @binding(0) var scene: texture_2d<f32>;
@group(0) @binding(1) var bloom: texture_2d<f32>;
@group(0) @binding(2) var<uniform> p: P;
struct V { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> V {
  var tri = array<vec2f,3>(vec2f(-1,-3), vec2f(3,1), vec2f(-1,1));
  let xy = tri[i]; var o: V; o.pos = vec4f(xy,0,1);
  o.uv = xy * vec2f(0.5,-0.5) + vec2f(0.5); return o;
}
@fragment fn fs(in: V) -> @location(0) vec4f {
  let px = vec2i(in.pos.xy);
  return vec4f(textureLoad(scene,px,0).rgb + textureLoad(bloom,px,0).rgb * p.strength, 1.0);
}`;

const TONEMAP_WGSL = `
struct P { ts: vec2f, threshold: f32, knee: f32, strength: f32, exposure: f32, pad: vec2f }
@group(0) @binding(0) var hdr: texture_2d<f32>;
@group(0) @binding(1) var<uniform> p: P;
struct V { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> V {
  var tri = array<vec2f,3>(vec2f(-1,-3), vec2f(3,1), vec2f(-1,1));
  let xy = tri[i]; var o: V; o.pos = vec4f(xy,0,1);
  o.uv = xy * vec2f(0.5,-0.5) + vec2f(0.5); return o;
}
fn aces(x: vec3f) -> vec3f {
  return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), vec3f(0), vec3f(1));
}
fn srgb(c: vec3f) -> vec3f {
  let lo = c*12.92;
  let hi = 1.055*pow(clamp(c,vec3f(0),vec3f(1)), vec3f(1.0/2.4))-0.055;
  return select(lo, hi, c > vec3f(0.0031308));
}
@fragment fn fs(in: V) -> @location(0) vec4f {
  return vec4f(srgb(aces(textureLoad(hdr,vec2i(in.pos.xy),0).rgb * p.exposure)), 1.0);
}`;

const adapter = await navigator.gpu.requestAdapter();
if (!adapter) {
  document.body.insertAdjacentHTML('afterbegin', '<p style="color:#ff8a84">No WebGPU adapter in this browser.</p>');
  throw new Error('no adapter');
}
const device = await adapter.requestDevice();
const context = (id) => document.getElementById(id).getContext('webgpu');
const fmt = navigator.gpu.getPreferredCanvasFormat();

function makeTex(w, h, usage) {
  return device.createTexture({ size: { width: w, height: h }, format: HDR, usage });
}
const TEX_USE = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT
  | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST;

function pipeline(code, entry, layout, target = HDR) {
  const module = device.createShaderModule({ code });
  return device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: entry, targets: [{ format: target }] },
    primitive: { topology: 'triangle-list' },
  });
}
function run(pass, bg, view, encoder) {
  const rp = encoder.beginRenderPass({
    colorAttachments: [{ view, loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: 'store' }],
  });
  rp.setPipeline(pass); rp.setBindGroup(0, bg); rp.draw(3); rp.end();
}

const oneTex = device.createBindGroupLayout({ entries: [
  { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float', format: HDR } },
  { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
] });
const twoTex = device.createBindGroupLayout({ entries: [
  { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float', format: HDR } },
  { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float', format: HDR } },
  { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
] });
const sceneLayout = device.createBindGroupLayout({ entries: [
  { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
] });

const scenePipe = pipeline(SCENE_WGSL, 'fs', sceneLayout);
const prePipe = pipeline(PREFILTER_WGSL, 'fs', oneTex);
const downNaive = pipeline(DOWN_WGSL, 'naive', oneTex);
const downImproved = pipeline(DOWN_WGSL, 'improved', oneTex);
const upNaive = pipeline(UP_WGSL, 'naive', twoTex);
const upImproved = pipeline(UP_WGSL, 'improved', twoTex);
const compPipe = pipeline(COMPOSITE_WGSL, 'fs', twoTex);
const tonePipe = pipeline(TONEMAP_WGSL, 'fs', oneTex, fmt);

const paramsBuf = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const sceneBuf = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const sceneTex = makeTex(W, H, TEX_USE);
const compositeTex = makeTex(W, H, TEX_USE);
const mips = Array.from({ length: MIPS }, (_, l) => {
  const w = W >> l, h = H >> l;
  return { w, h, down: makeTex(w, h, TEX_USE), up: makeTex(w, h, TEX_USE), scratch: makeTex(w, h, TEX_USE) };
});
const canvases = {
  naive: document.getElementById('naive'),
  improved: document.getElementById('improved'),
};
for (const c of Object.values(canvases)) {
  c.getContext('webgpu').configure({ device, format: fmt, alphaMode: 'opaque' });
}
const b1 = (tex) => device.createBindGroup({ layout: oneTex, entries: [
  { binding: 0, resource: tex.createView() }, { binding: 1, resource: { buffer: paramsBuf } }] });
const b2 = (a, b) => device.createBindGroup({ layout: twoTex, entries: [
  { binding: 0, resource: a.createView() }, { binding: 1, resource: b.createView() },
  { binding: 2, resource: { buffer: paramsBuf } }] });

function writeParams(w, h) {
  device.queue.writeBuffer(paramsBuf, 0, new Float32Array([
    1 / w, 1 / h, 1, 0.5, 1, 1, 0, 0, 0, 0, 0, 0,
  ]));
}

function renderFrame(lineX, variant, targetView) {
  const improved = variant === 'improved';
  device.queue.writeBuffer(sceneBuf, 0, new Float32Array([
    W, H, lineX, 1, 24, 0.18, 0, 0.55, 0.9, 1.35, 0,
  ]));
  const sceneBg = device.createBindGroup({ layout: sceneLayout, entries: [
    { binding: 0, resource: { buffer: sceneBuf } }] });
  const encoder = device.createCommandEncoder();
  run(scenePipe, sceneBg, sceneTex.createView(), encoder);
  writeParams(W, H);
  run(prePipe, b1(sceneTex), mips[0].down.createView(), encoder);
  for (let l = 1; l < MIPS; l += 1) {
    writeParams(mips[l - 1].w, mips[l - 1].h);
    run(improved ? downImproved : downNaive, b1(mips[l - 1].down), mips[l].down.createView(), encoder);
  }
  const last = MIPS - 1;
  encoder.copyTextureToTexture({ texture: mips[last].down }, { texture: mips[last].up },
    { width: mips[last].w, height: mips[last].h });
  for (let l = last - 1; l >= 0; l -= 1) {
    writeParams(mips[l].w, mips[l].h);
    run(improved ? upImproved : upNaive, b2(mips[l + 1].up, mips[l].down),
      mips[l].scratch.createView(), encoder);
    encoder.copyTextureToTexture({ texture: mips[l].scratch }, { texture: mips[l].up },
      { width: mips[l].w, height: mips[l].h });
  }
  writeParams(W, H);
  run(compPipe, b2(sceneTex, mips[0].up), compositeTex.createView(), encoder);
  run(tonePipe, b1(compositeTex), targetView, encoder);
  device.queue.submit([encoder.finish()]);
}

let lineX = 60;
let running = true;
document.getElementById('toggle').addEventListener('click', (e) => {
  running = !running;
  e.target.textContent = running ? '暂停' : '继续';
});
function tick() {
  if (running) {
    lineX += 0.25;
    if (lineX > W - 60) lineX = 60;
  }
  renderFrame(lineX, 'naive', canvases.naive.getContext('webgpu').getCurrentTexture().createView());
  renderFrame(lineX, 'improved', canvases.improved.getContext('webgpu').getCurrentTexture().createView());
  document.getElementById('naiveOut').textContent = `lineX = ${lineX.toFixed(2)} px\npoint-sample bloom`;
  document.getElementById('improvedOut').textContent = `lineX = ${lineX.toFixed(2)} px\narea-box bloom (energy stable)`;
  requestAnimationFrame(tick);
}
tick();
