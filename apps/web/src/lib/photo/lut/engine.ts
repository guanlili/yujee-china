import type { LutId, PhotoFilterRef } from '../filter-state';
import {
  FULL_LUT_SIZE,
  THUMB_LUT_SIZE,
  loadFullLut,
  loadThumbLut,
} from './resource-loader';

export type LutTier = 'thumb' | 'full';

type SerialExecutor = <T>(job: () => Promise<T>) => Promise<T>;

export function createSerialExecutor(): SerialExecutor {
  let tail: Promise<void> = Promise.resolve();
  return <T>(job: () => Promise<T>): Promise<T> => {
    const result = tail.then(job);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}

interface LutBitmap {
  readonly width: number;
  readonly height: number;
  close(): void;
}

/**
 * Small canvas adapter shared by OffscreenCanvas, DOM canvas, and dependency-free
 * Node fakes. Production callers do not need this interface.
 */
export interface LutCanvas {
  width: number;
  height: number;
  getContext(kind: 'webgl2'): WebGL2RenderingContext | null;
  encode(type: string): Promise<Blob>;
  dispose(): void;
  onContextLost?(handler: () => void): void;
}

interface Logger {
  error(message?: unknown, ...optionalParams: unknown[]): void;
  warn(message?: unknown, ...optionalParams: unknown[]): void;
}

interface LutEngineDependencies {
  createOffscreenCanvas: () => LutCanvas | null;
  createDomCanvas: () => LutCanvas | null;
  decodeBlob: (blob: Blob) => Promise<LutBitmap>;
  loadThumbLut: (id: LutId) => Promise<Uint8Array>;
  loadFullLut: (id: LutId) => Promise<Uint8Array>;
  logger: Logger;
}

export interface LutEngine {
  isSupported(): boolean;
  applyToBlob(original: Blob, filter: PhotoFilterRef, tier?: LutTier): Promise<Blob>;
  applyPreview(original: Blob, filter: PhotoFilterRef): Promise<Blob>;
}

interface ProgramState {
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  imageLocation: WebGLUniformLocation;
  lutLocation: WebGLUniformLocation;
  sizeLocation: WebGLUniformLocation;
  strengthLocation: WebGLUniformLocation;
}

interface ContextState {
  canvas: LutCanvas;
  gl: WebGL2RenderingContext;
  program?: ProgramState;
  lutTextures: Map<string, WebGLTexture>;
}

const VERTEX_SHADER = `#version 300 es
precision highp float;
out vec2 vUV;
void main(){
  vec2 p = vec2((gl_VertexID==2)?3.0:-1.0, (gl_VertexID==1)?3.0:-1.0);
  vUV = vec2((p.x+1.0)*0.5, 1.0-(p.y+1.0)*0.5);
  gl_Position = vec4(p,0.0,1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 vUV;
uniform sampler2D uImage;
uniform sampler3D uLUT;
uniform float uN;
uniform float uStrength;
out vec4 frag;
void main(){
  vec3 c = clamp(texture(uImage, vUV).rgb, 0.0, 1.0);
  vec3 co = (c*(uN-1.0)+0.5)/uN;
  vec3 g = texture(uLUT, co).rgb;
  frag = vec4(mix(c, g, uStrength), 1.0);
}`;

function createLutEngine(dependencies: LutEngineDependencies): LutEngine {
  const serial = createSerialExecutor();
  let activeContext: ContextState | undefined;

  function invalidateContext(state: ContextState): void {
    if (activeContext !== state) return;
    activeContext = undefined;
    destroyContextState(state);
  }

  function ensureContext(): ContextState | null {
    if (activeContext) {
      if (!isContextLost(activeContext.gl)) return activeContext;
      invalidateContext(activeContext);
    }

    const routes: Array<readonly [string, () => LutCanvas | null]> = [
      ['OffscreenCanvas', dependencies.createOffscreenCanvas],
      ['DOM canvas', dependencies.createDomCanvas],
    ];
    for (const [name, createCanvas] of routes) {
      let canvas: LutCanvas | null = null;
      try {
        canvas = createCanvas();
        if (!canvas) continue;
        const gl = canvas.getContext('webgl2');
        if (!gl) {
          canvas.dispose();
          continue;
        }
        const state: ContextState = { canvas, gl, lutTextures: new Map() };
        activeContext = state;
        canvas.onContextLost?.(() => invalidateContext(state));
        return state;
      } catch (error) {
        canvas?.dispose();
        dependencies.logger.warn(`LUT ${name} WebGL2 initialization failed`, error);
      }
    }
    return null;
  }

  async function applyToBlob(
    original: Blob,
    filter: PhotoFilterRef,
    tier: LutTier = 'full',
  ): Promise<Blob> {
    if (filter.strength <= 0) return original;

    return serial(async () => {
      const state = ensureContext();
      if (!state) {
        dependencies.logger.warn('LUT rendering unavailable: no WebGL2 canvas route succeeded');
        return original;
      }

      let bitmap: LutBitmap | undefined;
      let imageTexture: WebGLTexture | null = null;
      try {
        bitmap = await dependencies.decodeBlob(original);
        const lutData = tier === 'thumb'
          ? await dependencies.loadThumbLut(filter.lutId)
          : await dependencies.loadFullLut(filter.lutId);

        assertUsableContext(state, activeContext);
        const program = state.program ??= createProgramState(state.gl);
        const lutTexture = getOrCreateLutTexture(state, filter.lutId, tier, lutData);
        const { gl, canvas } = state;

        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        gl.viewport(0, 0, bitmap.width, bitmap.height);
        gl.useProgram(program.program);
        gl.bindVertexArray(program.vao);

        imageTexture = gl.createTexture();
        if (!imageTexture) throw new Error('WebGL could not create the image texture');
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, imageTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          bitmap as unknown as TexImageSource,
        );
        gl.uniform1i(program.imageLocation, 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_3D, lutTexture);
        gl.uniform1i(program.lutLocation, 1);
        gl.uniform1f(program.sizeLocation, tier === 'thumb' ? THUMB_LUT_SIZE : FULL_LUT_SIZE);
        gl.uniform1f(program.strengthLocation, clampStrength(filter.strength) / 100);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        assertUsableContext(state, activeContext);

        return await canvas.encode(outputMimeType(original.type));
      } catch (error) {
        if (isContextLost(state.gl)) invalidateContext(state);
        dependencies.logger.error('LUT rendering failed; returning the original Blob', error);
        return original;
      } finally {
        if (imageTexture) {
          try {
            state.gl.deleteTexture(imageTexture);
          } catch (error) {
            dependencies.logger.warn('LUT image texture cleanup failed', error);
          }
        }
        if (bitmap) {
          try {
            bitmap.close();
          } catch (error) {
            dependencies.logger.warn('LUT ImageBitmap cleanup failed', error);
          }
        }
      }
    });
  }

  return {
    isSupported() {
      return ensureContext() !== null;
    },
    applyToBlob,
    applyPreview(original, filter) {
      return applyToBlob(original, filter, 'thumb');
    },
  };
}

function assertUsableContext(state: ContextState, activeContext: ContextState | undefined): void {
  if (state !== activeContext || isContextLost(state.gl)) {
    throw new Error('LUT WebGL2 context was lost');
  }
}

function isContextLost(gl: WebGL2RenderingContext): boolean {
  try {
    return gl.isContextLost();
  } catch {
    return false;
  }
}

function createProgramState(gl: WebGL2RenderingContext): ProgramState {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  let fragment: WebGLShader;
  try {
    fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  } catch (error) {
    gl.deleteShader(vertex);
    throw error;
  }
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    throw new Error('WebGL could not create the LUT shader program');
  }
  try {
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`LUT shader link failed: ${gl.getProgramInfoLog(program) ?? 'unknown error'}`);
    }
  } catch (error) {
    gl.deleteProgram(program);
    throw error;
  } finally {
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
  }

  const vao = gl.createVertexArray();
  if (!vao) {
    gl.deleteProgram(program);
    throw new Error('WebGL could not create the LUT vertex array');
  }
  try {
    return {
      program,
      vao,
      imageLocation: requiredUniform(gl, program, 'uImage'),
      lutLocation: requiredUniform(gl, program, 'uLUT'),
      sizeLocation: requiredUniform(gl, program, 'uN'),
      strengthLocation: requiredUniform(gl, program, 'uStrength'),
    };
  } catch (error) {
    gl.deleteVertexArray(vao);
    gl.deleteProgram(program);
    throw error;
  }
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('WebGL could not create a LUT shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? 'unknown error';
    gl.deleteShader(shader);
    throw new Error(`LUT shader compile failed: ${message}`);
  }
  return shader;
}

function requiredUniform(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
): WebGLUniformLocation {
  const location = gl.getUniformLocation(program, name);
  if (!location) throw new Error(`LUT shader uniform ${name} is unavailable`);
  return location;
}

function getOrCreateLutTexture(
  state: ContextState,
  id: LutId,
  tier: LutTier,
  data: Uint8Array,
): WebGLTexture {
  const key = `${tier}:${id}`;
  const cached = state.lutTextures.get(key);
  if (cached) return cached;

  const { gl } = state;
  const size = tier === 'thumb' ? THUMB_LUT_SIZE : FULL_LUT_SIZE;
  const expectedLength = size ** 3 * 3;
  if (data.byteLength !== expectedLength) {
    throw new Error(`LUT texture ${key} decoded length ${data.byteLength}; expected ${expectedLength}`);
  }
  const texture = gl.createTexture();
  if (!texture) throw new Error(`WebGL could not create LUT texture ${key}`);
  try {
    gl.bindTexture(gl.TEXTURE_3D, texture);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(
      gl.TEXTURE_3D,
      0,
      gl.RGB8,
      size,
      size,
      size,
      0,
      gl.RGB,
      gl.UNSIGNED_BYTE,
      data,
    );
    state.lutTextures.set(key, texture);
    return texture;
  } catch (error) {
    gl.deleteTexture(texture);
    throw error;
  }
}

function destroyContextState(state: ContextState): void {
  const { gl, program } = state;
  if (!isContextLost(gl)) {
    for (const texture of state.lutTextures.values()) {
      try {
        gl.deleteTexture(texture);
      } catch {
        // A partially lost context may reject cleanup; dropping references is enough.
      }
    }
    if (program) {
      try {
        gl.deleteVertexArray(program.vao);
        gl.deleteProgram(program.program);
      } catch {
        // See texture cleanup above.
      }
    }
  }
  state.lutTextures.clear();
  state.canvas.dispose();
}

function clampStrength(strength: number): number {
  return Math.min(100, Math.max(0, strength));
}

function outputMimeType(inputType: string): string {
  return ['image/jpeg', 'image/png', 'image/webp'].includes(inputType)
    ? inputType
    : 'image/jpeg';
}

function defaultDecodeBlob(blob: Blob): Promise<LutBitmap> {
  if (typeof globalThis.createImageBitmap !== 'function') {
    return Promise.reject(new Error('LUT rendering requires browser createImageBitmap support'));
  }
  return globalThis.createImageBitmap(blob, { imageOrientation: 'from-image' });
}

function createOffscreenCanvasAdapter(): LutCanvas | null {
  if (typeof globalThis.OffscreenCanvas !== 'function') return null;
  const canvas = new OffscreenCanvas(1, 1);
  return {
    get width() {
      return canvas.width;
    },
    set width(value: number) {
      canvas.width = value;
    },
    get height() {
      return canvas.height;
    },
    set height(value: number) {
      canvas.height = value;
    },
    getContext() {
      return canvas.getContext('webgl2', {
        preserveDrawingBuffer: true,
        premultipliedAlpha: false,
      }) as WebGL2RenderingContext | null;
    },
    encode(type) {
      return canvas.convertToBlob({
        type,
        quality: type === 'image/jpeg' ? 0.92 : undefined,
      });
    },
    dispose() {
      canvas.width = 0;
      canvas.height = 0;
    },
    onContextLost(handler) {
      canvas.addEventListener('webglcontextlost', (event) => {
        event.preventDefault();
        handler();
      });
    },
  };
}

function createDomCanvasAdapter(): LutCanvas | null {
  if (typeof document === 'undefined') return null;
  const parent = document.body ?? document.documentElement;
  if (!parent) return null;

  const canvas = document.createElement('canvas');
  canvas.hidden = true;
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.display = 'none';
  parent.appendChild(canvas);

  return {
    get width() {
      return canvas.width;
    },
    set width(value: number) {
      canvas.width = value;
    },
    get height() {
      return canvas.height;
    },
    set height(value: number) {
      canvas.height = value;
    },
    getContext() {
      return canvas.getContext('webgl2', {
        preserveDrawingBuffer: true,
        premultipliedAlpha: false,
      });
    },
    encode(type) {
      return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob);
            else reject(new Error(`LUT canvas could not encode ${type}`));
          },
          type,
          type === 'image/jpeg' ? 0.92 : undefined,
        );
      });
    },
    dispose() {
      canvas.width = 0;
      canvas.height = 0;
      canvas.remove();
    },
    onContextLost(handler) {
      canvas.addEventListener('webglcontextlost', (event) => {
        event.preventDefault();
        handler();
      });
    },
  };
}

const defaultDependencies: LutEngineDependencies = {
  createOffscreenCanvas: createOffscreenCanvasAdapter,
  createDomCanvas: createDomCanvasAdapter,
  decodeBlob: defaultDecodeBlob,
  loadThumbLut,
  loadFullLut,
  logger: console,
};

export const lutEngine: LutEngine = createLutEngine(defaultDependencies);

/** Narrow browser-adapter seam for dependency-free Node tests. */
export function createLutEngineForTesting(
  overrides: Partial<LutEngineDependencies>,
): LutEngine {
  return createLutEngine({ ...defaultDependencies, ...overrides });
}
