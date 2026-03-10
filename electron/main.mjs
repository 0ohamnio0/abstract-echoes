import { app, BrowserWindow, session, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, writeFileSync, cpSync } from "node:fs";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Vosk state ────────────────────────────────────────────────────────────────
let voskLib   = null;
let voskModel = null;
const recognizers = new Map();

function isAscii(str) { return !/[^\x00-\x7F]/.test(str); }

function ensureAsciiPath(longPath) {
  if (isAscii(longPath)) return longPath;

  const candidates = [
    process.env.TEMP && isAscii(process.env.TEMP) ? path.join(process.env.TEMP, "bremen-vosk") : null,
    process.env.TMP  && isAscii(process.env.TMP)  ? path.join(process.env.TMP,  "bremen-vosk") : null,
    path.join("C:\\", "Windows", "Temp", "bremen-vosk"),
    path.join("C:\\", "Users",   "Public", "bremen-vosk"),
  ].filter(Boolean).filter(isAscii);

  for (const dst of candidates) {
    const marker = dst + ".ok";
    if (existsSync(marker)) {
      console.log("[Vosk] Using cached ASCII model at:", dst);
      return dst;
    }
    try {
      mkdirSync(dst, { recursive: true });
      console.log("[Vosk] Copying model to ASCII path (one-time):", dst);
      cpSync(longPath, dst, { recursive: true });
      writeFileSync(marker, "");
      console.log("[Vosk] Copy complete.");
      return dst;
    } catch (e) {
      console.warn("[Vosk] Could not copy to", dst, "–", e.message);
      try { require("fs").rmSync(dst, { recursive: true, force: true }); } catch {}
    }
  }
  return longPath;
}

async function initVosk() {
  try {
    const koffi   = require("koffi");
    const dllPath = path.join(__dirname, "..", "models", "vosk", "libvosk.dll");
    const lib = koffi.load(dllPath);
    lib.func("vosk_set_log_level", "void", ["int"])(-1);

    voskLib = {
      model_new:   lib.func("vosk_model_new",                   "void *", ["str"]),
      model_free:  lib.func("vosk_model_free",                  "void",   ["void *"]),
      rec_new:     lib.func("vosk_recognizer_new",              "void *", ["void *", "float"]),
      rec_accept:  lib.func("vosk_recognizer_accept_waveform_s","int",    ["void *", "void *", "int"]),
      rec_result:  lib.func("vosk_recognizer_result",           "str",    ["void *"]),
      rec_partial: lib.func("vosk_recognizer_partial_result",   "str",    ["void *"]),
      rec_free:    lib.func("vosk_recognizer_free",             "void",   ["void *"]),
    };

    const longModelPath = path.join(__dirname, "..", "models", "vosk-model-small-ko-0.22");
    const modelPath = await new Promise((resolve) => setTimeout(() => resolve(ensureAsciiPath(longModelPath)), 0));

    console.log("[Vosk] Loading model:", modelPath);
    const model = voskLib.model_new(modelPath);
    if (!model) throw new Error("vosk_model_new returned null");
    voskModel = model;
    console.log("[Vosk] Model ready ✓");
  } catch (e) {
    console.error("[Vosk] Init failed:", e.message);
    voskLib = voskModel = null;
  }
}

function setupVoskIPC() {
  ipcMain.handle("stt:start", async (event) => {
    const deadline = Date.now() + 120_000;
    while (!voskModel && Date.now() < deadline) await new Promise((r) => setTimeout(r, 500));
    if (!voskModel || !voskLib) return { ok: false, error: "model_not_ready" };

    const id = event.sender.id;
    if (recognizers.has(id)) { try { voskLib.rec_free(recognizers.get(id)); } catch {} recognizers.delete(id); }
    const rec = voskLib.rec_new(voskModel, 16000.0);
    if (!rec) return { ok: false, error: "rec_null" };
    recognizers.set(id, rec);
    console.log("[Vosk] Recognizer started for webContents:", id);
    return { ok: true };
  });

  ipcMain.on("stt:audio", (event, buffer) => {
    const rec = recognizers.get(event.sender.id);
    if (!rec || !voskLib) return;
    try {
      const isFinal = voskLib.rec_accept(rec, buffer, buffer.byteLength / 2);
      if (isFinal) {
        const text = JSON.parse(voskLib.rec_result(rec)).text?.trim() ?? "";
        if (text) { console.log("[Vosk] Result:", text); event.sender.send("stt:result", text, true); }
      } else {
        const text = JSON.parse(voskLib.rec_partial(rec)).partial?.trim() ?? "";
        if (text) event.sender.send("stt:result", text, false);
      }
    } catch (e) { console.error("[Vosk] audio error:", e.message); }
  });

  ipcMain.handle("stt:stop", (event) => {
    const rec = recognizers.get(event.sender.id);
    if (rec && voskLib) { try { voskLib.rec_free(rec); } catch {} recognizers.delete(event.sender.id); }
  });
}

// ── Window ────────────────────────────────────────────────────────────────────
function createWindow() {
  const win = new BrowserWindow({
    width: 1920,
    height: 1080,
    autoHideMenuBar: true,
    fullscreen: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: false,
    },
  });
  win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  win.webContents.openDevTools({ mode: "detach" });
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_, permission, callback) => {
    callback(permission === "media");
  });
  setupVoskIPC();
  initVosk();
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
