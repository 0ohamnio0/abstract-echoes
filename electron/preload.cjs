"use strict";

const { contextBridge, ipcRenderer } = require("electron");

// Expose minimal IPC bridge to renderer world
contextBridge.exposeInMainWorld("__sttBridge", {
  start:  ()    => ipcRenderer.invoke("stt:start"),
  stop:   ()    => ipcRenderer.invoke("stt:stop"),
  // buf must be an ArrayBuffer (Int16 PCM at 16 kHz)
  sendAudio: (buf) => ipcRenderer.send("stt:audio", Buffer.from(buf)),
  onResult: (cb) => ipcRenderer.on("stt:result", (_, text, isFinal) => cb(text, isFinal)),
});
