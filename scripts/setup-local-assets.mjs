/**
 * setup-local-assets.mjs
 * YAMNet 모델 + MediaPipe WASM을 dist(빌드)와 public(vite dev)에 둡니다.
 */

import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const PUBLIC = path.join(ROOT, "public");

const WASM_SRC = path.join(ROOT, "node_modules", "@mediapipe", "tasks-audio", "wasm");
const YAMNET_URL =
  "https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/1/yamnet.tflite";

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyWasm(wasmDstDir) {
  ensureDir(wasmDstDir);
  const files = [
    "audio_wasm_internal.js",
    "audio_wasm_internal.wasm",
    "audio_wasm_nosimd_internal.js",
    "audio_wasm_nosimd_internal.wasm",
  ];
  let copied = 0;
  for (const file of files) {
    const src = path.join(WASM_SRC, file);
    const dst = path.join(wasmDstDir, file);
    if (!fs.existsSync(src)) {
      console.error(`[WASM] Source not found: ${src}`);
      continue;
    }
    fs.copyFileSync(src, dst);
    copied++;
    console.log(`[WASM] ${path.relative(ROOT, dst)}`);
  }
  console.log(`[WASM] ${copied}/${files.length} → ${path.relative(ROOT, wasmDstDir)}/`);
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
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
        let downloaded = 0;
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

async function ensureYamnet(distModelPath, publicModelPath) {
  ensureDir(path.dirname(distModelPath));
  if (fs.existsSync(distModelPath)) {
    const size = fs.statSync(distModelPath).size;
    if (size > 1_000_000) {
      console.log(`[Model] yamnet.tflite already in dist (${(size / 1e6).toFixed(1)} MB)`);
    }
  } else {
    console.log(`[Model] Downloading yamnet.tflite...`);
    await downloadFile(YAMNET_URL, distModelPath);
    const size = fs.statSync(distModelPath).size;
    console.log(`[Model] Saved dist (${(size / 1e6).toFixed(1)} MB)`);
  }
  ensureDir(path.dirname(publicModelPath));
  fs.copyFileSync(distModelPath, publicModelPath);
  console.log(`[Model] Synced → ${path.relative(ROOT, publicModelPath)}`);
}

async function main() {
  console.log("=== setup-local-assets ===");
  copyWasm(path.join(DIST, "wasm"));
  copyWasm(path.join(PUBLIC, "wasm"));
  await ensureYamnet(path.join(DIST, "models", "yamnet.tflite"), path.join(PUBLIC, "models", "yamnet.tflite"));
  console.log("=== Setup complete ===");
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
