const SCENE_VERTEX = `#version 300 es
in vec3 aPosition;
in vec3 aNormal;
uniform mat4 uViewProjection;
out vec3 vWorld;
out vec3 vNormal;
void main() {
  vWorld = aPosition;
  vNormal = aNormal;
  gl_Position = uViewProjection * vec4(aPosition, 1.0);
}`;

const SCENE_FRAGMENT = `#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
uniform vec3 uColor;
uniform vec3 uCamera;
out vec4 outColor;
void main() {
  vec3 normal = normalize(vNormal);
  vec3 lightA = normalize(vec3(-0.45, 0.92, 0.58));
  vec3 lightB = normalize(vec3(0.72, 0.46, -0.5));
  float diffuseA = max(dot(normal, lightA), 0.0);
  float diffuseB = max(dot(normal, lightB), 0.0);
  vec3 viewDirection = normalize(uCamera - vWorld);
  vec3 halfDirection = normalize(lightA + viewDirection);
  float specular = pow(max(dot(normal, halfDirection), 0.0), 34.0) * 0.18;
  float upward = max(normal.y, 0.0);
  float lighting = 0.55 + diffuseA * 0.31 + diffuseB * 0.11 + upward * 0.07;
  vec3 color = uColor * lighting + vec3(specular);
  float rim = pow(1.0 - max(dot(normal, viewDirection), 0.0), 3.4);
  color += rim * vec3(0.12, 0.16, 0.18);
  float distanceToCamera = distance(vWorld, uCamera);
  float fog = smoothstep(38.0, 110.0, distanceToCamera);
  color = mix(color, vec3(0.83, 0.85, 0.86), fog * 0.34);
  outColor = vec4(color, 1.0);
}`;

const GROUND_VERTEX = `#version 300 es
in vec3 aPosition;
uniform mat4 uViewProjection;
out vec3 vWorld;
void main() {
  vWorld = aPosition;
  gl_Position = uViewProjection * vec4(aPosition, 1.0);
}`;

const GROUND_FRAGMENT = `#version 300 es
precision highp float;
in vec3 vWorld;
uniform vec3 uCamera;
out vec4 outColor;

float gridMask(vec2 point, float spacing) {
  vec2 scaled = point / spacing;
  vec2 width = fwidth(scaled);
  vec2 distanceToLine = abs(fract(scaled - 0.5) - 0.5) / max(width, vec2(0.0001));
  return 1.0 - min(min(distanceToLine.x, distanceToLine.y), 1.0);
}

void main() {
  vec3 base = vec3(0.824, 0.845, 0.858);
  float minor = gridMask(vWorld.xz, 2.0);
  float major = gridMask(vWorld.xz, 10.0);
  float horizon = smoothstep(25.0, 78.0, distance(vWorld.xz, uCamera.xz));
  vec3 color = mix(base, vec3(0.72, 0.75, 0.77), minor * 0.17);
  color = mix(color, vec3(0.68, 0.71, 0.73), major * 0.24);
  color = mix(color, vec3(0.89, 0.90, 0.91), horizon * 0.44);
  float innerGlow = 1.0 - smoothstep(0.0, 36.0, distance(vWorld.xz, vec2(0.2, -0.4)));
  color += innerGlow * 0.022;
  outColor = vec4(color, 1.0);
}`;

const EDGE_VERTEX = `#version 300 es
in vec3 aPosition;
uniform mat4 uViewProjection;
void main() {
  gl_Position = uViewProjection * vec4(aPosition, 1.0);
}`;

const EDGE_FRAGMENT = `#version 300 es
precision highp float;
uniform vec3 uColor;
out vec4 outColor;
void main() {
  outColor = vec4(uColor, 1.0);
}`;

const DEPTH_VERTEX = `#version 300 es
in vec3 aPosition;
uniform mat4 uViewProjection;
uniform vec3 uCamera;
out float vDistance;
void main() {
  vec4 world = vec4(aPosition, 1.0);
  vDistance = distance(aPosition, uCamera);
  gl_Position = uViewProjection * world;
}`;

const DEPTH_FRAGMENT = `#version 300 es
precision highp float;
in float vDistance;
uniform float uFar;
uniform float uOccupancy;
out vec4 outColor;
void main() {
  float normalized = clamp(vDistance / uFar, 0.0, 1.0);
  float r = floor(normalized * 255.0);
  float g = floor(fract(normalized * 255.0) * 255.0);
  float b = floor(fract(normalized * 65025.0) * 255.0);
  outColor = vec4(vec3(r, g, b) / 255.0, uOccupancy);
}`;

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compilation failed: ${message}`);
  }
  return shader;
}

function createProgram(gl, vertexSource, fragmentSource) {
  const program = gl.createProgram();
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Program link failed: ${gl.getProgramInfoLog(program)}`);
  }
  return program;
}

function uniforms(gl, program, names) {
  return Object.fromEntries(names.map((name) => [name, gl.getUniformLocation(program, name)]));
}

function attributes(gl, program, names) {
  return Object.fromEntries(names.map((name) => [name, gl.getAttribLocation(program, name)]));
}

function createBuffer(gl, target, data, usage = gl.STATIC_DRAW) {
  const buffer = gl.createBuffer();
  gl.bindBuffer(target, buffer);
  gl.bufferData(target, data, usage);
  return buffer;
}

export class TechnicalRenderer {
  constructor(canvas) {
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: true,
      depth: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error("WebGL2 is required for this viewer.");

    this.canvas = canvas;
    this.gl = gl;
    this.sceneProgram = createProgram(gl, SCENE_VERTEX, SCENE_FRAGMENT);
    this.sceneUniforms = uniforms(gl, this.sceneProgram, ["uViewProjection", "uColor", "uCamera"]);
    this.sceneAttributes = attributes(gl, this.sceneProgram, ["aPosition", "aNormal"]);
    this.groundProgram = createProgram(gl, GROUND_VERTEX, GROUND_FRAGMENT);
    this.groundUniforms = uniforms(gl, this.groundProgram, ["uViewProjection", "uCamera"]);
    this.groundAttributes = attributes(gl, this.groundProgram, ["aPosition"]);
    this.edgeProgram = createProgram(gl, EDGE_VERTEX, EDGE_FRAGMENT);
    this.edgeUniforms = uniforms(gl, this.edgeProgram, ["uViewProjection", "uColor"]);
    this.edgeAttributes = attributes(gl, this.edgeProgram, ["aPosition"]);
    this.depthProgram = createProgram(gl, DEPTH_VERTEX, DEPTH_FRAGMENT);
    this.depthUniforms = uniforms(gl, this.depthProgram, ["uViewProjection", "uCamera", "uFar", "uOccupancy"]);
    this.depthAttributes = attributes(gl, this.depthProgram, ["aPosition"]);
    this.meshCache = new WeakMap();
    this.probe = { width: 0, height: 0, framebuffer: null, texture: null, depth: null, pixels: null };
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.disposed = false;
  }

  resize(width, height, dpr) {
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    this.dpr = Math.max(1, Math.min(dpr, 3));
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ensureProbe(this.width, this.height);
  }

  ensureProbe(width, height) {
    if (this.probe.width === width && this.probe.height === height) return;
    const gl = this.gl;
    if (this.probe.framebuffer) {
      gl.deleteFramebuffer(this.probe.framebuffer);
      gl.deleteTexture(this.probe.texture);
      gl.deleteRenderbuffer(this.probe.depth);
    }
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("Depth probe framebuffer is incomplete.");
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.probe = {
      width,
      height,
      framebuffer,
      texture,
      depth,
      pixels: new Uint8Array(width * height * 4),
    };
  }

  meshBuffers(mesh) {
    let cached = this.meshCache.get(mesh);
    if (cached) return cached;
    const gl = this.gl;
    cached = {
      position: createBuffer(gl, gl.ARRAY_BUFFER, mesh.positions),
      normal: createBuffer(gl, gl.ARRAY_BUFFER, mesh.normals),
      index: createBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, mesh.indices),
      edges: mesh.edgeVertices.length
        ? createBuffer(gl, gl.ARRAY_BUFFER, mesh.edgeVertices)
        : null,
      indexType: mesh.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
      indexCount: mesh.indices.length,
      edgeCount: mesh.edgeVertices.length / 3,
    };
    this.meshCache.set(mesh, cached);
    return cached;
  }

  drawMesh(mesh, program, positionAttribute, normalAttribute, viewProjection, color, camera) {
    const gl = this.gl;
    const buffers = this.meshBuffers(mesh);
    gl.useProgram(program);
    gl.uniformMatrix4fv(this.sceneUniforms.uViewProjection, false, viewProjection);
    gl.uniform3fv(this.sceneUniforms.uCamera, camera);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position);
    gl.enableVertexAttribArray(positionAttribute);
    gl.vertexAttribPointer(positionAttribute, 3, gl.FLOAT, false, 0, 0);
    if (normalAttribute >= 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.normal);
      gl.enableVertexAttribArray(normalAttribute);
      gl.vertexAttribPointer(normalAttribute, 3, gl.FLOAT, false, 0, 0);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.index);
    if (color) gl.uniform3fv(this.sceneUniforms.uColor, color);
    gl.drawElements(gl.TRIANGLES, buffers.indexCount, buffers.indexType, 0);
  }

  drawEdges(mesh, viewProjection, color) {
    const gl = this.gl;
    const buffers = this.meshBuffers(mesh);
    if (!buffers.edges) return;
    gl.useProgram(this.edgeProgram);
    gl.uniformMatrix4fv(this.edgeUniforms.uViewProjection, false, viewProjection);
    gl.uniform3fv(this.edgeUniforms.uColor, color);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.edges);
    gl.enableVertexAttribArray(this.edgeAttributes.aPosition);
    gl.vertexAttribPointer(this.edgeAttributes.aPosition, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.LINES, 0, buffers.edgeCount);
  }

  render(scene, camera, viewProjection) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    this.drawGround(scene.ground, camera, viewProjection);
    for (const [part, meshes] of Object.entries(scene.parts)) {
      for (const item of meshes) {
        this.drawMesh(
          item.mesh,
          this.sceneProgram,
          this.sceneAttributes.aPosition,
          this.sceneAttributes.aNormal,
          viewProjection,
          item.color,
          camera.eye,
        );
      }
      for (const item of meshes) this.drawEdges(item.mesh, viewProjection, item.edge);
    }
  }

  drawGround(mesh, camera, viewProjection) {
    const gl = this.gl;
    const buffers = this.meshBuffers(mesh);
    gl.useProgram(this.groundProgram);
    gl.uniformMatrix4fv(this.groundUniforms.uViewProjection, false, viewProjection);
    gl.uniform3fv(this.groundUniforms.uCamera, camera.eye);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position);
    gl.enableVertexAttribArray(this.groundAttributes.aPosition);
    gl.vertexAttribPointer(this.groundAttributes.aPosition, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.index);
    gl.drawElements(gl.TRIANGLES, buffers.indexCount, buffers.indexType, 0);
  }

  drawDepthMesh(mesh, camera, viewProjection, occupancy) {
    const gl = this.gl;
    const buffers = this.meshBuffers(mesh);
    gl.useProgram(this.depthProgram);
    gl.uniformMatrix4fv(this.depthUniforms.uViewProjection, false, viewProjection);
    gl.uniform3fv(this.depthUniforms.uCamera, camera.eye);
    gl.uniform1f(this.depthUniforms.uFar, camera.far);
    gl.uniform1f(this.depthUniforms.uOccupancy, occupancy);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position);
    gl.enableVertexAttribArray(this.depthAttributes.aPosition);
    gl.vertexAttribPointer(this.depthAttributes.aPosition, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.index);
    gl.drawElements(gl.TRIANGLES, buffers.indexCount, buffers.indexType, 0);
  }

  probeDepth(scene, camera, viewProjection) {
    const gl = this.gl;
    const probe = this.probe;
    gl.bindFramebuffer(gl.FRAMEBUFFER, probe.framebuffer);
    gl.viewport(0, 0, probe.width, probe.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.drawDepthMesh(scene.ground, camera, viewProjection, 0);
    for (const meshes of Object.values(scene.parts)) {
      for (const item of meshes) this.drawDepthMesh(item.mesh, camera, viewProjection, 1);
    }
    gl.readPixels(0, 0, probe.width, probe.height, gl.RGBA, gl.UNSIGNED_BYTE, probe.pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const result = {
      ...probe,
      distanceField: this.buildDistanceField(probe.pixels, probe.width, probe.height),
    };
    result.sampleAt = (x, y) => this.sampleDepth(result, x, y);
    return result;
  }

  sampleDepth(probe, x, y) {
    const px = Math.max(0, Math.min(probe.width - 1, Math.floor(x)));
    const py = Math.max(0, Math.min(probe.height - 1, Math.floor(y)));
    const index = ((probe.height - 1 - py) * probe.width + px) * 4;
    const r = probe.pixels[index];
    const g = probe.pixels[index + 1];
    const b = probe.pixels[index + 2];
    const occupancy = probe.pixels[index + 3];
    const encoded = r + g / 255 + b / 65025;
    return {
      distance: occupancy > 0 ? (encoded / 255) * 180 : Infinity,
      occupancy,
      distanceField: probe.distanceField[py * probe.width + px],
    };
  }

  buildDistanceField(pixels, width, height) {
    const count = width * height;
    const field = new Float32Array(count);
    const large = 9999;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pixelIndex = ((height - 1 - y) * width + x) * 4 + 3;
        field[y * width + x] = pixels[pixelIndex] > 96 ? 0 : large;
      }
    }
    const diagonal = Math.SQRT2;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        let value = field[index];
        if (x > 0) value = Math.min(value, field[index - 1] + 1);
        if (y > 0) {
          value = Math.min(value, field[index - width] + 1);
          if (x > 0) value = Math.min(value, field[index - width - 1] + diagonal);
          if (x + 1 < width) value = Math.min(value, field[index - width + 1] + diagonal);
        }
        field[index] = value;
      }
    }
    for (let y = height - 1; y >= 0; y -= 1) {
      for (let x = width - 1; x >= 0; x -= 1) {
        const index = y * width + x;
        let value = field[index];
        if (x + 1 < width) value = Math.min(value, field[index + 1] + 1);
        if (y + 1 < height) {
          value = Math.min(value, field[index + width] + 1);
          if (x + 1 < width) value = Math.min(value, field[index + width + 1] + diagonal);
          if (x > 0) value = Math.min(value, field[index + width - 1] + diagonal);
        }
        field[index] = value;
      }
    }
    return field;
  }

  project(point, viewProjection) {
    return this.projectToSize(point, viewProjection, this.width, this.height);
  }

  projectToSize(point, viewProjection, width, height) {
    const [x, y, z, w] = [
      viewProjection[0] * point[0] + viewProjection[4] * point[1] + viewProjection[8] * point[2] + viewProjection[12],
      viewProjection[1] * point[0] + viewProjection[5] * point[1] + viewProjection[9] * point[2] + viewProjection[13],
      viewProjection[2] * point[0] + viewProjection[6] * point[1] + viewProjection[10] * point[2] + viewProjection[14],
      viewProjection[3] * point[0] + viewProjection[7] * point[1] + viewProjection[11] * point[2] + viewProjection[15],
    ];
    return {
      x: (x / w * 0.5 + 0.5) * width,
      y: (1 - (y / w * 0.5 + 0.5)) * height,
      z,
      w,
    };
  }
}
