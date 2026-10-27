"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("myBrush", {
  inputDiagnostic: (report) =>
    ipcRenderer.send("brush:input-diagnostic", report),
  interaction: (value) => ipcRenderer.send("brush:interaction", value),
  init: () => ipcRenderer.invoke("brush:init"),
  hide: () => ipcRenderer.invoke("brush:hide"),
  readyToHide: (token) => ipcRenderer.send("brush:hide-ready", token),
  save: (preferences) => ipcRenderer.invoke("brush:save", preferences),
  selectTool: (tool) => ipcRenderer.invoke("brush:tool", tool),
  onState: (callback) =>
    ipcRenderer.on("brush:state", (_event, state) => callback(state)),
  onCommand: (callback) =>
    ipcRenderer.on("brush:command", (_event, command) => callback(command)),
});
