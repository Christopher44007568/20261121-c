// Headless-friendly WebGPU bootstrap. Uses the Dawn `webgpu` npm binding
// when running under Node; in a browser the native navigator.gpu is used.

async function createDevice({ backend, dawnFeatures } = {}) {
  let gpu;
  const inBrowser = typeof globalThis.window !== 'undefined'
    && typeof globalThis.navigator !== 'undefined'
    && globalThis.navigator.gpu;
  if (inBrowser) {
    gpu = globalThis.navigator.gpu;
  } else {
    const webgpu = require('webgpu');
    Object.assign(globalThis, webgpu.globals);
    const options = [];
    if (backend) {
      options.push(`backend=${backend}`);
    }
    // The llvmpipe Vulkan driver under WSL2 races inside Dawn's default
    // fence and resource-suballocation paths. These toggles move completion
    // handling onto polling and give each resource its own allocation,
    // which is stable in this container.
    const features = dawnFeatures ?? [
      'disable_fence',
      'use_unmonitored_fence',
      'disable_resource_suballocation',
    ];
    if (features.length > 0) {
      options.push(`enable-dawn-features=${features.join(',')}`);
    }
    gpu = webgpu.create(options);
    // Node 24 ships a stub `globalThis.navigator` (Navigator {}). Reusing
    // it and only tacking on `.gpu` leaves Dawn's globals in an inconsistent
    // state that later crashes the llvmpipe completion path; replace it.
    delete globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', {
      value: { gpu },
      writable: true,
      configurable: true,
    });
  }

  const adapter = await gpu.requestAdapter();
  if (!adapter) {
    throw new Error('no WebGPU adapter available');
  }
  const device = await adapter.requestDevice();
  device.addEventListener('uncapturederror', (event) => {
    // Surface validation errors without throwing across the native event
    // boundary (that aborts the process in the Dawn Node binding).
    console.error('[WebGPU uncaptured error]', event.error?.message ?? event.error);
  });
  return { gpu, adapter, device };
}

module.exports = { createDevice };
