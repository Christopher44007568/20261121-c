// WebGPU droplet sphere tracing host.
const canvas = document.getElementById('gpu');
const ui = {
  sminMode: document.getElementById('sminMode'),
  viewMode: document.getElementById('viewMode'),
  sep: document.getElementById('sep'),
  k: document.getElementById('k'),
  shadow: document.getElementById('shadow'),
  animate: document.getElementById('animate'),
  stepMode: document.getElementById('stepMode'),
  omega: document.getElementById('omega'),
  omVal: document.getElementById('omVal'),
  stats: document.getElementById('stats'),
  sepVal: document.getElementById('sepVal'),
  kVal: document.getElementById('kVal'),
};

async function init() {
  if (!navigator.gpu) { ui.stats.textContent = 'WebGPU not supported'; return; }
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();
  const ctx = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'opaque' });

  const shader = await fetch('src/shader.wgsl').then(r => r.text());
  const module = device.createShaderModule({ code: shader });
  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module, entryPoint: 'vsMain' },
    fragment: { module, entryPoint: 'fsMain', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });

  const ubuf = device.createBuffer({
    size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const bind = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: ubuf } }],
  });

  // camera state: yaw/pitch/dist around origin
  const cam = { yaw: 0.6, pitch: 0.25, dist: 3.2 };
  document.getElementById('camOrbit').onclick = () => {
    cam.yaw = 0.6; cam.pitch = 0.25; cam.dist = 3.2;
  };
  document.getElementById('camGraze').onclick = () => {
    // near-tangent to the neck (x-axis between the droplets)
    cam.yaw = Math.PI / 2 + 0.12; cam.pitch = 0.03; cam.dist = 2.6;
  };
  canvas.addEventListener('pointermove', e => {
    if (e.buttons) { cam.yaw -= e.movementX * 0.005; cam.pitch += e.movementY * 0.005; }
  });
  canvas.addEventListener('wheel', e => {
    cam.dist = Math.min(8, Math.max(1.2, cam.dist * (1 + e.deltaY * 0.001)));
  });

  const params = new ArrayBuffer(112);
  const f32 = new Float32Array(params);
  const u32 = new Uint32Array(params);

  let frames = 0, tPrev = performance.now(), fps = 0;

  function frame() {
    const dpr = Math.min(devicePixelRatio, 2);
    const w = Math.floor(canvas.clientWidth * dpr);
    const hgt = Math.floor(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== hgt) {
      canvas.width = w; canvas.height = hgt;
    }
    const t = performance.now() / 1000;
    let sep = parseFloat(ui.sep.value);
    if (ui.animate.checked) sep = 1.1 - 0.45 * (0.5 + 0.5 * Math.sin(t * 0.8));
    ui.sepVal.textContent = sep.toFixed(2);
    ui.kVal.textContent = parseFloat(ui.k.value).toFixed(2);
    ui.omVal.textContent = parseFloat(ui.omega.value).toFixed(2);

    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const pos = [cam.dist * cp * Math.cos(cam.yaw),
                 cam.dist * sp,
                 cam.dist * cp * Math.sin(cam.yaw)];
    const fwd = norm3([-pos[0], -pos[1], -pos[2]]);
    const right = norm3(cross3(fwd, [0, 1, 0]));
    const up = cross3(right, fwd);

    f32[0] = w; f32[1] = hgt; f32[2] = t;
    f32[3] = sep; f32[4] = parseFloat(ui.k.value);
    u32[5] = +ui.sminMode.value; u32[6] = +ui.viewMode.value;
    u32[7] = ui.shadow.checked ? 1 : 0;
    f32.set(pos, 8); f32.set(right, 12); f32.set(up, 16); f32.set(fwd, 20);
    f32[23] = 1.8; // focal
    u32[24] = +ui.stepMode.value;
    f32[25] = parseFloat(ui.omega.value);
    device.queue.writeBuffer(ubuf, 0, params);

    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: ctx.getCurrentTexture().createView(),
        loadOp: 'clear', storeOp: 'store',
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
      }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bind);
    pass.draw(3);
    pass.end();
    device.queue.submit([enc.finish()]);

    frames++;
    const now = performance.now();
    if (now - tPrev > 500) {
      fps = frames * 1000 / (now - tPrev);
      frames = 0; tPrev = now;
      ui.stats.textContent =
        `${w}x${hgt}  ${fps.toFixed(1)} fps  ${(1000 / fps).toFixed(2)} ms`;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function cross3(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm3(a) {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

init().catch(e => { ui.stats.textContent = 'init failed: ' + e.message; });
