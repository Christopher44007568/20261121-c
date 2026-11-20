import * as THREE from "three";
import {
  clampRectToViewport,
  cssRectToBufferRect,
  decodeIdChannels,
  encodeIdChannels,
  formatPickId,
  MAX_PICK_ID,
  manifestFingerprint,
} from "./idCodec.js";

const ID_VERTEX_SHADER = /* glsl */ `
  uniform float uPickId;
  attribute float aPickId;
  varying float vPickId;
  varying vec2 vPickUv;

  void main() {
    #ifdef PICK_INSTANCED
      vPickId = aPickId;
    #else
      vPickId = uPickId;
    #endif
    vPickUv = uv;

    vec3 transformed = position;
    #ifdef USE_INSTANCING
      transformed = (instanceMatrix * vec4(transformed, 1.0)).xyz;
    #endif
    gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
  }
`;

const ID_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uAlphaMap;
  uniform float uUseAlphaMap;
  uniform float uAlphaCutoff;
  varying float vPickId;
  varying vec2 vPickUv;

  void main() {
    if (uUseAlphaMap > 0.5) {
      float alpha = texture2D(uAlphaMap, vPickUv).g;
      if (alpha < uAlphaCutoff) discard;
    }

    float id = floor(vPickId + 0.5);
    float red = mod(id, 256.0);
    float green = mod(floor(id / 256.0), 256.0);
    float blue = mod(floor(id / 65536.0), 256.0);
    gl_FragColor = vec4(red / 255.0, green / 255.0, blue / 255.0, 1.0);
  }
`;

function isDisplayLayer(entry) {
  return (
    entry.kind === "display" ||
    entry.mesh.userData.selectionLayer === "display" ||
    entry.mesh.parent?.userData.selectionLayer === "display"
  );
}

export class IdSelectionEngine {
  constructor({ viewer, onStale } = {}) {
    this.viewer = viewer;
    this.onStale = onStale;
    this.registry = new Map();
    this.pickables = viewer.assembly.pickables;
    this.idScene = new THREE.Scene();
    this.idRoot = new THREE.Group();
    this.idScene.add(this.idRoot);
    this.stateEpoch = 1;
    this.requestSeq = 0;
    this.staleDrops = 0;
    this.lastResult = null;
    this.lastStale = null;
    this.target = null;
    this.targetWidth = 0;
    this.targetHeight = 0;
    this.readLock = Promise.resolve();
    this.readMode = "SYNC";

    this.viewer.scene.updateMatrixWorld(true);
    this.buildRegistry();
    this.buildIdScene();

    this.viewer.onCameraChange(() => this.invalidate("camera"));
    this.viewer.onViewportChange(() => {
      this.invalidate("viewport");
      this.releaseTarget();
    });
  }

  buildRegistry() {
    let nextId = 1;
    this.descriptors = [];
    for (const entry of this.pickables) {
      if (isDisplayLayer(entry)) continue;
      const instanceCount = entry.instances?.length ?? 1;
      for (let index = 0; index < instanceCount; index += 1) {
        if (nextId > MAX_PICK_ID) {
          throw new Error("The pick registry exhausted the 24-bit object ID range.");
        }
        const instance = entry.instances?.[index];
        const descriptor = {
          pickId: nextId,
          pickIdLabel: formatPickId(nextId),
          encoded: encodeIdChannels(nextId),
          partId: `P-${String(nextId).padStart(3, "0")}`,
          name: instance?.name ?? entry.name,
          partName: entry.name,
          category: entry.category,
          color: entry.color,
          kind: entry.kind,
          sourceMesh: entry.mesh,
          instanceIndex: entry.instances ? index : null,
          instanceCount,
          alphaTest: entry.alphaTest ?? 0,
          selectable: true,
        };
        this.registry.set(nextId, descriptor);
        this.descriptors.push(descriptor);
        nextId += 1;
      }
    }
  }

  buildIdScene() {
    for (const entry of this.pickables) {
      if (isDisplayLayer(entry)) continue;
      if (entry.instances?.length) {
        this.addInstancedPickMesh(entry);
      } else {
        this.addRegularPickMesh(entry);
      }
    }
  }

  addRegularPickMesh(entry) {
    const descriptor = this.descriptors.find(
      (item) => item.sourceMesh === entry.mesh && item.instanceIndex === null,
    );
    if (!descriptor) return;

    const material = this.createIdMaterial({
      pickId: descriptor.pickId,
      entry,
      instanced: false,
    });
    const mesh = new THREE.Mesh(entry.mesh.geometry, material);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(entry.mesh.matrixWorld);
    mesh.frustumCulled = false;
    mesh.renderOrder = 0;
    this.idRoot.add(mesh);
  }

  addInstancedPickMesh(entry) {
    const descriptors = this.descriptors.filter((item) => item.sourceMesh === entry.mesh);
    if (descriptors.length === 0) return;

    const geometry = entry.mesh.geometry.clone();
    const pickIds = new Float32Array(descriptors.length);
    descriptors.forEach((descriptor, index) => {
      pickIds[index] = descriptor.pickId;
    });
    geometry.setAttribute("aPickId", new THREE.InstancedBufferAttribute(pickIds, 1));

    const material = this.createIdMaterial({
      pickId: descriptors[0].pickId,
      entry,
      instanced: true,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, descriptors.length);
    mesh.instanceMatrix.copy(entry.mesh.instanceMatrix);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(entry.mesh.matrixWorld);
    mesh.frustumCulled = false;
    this.idRoot.add(mesh);
  }

  createIdMaterial({ pickId, entry, instanced }) {
    const alphaMap = entry.alphaMap ?? entry.mesh.material?.alphaMap ?? null;
    const alphaCutoff = entry.alphaTest ?? entry.mesh.material?.alphaTest ?? 0;
    const material = new THREE.ShaderMaterial({
      defines: instanced ? { PICK_INSTANCED: "" } : {},
      uniforms: {
        uPickId: { value: pickId },
        uAlphaMap: { value: alphaMap },
        uUseAlphaMap: { value: alphaMap ? 1 : 0 },
        uAlphaCutoff: { value: alphaCutoff },
      },
      vertexShader: ID_VERTEX_SHADER,
      fragmentShader: ID_FRAGMENT_SHADER,
      side: entry.mesh.material?.side ?? THREE.FrontSide,
      transparent: false,
      depthTest: true,
      depthWrite: true,
      blending: THREE.NoBlending,
      toneMapped: false,
    });
    material.name = `ID material / ${entry.name}`;
    return material;
  }

  invalidate(reason) {
    this.stateEpoch += 1;
    this.epochReason = reason;
  }

  ensureTarget(width, height) {
    if (this.target && this.targetWidth === width && this.targetHeight === height) {
      return this.target;
    }
    this.target?.dispose();
    this.target = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
      samples: 0,
      generateMipmaps: false,
    });
    this.target.texture.colorSpace = THREE.NoColorSpace;
    this.target.texture.name = "object-id-target";
    this.targetWidth = width;
    this.targetHeight = height;
    return this.target;
  }

  releaseTarget() {
    this.targetWidth = 0;
    this.targetHeight = 0;
  }

  renderIdPass(target) {
    const renderer = this.viewer.renderer;
    const previousTarget = renderer.getRenderTarget();
    const previousClearColor = renderer.getClearColor(new THREE.Color());
    const previousClearAlpha = renderer.getClearAlpha();

    this.idScene.updateMatrixWorld(true);
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, false);
    renderer.render(this.idScene, this.viewer.camera);
    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(previousClearColor, previousClearAlpha);
  }

  async readPixels(target, x, y, width, height) {
    const buffer = new Uint8Array(width * height * 4);
    const renderer = this.viewer.renderer;
    let mode = "SYNC";
    let readError = null;

    if (typeof renderer.readRenderTargetPixelsAsync === "function") {
      try {
        mode = "ASYNC";
        await renderer.readRenderTargetPixelsAsync(target, x, y, width, height, buffer);
        this.readMode = "ASYNC";
      } catch (error) {
        readError = error;
        mode = "SYNC";
      }
    }

    if (mode === "SYNC") {
      renderer.readRenderTargetPixels(target, x, y, width, height, buffer);
      this.readMode = "SYNC";
    }

    return { buffer, mode, readError };
  }

  async selectRectangle(
    rectCss,
    { debugDelayMs = 0, debugAfterReadDelayMs = 0 } = {},
  ) {
    const requestId = ++this.requestSeq;
    const epoch = this.stateEpoch;
    const viewport = this.viewer.getViewportState();
    const clamped = clampRectToViewport(rectCss, {
      width: viewport.cssWidth,
      height: viewport.cssHeight,
    });

    if (clamped.width < 1 || clamped.height < 1) {
      return {
        empty: true,
        stale: false,
        hits: [],
        pixelCount: 0,
        requestId,
        epoch,
        viewport,
        rectCss: clamped,
      };
    }

    const bufferRect = cssRectToBufferRect(
      clamped,
      { width: viewport.cssWidth, height: viewport.cssHeight },
      { width: viewport.drawingWidth, height: viewport.drawingHeight },
    );

    const task = this.readLock.then(async () => {
      if (requestId !== this.requestSeq || epoch !== this.stateEpoch) {
        return this.makeStaleResult(requestId, epoch, "superseded-before-read");
      }

      const target = this.ensureTarget(viewport.drawingWidth, viewport.drawingHeight);
      this.renderIdPass(target);

      if (debugDelayMs > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, debugDelayMs));
      }

      if (requestId !== this.requestSeq || epoch !== this.stateEpoch) {
        return this.makeStaleResult(requestId, epoch, "invalidated-before-read");
      }

      const readStarted = performance.now();
      const read = await this.readPixels(
        target,
        bufferRect.x,
        bufferRect.y,
        bufferRect.width,
        bufferRect.height,
      );
      const readMs = performance.now() - readStarted;

      if (debugAfterReadDelayMs > 0) {
        await new Promise((resolve) =>
          window.setTimeout(resolve, debugAfterReadDelayMs),
        );
      }

      return { ...read, readMs };
    });

    this.readLock = task.then(
      () => undefined,
      () => undefined,
    );
    const read = await task;

    if (read.stale) {
      this.registerStale(read);
      return read;
    }

    if (requestId !== this.requestSeq || epoch !== this.stateEpoch) {
      const stale = this.makeStaleResult(requestId, epoch, "invalidated-after-read");
      this.registerStale(stale);
      return stale;
    }

    const result = this.decodeHits(read.buffer, bufferRect, {
      requestId,
      epoch,
      viewport,
      rectCss: clamped,
      readMode: read.mode,
      readMs: read.readMs,
    });
    this.lastResult = result;
    return result;
  }

  makeStaleResult(requestId, epoch, reason) {
    return {
      stale: true,
      empty: false,
      requestId,
      epoch,
      reason,
      currentEpoch: this.stateEpoch,
      currentRequestId: this.requestSeq,
      hits: [],
      pixelCount: 0,
    };
  }

  registerStale(stale) {
    this.staleDrops += 1;
    this.lastStale = {
      ...stale,
      detectedAt: performance.now(),
      currentEpoch: this.stateEpoch,
      currentRequestId: this.requestSeq,
    };
    this.onStale?.(this.lastStale);
  }

  decodeHits(buffer, bufferRect, context) {
    const counts = new Map();
    const pixelCount = buffer.length / 4;
    let nonEmptyPixels = 0;

    for (let index = 0; index < pixelCount; index += 1) {
      const byteOffset = index * 4;
      const red = buffer[byteOffset];
      const green = buffer[byteOffset + 1];
      const blue = buffer[byteOffset + 2];
      if (red === 0 && green === 0 && blue === 0) continue;

      nonEmptyPixels += 1;
      const pickId = decodeIdChannels(red, green, blue);
      const existing = counts.get(pickId);
      if (existing) {
        existing.pixelCount += 1;
        continue;
      }

      const localX = index % bufferRect.width;
      const localYFromBottom = Math.floor(index / bufferRect.width);
      counts.set(pickId, {
        pickId,
        pixelCount: 1,
        sampleBuffer: {
          x: bufferRect.x + localX,
          y: bufferRect.y + (bufferRect.height - 1 - localYFromBottom),
        },
        encodedInBuffer: [red, green, blue],
      });
    }

    const hits = [];
    for (const sampled of counts.values()) {
      const descriptor = this.registry.get(sampled.pickId);
      const roundTrip = decodeIdChannels(
        ...sampled.encodedInBuffer,
      ) === sampled.pickId;
      const registryMatch =
        !!descriptor &&
        descriptor.encoded.length === 3 &&
        descriptor.encoded[0] === sampled.encodedInBuffer[0] &&
        descriptor.encoded[1] === sampled.encodedInBuffer[1] &&
        descriptor.encoded[2] === sampled.encodedInBuffer[2];
      const visibleLayer = !!descriptor && descriptor.kind !== "display";
      const sourceVisible = !!descriptor?.sourceMesh?.visible;
      const verified =
        Boolean(descriptor) && roundTrip && registryMatch && visibleLayer && sourceVisible;

      hits.push({
        pickId: sampled.pickId,
        pickIdLabel: formatPickId(sampled.pickId),
        partId: descriptor?.partId ?? "UNMAPPED",
        name: descriptor?.name ?? "Unknown fragment",
        partName: descriptor?.partName ?? "Not present in pick registry",
        category: descriptor?.category ?? "Invalid",
        color: descriptor?.color ?? "#ff825c",
        kind: descriptor?.kind ?? "invalid",
        instanceIndex: descriptor?.instanceIndex ?? null,
        instanceCount: descriptor?.instanceCount ?? 0,
        pixelCount: sampled.pixelCount,
        sampleBuffer: sampled.sampleBuffer,
        sampleCss: {
          x: sampled.sampleBuffer.x / bufferRect.scaleX,
          y: sampled.sampleBuffer.y / bufferRect.scaleY,
        },
        verified,
        checks: {
          codecRoundTrip: roundTrip,
          registryMatch,
          visibleLayer,
          sourceVisible,
        },
        descriptor,
      });
    }

    hits.sort((left, right) => {
      if (right.pixelCount !== left.pixelCount) return right.pixelCount - left.pixelCount;
      return left.pickId - right.pickId;
    });

    const verifiedCount = hits.filter((hit) => hit.verified).length;
    const invalidPixels = hits
      .filter((hit) => !hit.verified)
      .reduce((total, hit) => total + hit.pixelCount, 0);
    const allVerified = hits.length > 0 && verifiedCount === hits.length;
    const fingerprint = manifestFingerprint(hits, nonEmptyPixels);

    return {
      stale: false,
      empty: false,
      requestId: context.requestId,
      epoch: context.epoch,
      viewport: context.viewport,
      rectCss: context.rectCss,
      bufferRect: {
        x: bufferRect.x,
        y: bufferRect.y,
        width: bufferRect.width,
        height: bufferRect.height,
        scaleX: bufferRect.scaleX,
        scaleY: bufferRect.scaleY,
      },
      hits,
      hitCount: hits.length,
      verifiedCount,
      allVerified,
      pixelCount: nonEmptyPixels,
      invalidPixels,
      fingerprint,
      readMode: context.readMode,
      readMs: context.readMs,
      completedAt: new Date().toISOString(),
    };
  }

  getStats() {
    return {
      epoch: this.stateEpoch,
      requestSeq: this.requestSeq,
      staleDrops: this.staleDrops,
      readMode: this.readMode,
      targetSize: this.target
        ? { width: this.targetWidth, height: this.targetHeight }
        : null,
      pickCount: this.registry.size,
      lastStale: this.lastStale,
    };
  }

  getDescriptors() {
    return [...this.descriptors];
  }

  dispose() {
    this.target?.dispose();
    this.idRoot.traverse((object) => {
      object.geometry?.dispose?.();
      object.material?.dispose?.();
    });
  }
}
