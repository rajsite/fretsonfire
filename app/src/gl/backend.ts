// WebGL2 executor for the Python fixed-function emulation (python/OpenGL/GL/__init__.py).
// The command encoding here must match the OP_* / F_* constants on the Python side.

const OP_DRAW = 1;
const OP_VIEWPORT = 2;
const OP_SCISSOR = 3;
const OP_CLEAR = 4;
const OP_DELETE_TEXTURE = 5;
const OP_DELETE_STATIC = 6;

const F_BLEND = 1;
const F_DEPTH_TEST = 2;
const F_DEPTH_MASK = 4;
const F_TEXTURE = 8;
const F_CULL = 16;
const F_LIGHTING = 32;
const F_COLOR_MATERIAL = 64;
const F_SCISSOR = 128;
const F_VCOLOR = 256;
const F_VTEX = 512;
const F_VNORMAL = 1024;
const F_TEXMATRIX = 2048;
const F_STATIC = 4096;
const F_NORMALIZE = 8192;

const GL_REPLACE = 0x1e01;
const GL_INTENSITY = 0x8049;
const GL_INTENSITY8 = 0x804b;

const VERTEX_FLOATS = 12;
const STRIDE = VERTEX_FLOATS * 4;
const MAX_LIGHTS = 8;

const TEX_RGBA = 0;
const TEX_INTENSITY = 1;

const VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec4 aColor;
layout(location = 2) in vec2 aTex;
layout(location = 3) in vec3 aNormal;
uniform mat4 uMVP;
uniform mat4 uTexMatrix;
uniform mat3 uNormalMatrix;
uniform bool uLighting;
uniform bool uColorMaterial;
uniform bool uNormalize;
uniform vec4 uSceneAmbient;
uniform vec4 uMatAmbient;
uniform vec4 uMatDiffuse;
uniform int uNumLights;
uniform vec3 uLightDir[${MAX_LIGHTS}];
uniform vec4 uLightDiffuse[${MAX_LIGHTS}];
uniform vec4 uLightAmbient[${MAX_LIGHTS}];
out vec4 vColor;
out vec2 vTex;
void main() {
  gl_Position = uMVP * vec4(aPos, 1.0);
  vTex = (uTexMatrix * vec4(aTex, 0.0, 1.0)).xy;
  if (uLighting) {
    vec4 ambient = uColorMaterial ? aColor : uMatAmbient;
    vec4 diffuse = uColorMaterial ? aColor : uMatDiffuse;
    vec3 n = uNormalMatrix * aNormal;
    if (uNormalize) n = normalize(n);
    vec3 c = ambient.rgb * uSceneAmbient.rgb;
    for (int i = 0; i < ${MAX_LIGHTS}; i++) {
      if (i >= uNumLights) break;
      c += ambient.rgb * uLightAmbient[i].rgb + max(dot(n, uLightDir[i]), 0.0) * diffuse.rgb * uLightDiffuse[i].rgb;
    }
    vColor = vec4(clamp(c, 0.0, 1.0), diffuse.a);
  } else {
    vColor = aColor;
  }
}`;

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;
in vec4 vColor;
in vec2 vTex;
uniform bool uTexture;
uniform bool uReplace;
uniform int uTexFormat;
uniform sampler2D uSampler;
out vec4 fragColor;
void main() {
  vec4 c = vColor;
  if (uTexture) {
    vec4 t = texture(uSampler, vTex);
    if (uTexFormat == ${TEX_INTENSITY}) t = vec4(t.r);
    c = uReplace ? t : c * t;
  }
  fragColor = c;
}`;

interface TextureInfo {
  texture: WebGLTexture;
  format: number;
}

type PyBufferProxy = {
  getBuffer(type?: string): { data: ArrayBufferView & ArrayLike<number>; release(): void };
};

function bufferOf<T extends ArrayBufferView>(proxy: PyBufferProxy | ArrayBufferView, type: string): { data: T; release(): void } {
  if (ArrayBuffer.isView(proxy)) return { data: proxy as T, release() {} };
  const buf = proxy.getBuffer(type);
  return { data: buf.data as unknown as T, release: () => buf.release() };
}

export interface GLStats {
  frames: number;
  draws: number;
  vertices: number;
  lastFrameMs: number;
}

export class GLBackend {
  readonly gl: WebGL2RenderingContext;
  readonly stats: GLStats = { frames: 0, draws: 0, vertices: 0, lastFrameMs: 0 };
  private program: WebGLProgram;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private dynamicVbo: WebGLBuffer;
  private dynamicVao: WebGLVertexArrayObject;
  private staticVbos = new Map<number, { buffer: WebGLBuffer; vao: WebGLVertexArrayObject }>();
  private textures = new Map<number, TextureInfo>();

  // Cached GL state to avoid redundant calls.
  private cur = {
    flags: -1,
    blendSrc: -1,
    blendDst: -1,
    texture: -1,
    texFormat: -1,
    texEnv: -1,
    vao: null as WebGLVertexArrayObject | null,
    numLights: -1,
  };
  // Last uploaded float uniforms: meshes like the song chooser's cassettes issue hundreds of lit draws a frame.
  private uniformValues = new Map<string, Float32Array>();
  private lightDirs = new Float32Array(MAX_LIGHTS * 3);
  private lightDiffuse = new Float32Array(MAX_LIGHTS * 4);
  private lightAmbient = new Float32Array(MAX_LIGHTS * 4);

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: true,
      depth: true,
      stencil: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.program = this.createProgram();
    for (const name of [
      'uMVP', 'uTexMatrix', 'uNormalMatrix', 'uLighting', 'uColorMaterial', 'uNormalize', 'uSceneAmbient',
      'uMatAmbient', 'uMatDiffuse', 'uNumLights', 'uLightDir', 'uLightDiffuse', 'uLightAmbient',
      'uTexture', 'uReplace', 'uTexFormat', 'uSampler',
    ]) {
      this.u[name] = gl.getUniformLocation(this.program, name);
    }
    gl.useProgram(this.program);
    gl.uniform1i(this.u.uSampler, 0);
    this.dynamicVbo = gl.createBuffer()!;
    this.dynamicVao = this.createVao(this.dynamicVbo);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  }

  private createProgram(): WebGLProgram {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error');
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link error');
    return p;
  }

  private createVao(buffer: WebGLBuffer): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, STRIDE, 0);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, STRIDE, 12);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, STRIDE, 28);
    gl.vertexAttribPointer(3, 3, gl.FLOAT, false, STRIDE, 36);
    gl.enableVertexAttribArray(0);
    gl.bindVertexArray(null);
    return vao;
  }

  // --- Called from Python ---------------------------------------------------

  init(width: number, height: number): void {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  createTexture(id: number): void {
    const gl = this.gl;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR);
    this.textures.set(id, { texture, format: TEX_RGBA });
    this.cur.texture = -1;
  }

  private bindForUpload(id: number): TextureInfo | undefined {
    const info = this.textures.get(id);
    if (!info) return undefined;
    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, info.texture);
    this.cur.texture = -1;
    return info;
  }

  texParameter(id: number, pname: number, value: number): void {
    if (!this.bindForUpload(id)) return;
    this.gl.texParameteri(this.gl.TEXTURE_2D, pname, value);
  }

  pixelStorei(pname: number, value: number): void {
    this.gl.pixelStorei(pname, value);
  }

  texImage2D(id: number, level: number, internalFormat: number, width: number, height: number, format: number, data: PyBufferProxy | null): void {
    const info = this.bindForUpload(id);
    if (!info) return;
    const gl = this.gl;
    info.format = internalFormat === GL_INTENSITY || internalFormat === GL_INTENSITY8 ? TEX_INTENSITY : TEX_RGBA;
    if (data === null || data === undefined) {
      gl.texImage2D(gl.TEXTURE_2D, level, format, width, height, 0, format, gl.UNSIGNED_BYTE, null);
      return;
    }
    const buf = bufferOf<Uint8Array>(data, 'u8');
    try {
      const bytes = new Uint8Array(buf.data.buffer, buf.data.byteOffset, buf.data.byteLength);
      gl.texImage2D(gl.TEXTURE_2D, level, format, width, height, 0, format, gl.UNSIGNED_BYTE, bytes);
    } finally {
      buf.release();
    }
  }

  texSubImage2D(id: number, level: number, x: number, y: number, width: number, height: number, format: number, data: PyBufferProxy): void {
    if (!this.bindForUpload(id)) return;
    const gl = this.gl;
    const buf = bufferOf<Uint8Array>(data, 'u8');
    try {
      const bytes = new Uint8Array(buf.data.buffer, buf.data.byteOffset, buf.data.byteLength);
      gl.texSubImage2D(gl.TEXTURE_2D, level, x, y, width, height, format, gl.UNSIGNED_BYTE, bytes);
    } finally {
      buf.release();
    }
  }

  generateMipmap(id: number): void {
    if (!this.bindForUpload(id)) return;
    this.gl.generateMipmap(this.gl.TEXTURE_2D);
  }

  createStatic(id: number, vertices: PyBufferProxy): void {
    const gl = this.gl;
    const buffer = gl.createBuffer()!;
    const buf = bufferOf<Float32Array>(vertices, 'f32');
    try {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, buf.data, gl.STATIC_DRAW);
    } finally {
      buf.release();
    }
    this.staticVbos.set(id, { buffer, vao: this.createVao(buffer) });
    this.cur.vao = null;
  }

  executeFrame(arena: PyBufferProxy, commands: PyBufferProxy, length: number): void {
    const t0 = performance.now();
    const gl = this.gl;
    const a = bufferOf<Float32Array>(arena, 'f32');
    const c = bufferOf<Float32Array>(commands, 'f32');
    try {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.dynamicVbo);
      gl.bufferData(gl.ARRAY_BUFFER, a.data, gl.STREAM_DRAW);
      this.stats.vertices = a.data.length / VERTEX_FLOATS;
      this.run(c.data, length);
    } finally {
      a.release();
      c.release();
    }
    this.stats.frames++;
    this.stats.lastFrameMs = performance.now() - t0;
  }

  // --- Command execution ----------------------------------------------------

  private uniform(name: string, kind: 'm4' | 'm3' | 'v4' | 'v3', data: Float32Array, offset: number, length: number): void {
    let last = this.uniformValues.get(name);
    if (last) {
      let k = 0;
      while (k < length && last[k] === data[offset + k]) k++;
      if (k === length) return;
    } else {
      last = new Float32Array(length);
      this.uniformValues.set(name, last);
    }
    last.set(data.subarray(offset, offset + length));
    const gl = this.gl;
    const loc = this.u[name];
    if (kind === 'm4') gl.uniformMatrix4fv(loc, false, last);
    else if (kind === 'm3') gl.uniformMatrix3fv(loc, false, last);
    else if (kind === 'v4') gl.uniform4fv(loc, last);
    else gl.uniform3fv(loc, last);
  }

  private setFlags(flags: number): void {
    const gl = this.gl;
    const changed = flags ^ this.cur.flags;
    if (this.cur.flags === -1 || changed & F_BLEND) flags & F_BLEND ? gl.enable(gl.BLEND) : gl.disable(gl.BLEND);
    if (this.cur.flags === -1 || changed & F_DEPTH_TEST) flags & F_DEPTH_TEST ? gl.enable(gl.DEPTH_TEST) : gl.disable(gl.DEPTH_TEST);
    if (this.cur.flags === -1 || changed & F_DEPTH_MASK) gl.depthMask(!!(flags & F_DEPTH_MASK));
    if (this.cur.flags === -1 || changed & F_CULL) flags & F_CULL ? gl.enable(gl.CULL_FACE) : gl.disable(gl.CULL_FACE);
    if (this.cur.flags === -1 || changed & F_SCISSOR) flags & F_SCISSOR ? gl.enable(gl.SCISSOR_TEST) : gl.disable(gl.SCISSOR_TEST);
    if (this.cur.flags === -1 || changed & F_LIGHTING) gl.uniform1i(this.u.uLighting, flags & F_LIGHTING ? 1 : 0);
    if (this.cur.flags === -1 || changed & F_COLOR_MATERIAL) gl.uniform1i(this.u.uColorMaterial, flags & F_COLOR_MATERIAL ? 1 : 0);
    if (this.cur.flags === -1 || changed & F_NORMALIZE) gl.uniform1i(this.u.uNormalize, flags & F_NORMALIZE ? 1 : 0);
    if (this.cur.flags === -1 || changed & F_TEXTURE) gl.uniform1i(this.u.uTexture, flags & F_TEXTURE ? 1 : 0);
    if (this.cur.flags === -1 || changed & F_VCOLOR) flags & F_VCOLOR ? gl.enableVertexAttribArray(1) : gl.disableVertexAttribArray(1);
    if (this.cur.flags === -1 || changed & F_VTEX) flags & F_VTEX ? gl.enableVertexAttribArray(2) : gl.disableVertexAttribArray(2);
    if (this.cur.flags === -1 || changed & F_VNORMAL) flags & F_VNORMAL ? gl.enableVertexAttribArray(3) : gl.disableVertexAttribArray(3);
    this.cur.flags = flags;
  }

  private bindVao(vao: WebGLVertexArrayObject): void {
    if (this.cur.vao === vao) return;
    const gl = this.gl;
    gl.bindVertexArray(vao);
    this.cur.vao = vao;
    // Attribute array enables are per-VAO state, so force them to be re-applied.
    const flags = this.cur.flags;
    gl.enableVertexAttribArray(0);
    flags & F_VCOLOR ? gl.enableVertexAttribArray(1) : gl.disableVertexAttribArray(1);
    flags & F_VTEX ? gl.enableVertexAttribArray(2) : gl.disableVertexAttribArray(2);
    flags & F_VNORMAL ? gl.enableVertexAttribArray(3) : gl.disableVertexAttribArray(3);
  }

  private run(cmd: Float32Array, length: number): void {
    const gl = this.gl;
    let draws = 0;
    let i = 0;
    while (i < length) {
      const op = cmd[i];
      switch (op) {
        case OP_DRAW: {
          const mode = cmd[i + 1];
          const first = cmd[i + 2];
          const count = cmd[i + 3];
          const flags = cmd[i + 4];
          const blendSrc = cmd[i + 5];
          const blendDst = cmd[i + 6];
          const texId = cmd[i + 7];
          const texEnv = cmd[i + 8];
          const vbo = cmd[i + 9];
          i += 10;

          const vao = flags & F_STATIC ? this.staticVbos.get(vbo)?.vao : this.dynamicVao;
          if (vao) this.bindVao(vao);
          this.setFlags(flags);
          // Attributes that are not per-vertex use the current value, like fixed-function GL.
          if (!(flags & F_VCOLOR)) gl.vertexAttrib4f(1, cmd[i], cmd[i + 1], cmd[i + 2], cmd[i + 3]);
          if (!(flags & F_VTEX)) gl.vertexAttrib2f(2, cmd[i + 4], cmd[i + 5]);
          if (!(flags & F_VNORMAL)) gl.vertexAttrib3f(3, cmd[i + 6], cmd[i + 7], cmd[i + 8]);
          i += 9;
          this.uniform('uMVP', 'm4', cmd, i, 16);
          i += 16;

          if (flags & F_BLEND && (blendSrc !== this.cur.blendSrc || blendDst !== this.cur.blendDst)) {
            gl.blendFunc(blendSrc, blendDst);
            this.cur.blendSrc = blendSrc;
            this.cur.blendDst = blendDst;
          }
          if (flags & F_TEXTURE) {
            const info = this.textures.get(texId);
            if (texId !== this.cur.texture) {
              gl.activeTexture(gl.TEXTURE0);
              gl.bindTexture(gl.TEXTURE_2D, info ? info.texture : null);
              this.cur.texture = texId;
            }
            const format = info ? info.format : TEX_RGBA;
            if (format !== this.cur.texFormat) {
              gl.uniform1i(this.u.uTexFormat, format);
              this.cur.texFormat = format;
            }
            if (texEnv !== this.cur.texEnv) {
              gl.uniform1i(this.u.uReplace, texEnv === GL_REPLACE ? 1 : 0);
              this.cur.texEnv = texEnv;
            }
          }
          if (flags & F_TEXMATRIX) {
            this.uniform('uTexMatrix', 'm4', cmd, i, 16);
            i += 16;
          } else {
            this.uniform('uTexMatrix', 'm4', IDENTITY, 0, 16);
          }
          if (flags & F_LIGHTING) {
            this.uniform('uNormalMatrix', 'm3', cmd, i, 9);
            i += 9;
            this.uniform('uSceneAmbient', 'v4', cmd, i, 4);
            this.uniform('uMatAmbient', 'v4', cmd, i + 4, 4);
            this.uniform('uMatDiffuse', 'v4', cmd, i + 8, 4);
            i += 12;
            const n = cmd[i++];
            if (n !== this.cur.numLights) {
              gl.uniform1i(this.u.uNumLights, n);
              this.cur.numLights = n;
            }
            const { lightDirs: dirs, lightDiffuse: diffuse, lightAmbient: ambient } = this;
            dirs.fill(0);
            diffuse.fill(0);
            ambient.fill(0);
            for (let l = 0; l < n; l++) {
              dirs.set(cmd.subarray(i, i + 3), l * 3);
              diffuse.set(cmd.subarray(i + 3, i + 7), l * 4);
              ambient.set(cmd.subarray(i + 7, i + 11), l * 4);
              i += 11;
            }
            this.uniform('uLightDir', 'v3', dirs, 0, dirs.length);
            this.uniform('uLightDiffuse', 'v4', diffuse, 0, diffuse.length);
            this.uniform('uLightAmbient', 'v4', ambient, 0, ambient.length);
          }
          if (vao) {
            gl.drawArrays(mode, first, count);
            draws++;
          }
          break;
        }
        case OP_VIEWPORT:
          gl.viewport(cmd[i + 1], cmd[i + 2], cmd[i + 3], cmd[i + 4]);
          i += 5;
          break;
        case OP_SCISSOR:
          gl.scissor(cmd[i + 1], cmd[i + 2], cmd[i + 3], cmd[i + 4]);
          i += 5;
          break;
        case OP_CLEAR: {
          const mask = cmd[i + 1];
          gl.clearColor(cmd[i + 2], cmd[i + 3], cmd[i + 4], cmd[i + 5]);
          const scissor = cmd[i + 6] ? F_SCISSOR : 0;
          const depthMask = cmd[i + 7] ? F_DEPTH_MASK : 0;
          const flags = this.cur.flags === -1 ? 0 : this.cur.flags;
          this.setFlags((flags & ~(F_SCISSOR | F_DEPTH_MASK)) | scissor | depthMask);
          gl.clear(mask & (gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT));
          i += 8;
          break;
        }
        case OP_DELETE_TEXTURE: {
          const id = cmd[i + 1];
          const info = this.textures.get(id);
          if (info) {
            gl.deleteTexture(info.texture);
            this.textures.delete(id);
          }
          if (this.cur.texture === id) this.cur.texture = -1;
          i += 2;
          break;
        }
        case OP_DELETE_STATIC: {
          const id = cmd[i + 1];
          const s = this.staticVbos.get(id);
          if (s) {
            gl.deleteBuffer(s.buffer);
            gl.deleteVertexArray(s.vao);
            this.staticVbos.delete(id);
            if (this.cur.vao === s.vao) this.cur.vao = null;
          }
          i += 2;
          break;
        }
        default:
          throw new Error(`Unknown GL command ${op} at ${i}`);
      }
    }
    this.stats.draws = draws;
  }
}

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
