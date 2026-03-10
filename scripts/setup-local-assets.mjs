/**
 * setup-local-assets.mjs
 * 포터블 패키지에 필요한 로컬 에셋(YAMNET 모델, MediaPipe WASM)을 준비합니다.
 * npm run setup 또는 빌드 전에 자동으로 실행됩니다.
 */

import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");

const WASM_SRC = path.join(ROOT, "node_modules", "@mediapipe", "tasks-audio", "wasm");
const WASM_DST = path.join(DIST, "wasm");

const MODELS_DST = path.join(DIST, "models");
const YAMNET_URL =
  "https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/1/yamnet.tflite";
const YAMNET_DST = path.join(MODELS_DST, "yamnet.tflite");

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyWasm() {
  ensureDir(WASM_DST);
  const files = [
    "audio_wasm_internal.js",
    "audio_wasm_internal.wasm",
    "audio_wasm_nosimd_internal.js",
    "audio_wasm_nosimd_internal.wasm",
  ];
  let copied = 0;
  for (const file of files) {
    const src = path.join(WASM_SRC, file);
    const dst = path.join(WASM_DST, file);
    if (!fs.existsSync(src)) {
      console.error(`[WASM] Source not found: ${src}`);
      continue;
    }
    fs.copyFileSync(src, dst);
    copied++;
    console.log(`[WASM] Copied: ${file}`);
  }
  console.log(`[WASM] ${copied}/${files.length} files copied to dist/wasm/`);
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    let downloaded = 0;
    const request = (reqUrl) => {
      https.get(reqUrl, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          file.close();
          request(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const total = parseInt(res.headers["content-length"] || "0", 10);
        res.on("data", (chunk) => {
          downloaded += chunk.length;
          if (total > 0) {
            const pct = Math.round((downloaded / total) * 100);
            process.stdout.write(`\r[Model] Downloading yamnet.tflite... ${pct}%`);
          }
        });
        res.pipe(file);
        res.on("end", () => {
          process.stdout.write("\n");
          resolve();
        });
        res.on("error", reject);
      }).on("error", reject);
    };
    request(url);
    file.on("error", reject);
  });
}

async function downloadYamnet() {
  ensureDir(MODELS_DST);
  if (fs.existsSync(YAMNET_DST)) {
    const size = fs.statSync(YAMNET_DST).size;
    if (size > 1_000_000) {
      console.log(`[Model] yamnet.tflite already exists (${(size / 1e6).toFixed(1)} MB), skipping.`);
      return;
    }
  }
  console.log(`[Model] Downloading yamnet.tflite from Google Storage...`);
  await downloadFile(YAMNET_URL, YAMNET_DST);
  const size = fs.statSync(YAMNET_DST).size;
  console.log(`[Model] yamnet.tflite saved (${(size / 1e6).toFixed(1)} MB)`);
}

async function main() {
  console.log("=== setup-local-assets ===");
  copyWasm();
  await downloadYamnet();
  console.log("=== Setup complete ===");
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
