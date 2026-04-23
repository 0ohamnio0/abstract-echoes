// dood.al/oscilloscope (Neil Thapen) 원본 Render 객체 1:1 포팅.
// 원본: https://dood.al/oscilloscope/oscilloscope.js + index.html shader 블록
// 우리 쪽 adaptation:
//  - document.getElementById 기반 shader lookup → 인라인 문자열
//  - controls 전역 → 클래스 params
//  - AudioSystem.bufferSize → 상수 1024
//  - screenTexture 경로 /noise.jpg (public/)

// ── 셰이더 원본 (10개, index.html 셰이더 태그 verbatim) ──────────

const VS_SIMPLE = `
attribute vec2 vertexPosition;
void main()
{
  gl_Position = vec4(vertexPosition, 0.0, 1.0);
}
`;

const FS_SIMPLE = `
precision highp float;
uniform vec4 colour;
void main()
{
  gl_FragColor = colour;
}
`;

const VS_GAUSSIAN = `
#define EPS 1E-6
uniform float uInvert;
uniform float uSize;
uniform float uNEdges;
uniform float uFadeAmount;
uniform float uIntensity;
uniform float uGain;
attribute vec2 aStart, aEnd;
attribute float aIdx;
varying vec4 uvl;
varying vec2 vTexCoord;
varying float vLen;
varying float vSize;
void main () {
  float tang;
  vec2 current;
  float idx = mod(aIdx,4.0);
  vec2 dir = (aEnd-aStart)*uGain;
  uvl.z = length(dir);
  if (uvl.z > EPS) {
    dir = dir / uvl.z;
    vSize = 0.006/pow(uvl.z,0.08);
  } else {
    dir = vec2(1.0, 0.0);
    vSize = 0.006/pow(EPS,0.08);
  }
  vSize = uSize;
  vec2 norm = vec2(-dir.y, dir.x);
  if (idx >= 2.0) {
    current = aEnd*uGain;
    tang = 1.0;
    uvl.x = -vSize;
  } else {
    current = aStart*uGain;
    tang = -1.0;
    uvl.x = uvl.z + vSize;
  }
  float side = (mod(idx, 2.0)-0.5)*2.0;
  uvl.y = side * vSize;
  uvl.w = uIntensity*mix(1.0-uFadeAmount, 1.0, floor(aIdx / 4.0 + 0.5)/uNEdges);
  vec4 pos = vec4((current+(tang*dir+norm*side)*vSize)*uInvert,0.0,1.0);
  gl_Position = pos;
  vTexCoord = 0.5*pos.xy+0.5;
}
`;

const FS_GAUSSIAN = `
#define EPS 1E-6
#define TAU 6.283185307179586
#define TAUR 2.5066282746310002
#define SQRT2 1.4142135623730951
precision highp float;
uniform float uSize;
uniform float uIntensity;
uniform sampler2D uScreen;
varying float vSize;
varying vec4 uvl;
varying vec2 vTexCoord;
float gaussian(float x, float sigma) {
  return exp(-(x * x) / (2.0 * sigma * sigma)) / (TAUR * sigma);
}
float erf(float x) {
  float s = sign(x), a = abs(x);
  x = 1.0 + (0.278393 + (0.230389 + 0.078108 * (a * a)) * a) * a;
  x *= x;
  return s - s / (x * x);
}
void main (void) {
  float len = uvl.z;
  vec2 xy = uvl.xy;
  float brightness;
  float sigma = vSize/5.0;
  if (len < EPS) {
    brightness = gaussian(length(xy), sigma);
  } else {
    brightness = erf(xy.x/SQRT2/sigma) - erf((xy.x-len)/SQRT2/sigma);
    brightness *= exp(-xy.y*xy.y/(2.0*sigma*sigma))/2.0/len;
  }
  brightness *= uvl.w;
  gl_FragColor = 2.0 * texture2D(uScreen, vTexCoord) * brightness;
  gl_FragColor.a = 1.0;
}
`;

const VS_TEXTURED = `
precision highp float;
attribute vec2 aPos;
varying vec2 vTexCoord;
void main (void) {
  gl_Position = vec4(aPos, 0.0, 1.0);
  vTexCoord = (0.5*aPos+0.5);
}
`;

const VS_TEXTURED_RESIZE = `
precision highp float;
attribute vec2 aPos;
varying vec2 vTexCoord;
uniform float uResizeForCanvas;
void main (void) {
  gl_Position = vec4(aPos, 0.0, 1.0);
  vTexCoord = (0.5*aPos+0.5)*uResizeForCanvas;
}
`;

const FS_TEXTURED = `
precision highp float;
uniform sampler2D uTexture0;
varying vec2 vTexCoord;
void main (void) {
  gl_FragColor = texture2D(uTexture0, vTexCoord);
  gl_FragColor.a = 1.0;
}
`;

const FS_BLUR = `
precision highp float;
uniform sampler2D uTexture0;
uniform vec2 uOffset;
varying vec2 vTexCoord;
void main (void) {
  vec4 sum = vec4(0.0);
  sum += texture2D(uTexture0, vTexCoord - uOffset*8.0) * 0.000078;
  sum += texture2D(uTexture0, vTexCoord - uOffset*7.0) * 0.000489;
  sum += texture2D(uTexture0, vTexCoord - uOffset*6.0) * 0.002403;
  sum += texture2D(uTexture0, vTexCoord - uOffset*5.0) * 0.009245;
  sum += texture2D(uTexture0, vTexCoord - uOffset*4.0) * 0.027835;
  sum += texture2D(uTexture0, vTexCoord - uOffset*3.0) * 0.065592;
  sum += texture2D(uTexture0, vTexCoord - uOffset*2.0) * 0.12098;
  sum += texture2D(uTexture0, vTexCoord - uOffset*1.0) * 0.17467;
  sum += texture2D(uTexture0, vTexCoord + uOffset*0.0) * 0.19742;
  sum += texture2D(uTexture0, vTexCoord + uOffset*1.0) * 0.17467;
  sum += texture2D(uTexture0, vTexCoord + uOffset*2.0) * 0.12098;
  sum += texture2D(uTexture0, vTexCoord + uOffset*3.0) * 0.065592;
  sum += texture2D(uTexture0, vTexCoord + uOffset*4.0) * 0.027835;
  sum += texture2D(uTexture0, vTexCoord + uOffset*5.0) * 0.009245;
  sum += texture2D(uTexture0, vTexCoord + uOffset*6.0) * 0.002403;
  sum += texture2D(uTexture0, vTexCoord + uOffset*7.0) * 0.000489;
  sum += texture2D(uTexture0, vTexCoord + uOffset*8.0) * 0.000078;
  gl_FragColor = sum;
}
`;

const VS_OUTPUT = `
precision highp float;
attribute vec2 aPos;
varying vec2 vTexCoord;
varying vec2 vTexCoordCanvas;
uniform float uResizeForCanvas;
void main (void) {
  gl_Position = vec4(aPos, 0.0, 1.0);
  vTexCoord = (0.5*aPos+0.5);
  vTexCoordCanvas = vTexCoord*uResizeForCanvas;
}
`;

const FS_OUTPUT = `
precision highp float;
uniform sampler2D uTexture0; //line
uniform sampler2D uTexture1; //tight glow
uniform sampler2D uTexture2; //big glow
uniform sampler2D uTexture3; //screen
uniform float uExposure;
uniform vec3 uColour;
varying vec2 vTexCoord;
varying vec2 vTexCoordCanvas;
void main (void) {
  // 9차 합의 — "빛이 아니라 쉐입 자체에 집중": bloom 레이어(tightGlow, scatter, phosphor screen) 모두 제거
  // 참고용 주석: 복원 시 아래 두 줄 (uTexture1/2/3) 및 screen/tightGlow/scatter sampling 복구
  vec4 line = texture2D(uTexture0, vTexCoordCanvas);
  float light = line.r;
  float tlight = 1.0-pow(2.0, -uExposure*light);
  float tlight2 = tlight*tlight*tlight;
  gl_FragColor.rgb = mix(uColour, vec3(1.0), 0.3+tlight2*tlight2*0.5)*tlight;
  gl_FragColor.a = 1.0;
}
`;

// ── 유틸 ────────────────────────────────────────────────────────

interface TextureWithSize extends WebGLTexture { width?: number; height?: number; }

function compileProgram(gl: WebGLRenderingContext, vsSrc: string, fsSrc: string): WebGLProgram {
  const compile = (type: number, src: string) => {
    const sh = gl.createShader(type);
    if (!sh) throw new Error('createShader failed');
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error(`Shader compile failed: ${info}\n${src.slice(0, 200)}`);
    }
    return sh;
  };
  const vs = compile(gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
  const p = gl.createProgram();
  if (!p) throw new Error('createProgram failed');
  gl.attachShader(p, vs); gl.deleteShader(vs);
  gl.attachShader(p, fs); gl.deleteShader(fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error(`Program link failed: ${info}`);
  }
  return p;
}

// ── Oscilloscope 클래스 — dood.al Render 1:1 포팅 ───────────────

export interface OscilloscopeParams {
  mainGain?: number;        // 2^mainGain * 450/512 → uGain
  exposureStops?: number;   // 2^(exposureStops-2) → uExposure
  persistence?: number;     // 0.5^persistence * 0.2 → uFadeAmount
  hue?: number;             // 0..360
  lineSize?: number;        // uSize (dood.al 고정 0.015)
  intensity?: number;       // uIntensity (dood.al 고정 0.005)
  invertXY?: boolean;
  bufferSize?: number;      // audio buffer size, fadeAmount 계산용 (기본 1024)
}

export class Oscilloscope {
  private canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext;

  private simpleShader: WebGLProgram;
  private lineShader: WebGLProgram;
  private outputShader: WebGLProgram;
  private texturedShader: WebGLProgram;
  private blurShader: WebGLProgram;

  // Attribute/Uniform locations
  private simpleLoc: { vertexPosition: number; colour: WebGLUniformLocation | null; };
  private lineLoc: {
    aStart: number; aEnd: number; aIdx: number;
    uGain: WebGLUniformLocation | null; uSize: WebGLUniformLocation | null;
    uInvert: WebGLUniformLocation | null; uIntensity: WebGLUniformLocation | null;
    uNEdges: WebGLUniformLocation | null; uFadeAmount: WebGLUniformLocation | null;
    uScreen: WebGLUniformLocation | null;
  };
  private outputLoc: {
    aPos: number;
    uTexture0: WebGLUniformLocation | null; uTexture1: WebGLUniformLocation | null;
    uTexture2: WebGLUniformLocation | null; uTexture3: WebGLUniformLocation | null;
    uExposure: WebGLUniformLocation | null; uColour: WebGLUniformLocation | null;
    uResizeForCanvas: WebGLUniformLocation | null;
  };
  private texturedLoc: {
    aPos: number;
    uTexture0: WebGLUniformLocation | null;
    uResizeForCanvas: WebGLUniformLocation | null;
  };
  private blurLoc: {
    aPos: number;
    uTexture0: WebGLUniformLocation | null;
    uOffset: WebGLUniformLocation | null;
  };

  // Framebuffer + textures
  private frameBuffer: WebGLFramebuffer;
  private lineTexture: TextureWithSize;
  private blur1Texture: TextureWithSize;
  private blur2Texture: TextureWithSize;
  private blur3Texture: TextureWithSize;
  private blur4Texture: TextureWithSize;
  private screenTexture: TextureWithSize;
  private targetTexture: TextureWithSize | null = null;

  // VBOs
  private vertexBuffer: WebGLBuffer;
  private quadIndexBuffer: WebGLBuffer | null = null;
  private vertexIndexBuffer: WebGLBuffer | null = null;
  private scratchVertices: Float32Array = new Float32Array(0);

  private nPoints = 0;
  private nEdges = 0;

  private fullScreenQuad: Float32Array;
  private fadeAmount = 0;

  private floatTextureType: number;

  // dood.al URL preset 기본값 (해민 제공)
  public params: Required<OscilloscopeParams> = {
    // dood.al URL preset #1.05,0,0,0,1,0.016,4,0,...,125,0,0,0 (2026-04-20)
    mainGain: 1.05,
    exposureStops: 0,
    persistence: 0,
    hue: 125,
    lineSize: 0.026,
    intensity: 0.1,
    invertXY: false,
    bufferSize: 1024,
  };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', {
      preserveDrawingBuffer: true,
      alpha: false,
    }) as WebGLRenderingContext | null;
    if (!gl) throw new Error('WebGL not supported');
    this.gl = gl;

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.colorMask(true, true, true, true);

    // Float texture — OES_texture_float만으론 color attachment 호환 보장 없음.
    // WEBGL_color_buffer_float 확장까지 확보 + FBO status 검증 후 사용.
    const extFloat = gl.getExtension('OES_texture_float');
    gl.getExtension('OES_texture_float_linear');
    const extColorBuffer = gl.getExtension('WEBGL_color_buffer_float');
    this.floatTextureType = (extFloat && extColorBuffer) ? gl.FLOAT : gl.UNSIGNED_BYTE;
    console.info('[Oscilloscope] texture type:',
      this.floatTextureType === gl.FLOAT ? 'FLOAT' : 'UNSIGNED_BYTE',
      `(OES_float=${!!extFloat}, WEBGL_color_buffer_float=${!!extColorBuffer})`);

    this.fadeAmount = (0.2 * this.params.bufferSize) / 512;

    this.fullScreenQuad = new Float32Array([
      -1, 1, 1, 1, 1, -1,
      -1, 1, 1, -1, -1, -1,
    ]);

    // Programs
    this.simpleShader = compileProgram(gl, VS_SIMPLE, FS_SIMPLE);
    this.lineShader = compileProgram(gl, VS_GAUSSIAN, FS_GAUSSIAN);
    this.outputShader = compileProgram(gl, VS_OUTPUT, FS_OUTPUT);
    this.texturedShader = compileProgram(gl, VS_TEXTURED_RESIZE, FS_TEXTURED);
    this.blurShader = compileProgram(gl, VS_TEXTURED, FS_BLUR);

    this.simpleLoc = {
      vertexPosition: gl.getAttribLocation(this.simpleShader, 'vertexPosition'),
      colour: gl.getUniformLocation(this.simpleShader, 'colour'),
    };
    this.lineLoc = {
      aStart: gl.getAttribLocation(this.lineShader, 'aStart'),
      aEnd: gl.getAttribLocation(this.lineShader, 'aEnd'),
      aIdx: gl.getAttribLocation(this.lineShader, 'aIdx'),
      uGain: gl.getUniformLocation(this.lineShader, 'uGain'),
      uSize: gl.getUniformLocation(this.lineShader, 'uSize'),
      uInvert: gl.getUniformLocation(this.lineShader, 'uInvert'),
      uIntensity: gl.getUniformLocation(this.lineShader, 'uIntensity'),
      uNEdges: gl.getUniformLocation(this.lineShader, 'uNEdges'),
      uFadeAmount: gl.getUniformLocation(this.lineShader, 'uFadeAmount'),
      uScreen: gl.getUniformLocation(this.lineShader, 'uScreen'),
    };
    this.outputLoc = {
      aPos: gl.getAttribLocation(this.outputShader, 'aPos'),
      uTexture0: gl.getUniformLocation(this.outputShader, 'uTexture0'),
      uTexture1: gl.getUniformLocation(this.outputShader, 'uTexture1'),
      uTexture2: gl.getUniformLocation(this.outputShader, 'uTexture2'),
      uTexture3: gl.getUniformLocation(this.outputShader, 'uTexture3'),
      uExposure: gl.getUniformLocation(this.outputShader, 'uExposure'),
      uColour: gl.getUniformLocation(this.outputShader, 'uColour'),
      uResizeForCanvas: gl.getUniformLocation(this.outputShader, 'uResizeForCanvas'),
    };
    this.texturedLoc = {
      aPos: gl.getAttribLocation(this.texturedShader, 'aPos'),
      uTexture0: gl.getUniformLocation(this.texturedShader, 'uTexture0'),
      uResizeForCanvas: gl.getUniformLocation(this.texturedShader, 'uResizeForCanvas'),
    };
    this.blurLoc = {
      aPos: gl.getAttribLocation(this.blurShader, 'aPos'),
      uTexture0: gl.getUniformLocation(this.blurShader, 'uTexture0'),
      uOffset: gl.getUniformLocation(this.blurShader, 'uOffset'),
    };

    this.vertexBuffer = gl.createBuffer()!;

    // Framebuffer + textures (dood.al setupTextures)
    this.frameBuffer = gl.createFramebuffer()!;
    this.lineTexture = this.makeTexture(1024, 1024);
    this.blur1Texture = this.makeTexture(256, 256);
    this.blur2Texture = this.makeTexture(256, 256);
    this.blur3Texture = this.makeTexture(32, 32);
    this.blur4Texture = this.makeTexture(32, 32);
    this.screenTexture = this.loadTexture('/noise.jpg');

    // FBO completeness 검증 — 실패 시 UNSIGNED_BYTE로 재생성
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.frameBuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.lineTexture, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      console.warn(`[Oscilloscope] FBO incomplete (0x${status.toString(16)}), forcing UNSIGNED_BYTE`);
      this.floatTextureType = gl.UNSIGNED_BYTE;
      gl.deleteTexture(this.lineTexture);
      gl.deleteTexture(this.blur1Texture);
      gl.deleteTexture(this.blur2Texture);
      gl.deleteTexture(this.blur3Texture);
      gl.deleteTexture(this.blur4Texture);
      this.lineTexture = this.makeTexture(1024, 1024);
      this.blur1Texture = this.makeTexture(256, 256);
      this.blur2Texture = this.makeTexture(256, 256);
      this.blur3Texture = this.makeTexture(32, 32);
      this.blur4Texture = this.makeTexture(32, 32);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private makeTexture(width: number, height: number): TextureWithSize {
    const gl = this.gl;
    const texture = gl.createTexture() as TextureWithSize;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, this.floatTextureType, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindTexture(gl.TEXTURE_2D, null);
    texture.width = width;
    texture.height = height;
    return texture;
  }

  private loadTexture(fileName: string): TextureWithSize {
    const gl = this.gl;
    const texture = gl.createTexture() as TextureWithSize;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 128, 255]));
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.addEventListener('load', () => {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.generateMipmap(gl.TEXTURE_2D);
      texture.width = texture.height = 512;
    });
    image.src = fileName;
    return texture;
  }

  setupArrays(nPoints: number) {
    if (nPoints === this.nPoints) return;
    const gl = this.gl;
    this.nPoints = nPoints;
    this.nEdges = nPoints - 1;

    // Quad index buffer (per-vertex aIdx)
    this.quadIndexBuffer = this.quadIndexBuffer ?? gl.createBuffer()!;
    const indices = new Float32Array(4 * this.nEdges);
    for (let i = 0; i < indices.length; i++) indices[i] = i;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadIndexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    // Triangle indices (6 per segment)
    this.vertexIndexBuffer = this.vertexIndexBuffer ?? gl.createBuffer()!;
    const len = this.nEdges * 2 * 3;
    const triIdx = new Uint16Array(len);
    for (let i = 0, pos = 0; i < len;) {
      triIdx[i++] = pos; triIdx[i++] = pos + 2; triIdx[i++] = pos + 1;
      triIdx[i++] = pos + 1; triIdx[i++] = pos + 2; triIdx[i++] = pos + 3;
      pos += 4;
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.vertexIndexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, triIdx, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

    this.scratchVertices = new Float32Array(8 * nPoints);
  }

  resize(width: number, height: number) {
    this.canvas.width = width;
    this.canvas.height = height;
    const renderSize = Math.min(Math.max(width, height), 1024);
    this.lineTexture.width = renderSize;
    this.lineTexture.height = renderSize;
  }

  setParam<K extends keyof OscilloscopeParams>(name: K, value: NonNullable<OscilloscopeParams[K]>) {
    (this.params as any)[name] = value;
  }

  clear() {
    const gl = this.gl;
    for (const tex of [this.lineTexture, this.blur1Texture, this.blur2Texture, this.blur3Texture, this.blur4Texture]) {
      this.activateTargetTexture(tex);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    this.activateTargetTexture(null);
  }

  // 메인 엔트리: xPoints, yPoints 각각 Float32Array (-1..1 범위)
  // mirror=true: 상하 대칭 — 같은 FBO에 y와 -y 두 라인을 fade 없이 누적해 그림 (9차 합의 β)
  render(xPoints: Float32Array, yPoints: Float32Array, options?: { mirror?: boolean }) {
    if (xPoints.length !== yPoints.length) throw new Error('x/y length mismatch');
    if (xPoints.length < 2) return;
    this.setupArrays(xPoints.length);
    this.drawLineTexture(xPoints, yPoints, options?.mirror ?? false);
    this.drawCRT();
  }

  private drawLineTexture(xPoints: Float32Array, yPoints: Float32Array, mirror: boolean) {
    this.fadeAmount = Math.pow(0.5, this.params.persistence) * 0.2 * this.params.bufferSize / 512;
    this.activateTargetTexture(this.lineTexture);
    this.fade();
    this.drawLine(xPoints, yPoints);
    if (mirror) {
      // 같은 FBO에 상하 반전 라인 추가 (fade 건너뜀 — 이미 위에서 한 번 수행)
      const yMirror = new Float32Array(yPoints.length);
      for (let i = 0; i < yPoints.length; i++) yMirror[i] = -yPoints[i];
      this.drawLine(xPoints, yMirror);
    }
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.lineTexture);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  private drawCRT() {
    const gl = this.gl;
    this.setNormalBlending();

    // blur1 ← line (downsample with resize)
    this.activateTargetTexture(this.blur1Texture);
    gl.useProgram(this.texturedShader);
    gl.uniform1f(this.texturedLoc.uResizeForCanvas, (this.lineTexture.width ?? 1024) / 1024);
    this.drawTexturedQuad(this.texturedLoc.aPos, this.lineTexture, null, null, null);

    // H blur 256 → blur2
    this.activateTargetTexture(this.blur2Texture);
    gl.useProgram(this.blurShader);
    gl.uniform2f(this.blurLoc.uOffset, 1 / 256, 0);
    this.drawTexturedQuadBlur(this.blur1Texture);

    // V blur 256 → blur1
    this.activateTargetTexture(this.blur1Texture);
    gl.uniform2f(this.blurLoc.uOffset, 0, 1 / 256);
    this.drawTexturedQuadBlur(this.blur2Texture);

    // blur3 ← blur1 (preserve)
    this.activateTargetTexture(this.blur3Texture);
    gl.useProgram(this.texturedShader);
    gl.uniform1f(this.texturedLoc.uResizeForCanvas, 1);
    this.drawTexturedQuad(this.texturedLoc.aPos, this.blur1Texture, null, null, null);

    // H wide blur 32 → blur4 (diagonal offset)
    this.activateTargetTexture(this.blur4Texture);
    gl.useProgram(this.blurShader);
    gl.uniform2f(this.blurLoc.uOffset, 1 / 32, 1 / 60);
    this.drawTexturedQuadBlur(this.blur3Texture);

    // V wide blur 32 → blur3 (perpendicular diagonal)
    this.activateTargetTexture(this.blur3Texture);
    gl.uniform2f(this.blurLoc.uOffset, -1 / 60, 1 / 32);
    this.drawTexturedQuadBlur(this.blur4Texture);

    // Final compose to canvas
    this.activateTargetTexture(null);
    gl.useProgram(this.outputShader);
    const brightness = Math.pow(2, this.params.exposureStops - 2);
    gl.uniform1f(this.outputLoc.uExposure, brightness);
    gl.uniform1f(this.outputLoc.uResizeForCanvas, (this.lineTexture.width ?? 1024) / 1024);
    const colour = this.getColourFromHue(this.params.hue);
    gl.uniform3f(this.outputLoc.uColour, colour[0], colour[1], colour[2]);
    this.drawTexturedQuad(this.outputLoc.aPos, this.lineTexture, this.blur1Texture, this.blur3Texture, this.screenTexture);
  }

  private getColourFromHue(hue: number): [number, number, number] {
    const alpha = (hue / 120) % 1;
    const start = Math.sqrt(1 - alpha);
    const end = Math.sqrt(alpha);
    if (hue < 120) return [start, end, 0];
    if (hue < 240) return [0, start, end];
    return [end, 0, start];
  }

  private activateTargetTexture(texture: TextureWithSize | null) {
    const gl = this.gl;
    if (texture) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.frameBuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      gl.viewport(0, 0, texture.width ?? 1024, texture.height ?? 1024);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }
    this.targetTexture = texture;
  }

  // Textured shader용 (output과 textured 두 경우 모두 aPos 이름 동일)
  // output shader는 4 textures 요구, textured/blur는 1개
  private drawTexturedQuad(
    aPosLoc: number,
    tex0: TextureWithSize,
    tex1: TextureWithSize | null,
    tex2: TextureWithSize | null,
    tex3: TextureWithSize | null,
  ) {
    const gl = this.gl;
    gl.enableVertexAttribArray(aPosLoc);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex0);
    // Determine which program is active by checking which uniform location list to use
    // (caller sets uniform1i as needed before calling)
    if (tex0) {
      // output shader binds via its own loc; textured shader via texturedLoc; blur via blurLoc
      // 현재 사용 프로그램 따라 uniform1i 위치 다름 — caller가 responsibility
    }

    // output shader는 4개 다 바인드 필요
    const isOutput = tex1 && tex2 && tex3;
    if (isOutput) {
      gl.uniform1i(this.outputLoc.uTexture0, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, tex1);
      gl.uniform1i(this.outputLoc.uTexture1, 1);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, tex2);
      gl.uniform1i(this.outputLoc.uTexture2, 2);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, tex3);
      gl.uniform1i(this.outputLoc.uTexture3, 3);
    } else {
      gl.uniform1i(this.texturedLoc.uTexture0, 0);
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.fullScreenQuad, gl.STATIC_DRAW);
    gl.vertexAttribPointer(aPosLoc, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disableVertexAttribArray(aPosLoc);

    if (this.targetTexture) {
      gl.bindTexture(gl.TEXTURE_2D, this.targetTexture);
      gl.generateMipmap(gl.TEXTURE_2D);
    }

    gl.activeTexture(gl.TEXTURE0);
  }

  private drawTexturedQuadBlur(tex: TextureWithSize) {
    const gl = this.gl;
    gl.enableVertexAttribArray(this.blurLoc.aPos);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(this.blurLoc.uTexture0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.fullScreenQuad, gl.STATIC_DRAW);
    gl.vertexAttribPointer(this.blurLoc.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disableVertexAttribArray(this.blurLoc.aPos);
    if (this.targetTexture) {
      gl.bindTexture(gl.TEXTURE_2D, this.targetTexture);
      gl.generateMipmap(gl.TEXTURE_2D);
    }
  }

  private drawLine(xPoints: Float32Array, yPoints: Float32Array) {
    const gl = this.gl;
    this.setAdditiveBlending();

    const scratchVertices = this.scratchVertices;
    const nPoints = xPoints.length;
    for (let i = 0; i < nPoints; i++) {
      const p = i * 8;
      scratchVertices[p] = scratchVertices[p + 2] = scratchVertices[p + 4] = scratchVertices[p + 6] = xPoints[i];
      scratchVertices[p + 1] = scratchVertices[p + 3] = scratchVertices[p + 5] = scratchVertices[p + 7] = yPoints[i];
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, scratchVertices, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    const program = this.lineShader;
    gl.useProgram(program);
    gl.enableVertexAttribArray(this.lineLoc.aStart);
    gl.enableVertexAttribArray(this.lineLoc.aEnd);
    gl.enableVertexAttribArray(this.lineLoc.aIdx);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.vertexAttribPointer(this.lineLoc.aStart, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribPointer(this.lineLoc.aEnd, 2, gl.FLOAT, false, 0, 8 * 4);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadIndexBuffer);
    gl.vertexAttribPointer(this.lineLoc.aIdx, 1, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.screenTexture);
    gl.uniform1i(this.lineLoc.uScreen, 0);

    gl.uniform1f(this.lineLoc.uSize, this.params.lineSize);
    gl.uniform1f(this.lineLoc.uGain, Math.pow(2, this.params.mainGain) * 450 / 512);
    gl.uniform1f(this.lineLoc.uInvert, this.params.invertXY ? -1 : 1);
    gl.uniform1f(this.lineLoc.uIntensity, this.params.intensity);
    gl.uniform1f(this.lineLoc.uFadeAmount, this.fadeAmount);
    gl.uniform1f(this.lineLoc.uNEdges, this.nEdges);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.vertexIndexBuffer);
    const nEdgesThisTime = xPoints.length - 1;
    gl.drawElements(gl.TRIANGLES, nEdgesThisTime * 6, gl.UNSIGNED_SHORT, 0);

    gl.disableVertexAttribArray(this.lineLoc.aStart);
    gl.disableVertexAttribArray(this.lineLoc.aEnd);
    gl.disableVertexAttribArray(this.lineLoc.aIdx);
  }

  private fade() {
    const gl = this.gl;
    this.setNormalBlending();
    const program = this.simpleShader;
    gl.useProgram(program);
    gl.enableVertexAttribArray(this.simpleLoc.vertexPosition);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.fullScreenQuad, gl.STATIC_DRAW);
    gl.vertexAttribPointer(this.simpleLoc.vertexPosition, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.uniform4f(this.simpleLoc.colour, 0, 0, 0, this.fadeAmount);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disableVertexAttribArray(this.simpleLoc.vertexPosition);
  }

  private setAdditiveBlending() {
    this.gl.blendFunc(this.gl.ONE, this.gl.ONE);
  }

  private setNormalBlending() {
    this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
  }

  dispose() {
    const gl = this.gl;
    for (const p of [this.simpleShader, this.lineShader, this.outputShader, this.texturedShader, this.blurShader]) gl.deleteProgram(p);
    for (const t of [this.lineTexture, this.blur1Texture, this.blur2Texture, this.blur3Texture, this.blur4Texture, this.screenTexture]) gl.deleteTexture(t);
    gl.deleteFramebuffer(this.frameBuffer);
    gl.deleteBuffer(this.vertexBuffer);
    if (this.quadIndexBuffer) gl.deleteBuffer(this.quadIndexBuffer);
    if (this.vertexIndexBuffer) gl.deleteBuffer(this.vertexIndexBuffer);
  }
}

// 편의: AudioAnalyzer waveform (Uint8Array 0..255) → (xRamp, yAmp) Float32Array
// 8-bit 양자화 — 작은 amplitude에서 계단 artifact. Float 버전 선호.
export function waveformToXY(waveform: Uint8Array, gain = 1): { x: Float32Array; y: Float32Array } {
  const n = waveform.length;
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = -1 + (2 * i) / (n - 1);
    const v = (waveform[i] - 128) / 128 * gain;
    y[i] = Math.max(-1, Math.min(1, v));
  }
  return { x, y };
}

// Float time-domain 데이터 직접 사용 — 연속값이라 작은 amp에서도 부드러운 곡선
export function waveformFloatToXY(wf: Float32Array, gain = 1): { x: Float32Array; y: Float32Array } {
  const n = wf.length;
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = -1 + (2 * i) / (n - 1);
    const v = wf[i] * gain;
    y[i] = Math.max(-1, Math.min(1, v));
  }
  return { x, y };
}
