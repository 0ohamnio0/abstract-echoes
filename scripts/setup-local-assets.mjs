import { cpSync, mkdirSync, existsSync } from 'fs';
import { createWriteStream } from 'fs';
import https from 'https';

// 1. WASM 파일 복사 (node_modules → public/wasm)
const wasmSrc = 'node_modules/@mediapipe/tasks-audio/wasm';
const wasmDest = 'public/wasm';

if (!existsSync(wasmSrc)) {
  console.error('❌ node_modules/@mediapipe/tasks-audio 를 찾을 수 없습니다. npm install 을 먼저 실행하세요.');
  process.exit(1);
}

mkdirSync(wasmDest, { recursive: true });
cpSync(wasmSrc, wasmDest, { recursive: true });
console.log('✓ WASM 파일 복사 완료 (public/wasm/)');

// 2. YAMNet 모델 다운로드 (최초 1회)
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/1/yamnet.tflite';
const MODEL_PATH = 'public/models/yamnet.tflite';

mkdirSync('public/models', { recursive: true });

if (existsSync(MODEL_PATH)) {
  console.log('✓ 모델 파일 이미 존재, 스킵 (public/models/yamnet.tflite)');
} else {
  console.log('⏬ YAMNet 모델 다운로드 중... (~4MB)');
  const file = createWriteStream(MODEL_PATH);
  https.get(MODEL_URL, (res) => {
    res.pipe(file);
    file.on('finish', () => {
      file.close();
      console.log('✓ 모델 다운로드 완료 (public/models/yamnet.tflite)');
    });
  }).on('error', (err) => {
    console.error('❌ 모델 다운로드 실패:', err.message);
    process.exit(1);
  });
}
