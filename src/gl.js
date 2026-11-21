export function compileProgram(gl, vertexSource, fragmentSource, label = "program") {
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`${label} shader compile failed:\n${log}`);
    }
    return shader;
  };
  const vertex = compile(gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`${label} link failed:\n${log}`);
  }
  return program;
}

export function createMesh(gl, mesh) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const attach = (location, data, size) => {
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
  };
  attach(0, mesh.positions, 3);
  attach(1, mesh.normals, 3);
  attach(2, mesh.uvs, 2);
  attach(3, mesh.useAlpha, 1);
  gl.bindVertexArray(null);
  return { vao, count: mesh.vertexCount };
}

export function createSimpleMesh(gl, positions) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return { vao, count: positions.length / 3 };
}

export function createCoverageTexture(gl, mips) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  for (let i = 0; i < mips.length; i += 1) {
    const mip = mips[i];
    gl.texImage2D(
      gl.TEXTURE_2D, i, gl.R8, mip.width, mip.height, 0,
      gl.RED, gl.UNSIGNED_BYTE, mip.data,
    );
  }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const ext = gl.getExtension("EXT_texture_filter_anisotropic");
  let anisotropy = 1;
  if (ext) {
    const max = gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
    anisotropy = Math.min(8, max);
    gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, anisotropy);
  }
  gl.bindTexture(gl.TEXTURE_2D, null);
  return { texture, anisotropy, levels: mips.length };
}

export function createRenderTarget(gl, width, height, samples = 0) {
  const target = {
    gl,
    width: 0,
    height: 0,
    samples,
    fbo: gl.createFramebuffer(),
    resolveFbo: gl.createFramebuffer(),
    texture: gl.createTexture(),
    colorBuffer: null,
    depthBuffer: null,
  };

  target.resize = (nextWidth, nextHeight) => {
    if (target.width === nextWidth && target.height === nextHeight) return;
    target.width = Math.max(1, nextWidth);
    target.height = Math.max(1, nextHeight);
    if (target.colorBuffer) gl.deleteRenderbuffer(target.colorBuffer);
    if (target.depthBuffer) gl.deleteRenderbuffer(target.depthBuffer);
    target.colorBuffer = null;
    target.depthBuffer = null;

    if (samples > 1) {
      gl.bindRenderbuffer(gl.RENDERBUFFER, null);
      target.colorBuffer = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, target.colorBuffer);
      gl.renderbufferStorageMultisample(
        gl.RENDERBUFFER, samples, gl.RGBA8, target.width, target.height,
      );
      target.depthBuffer = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, target.depthBuffer);
      gl.renderbufferStorageMultisample(
        gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, target.width, target.height,
      );
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.framebufferRenderbuffer(
        gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, target.colorBuffer,
      );
      gl.framebufferRenderbuffer(
        gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, target.depthBuffer,
      );
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error(`Multisample framebuffer incomplete (${samples}x)`);
      }
    } else {
      gl.bindTexture(gl.TEXTURE_2D, target.texture);
      gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA8, target.width, target.height, 0,
        gl.RGBA, gl.UNSIGNED_BYTE, null,
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      target.depthBuffer = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, target.depthBuffer);
      gl.renderbufferStorage(
        gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, target.width, target.height,
      );
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.texture, 0,
      );
      gl.framebufferRenderbuffer(
        gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, target.depthBuffer,
      );
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error("Single-sample framebuffer incomplete");
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    gl.bindTexture(gl.TEXTURE_2D, target.texture);
    if (samples > 1) {
      gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA8, target.width, target.height, 0,
        gl.RGBA, gl.UNSIGNED_BYTE, null,
      );
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.resolveFbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.texture, 0,
    );
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("Resolve framebuffer incomplete");
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };

  target.bind = () => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, target.width, target.height);
  };

  target.resolve = () => {
    if (samples <= 1) return;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, target.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, target.resolveFbo);
    gl.blitFramebuffer(
      0, 0, target.width, target.height,
      0, 0, target.width, target.height,
      gl.COLOR_BUFFER_BIT, gl.NEAREST,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };

  target.resize(width, height);
  return target;
}

export function readTarget(gl, target) {
  target.resolve();
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.resolveFbo);
  const pixels = new Uint8Array(target.width * target.height * 4);
  gl.readPixels(0, 0, target.width, target.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return pixels;
}
