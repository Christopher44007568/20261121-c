const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

const useSoftwareGl =
  process.env.INK_GPU_MODE === "swiftshader" ||
  (process.platform === "linux" && Boolean(process.env.WSL_DISTRO_NAME));

if (useSoftwareGl) {
  app.commandLine.appendSwitch("use-angle", "swiftshader");
  app.commandLine.appendSwitch("enable-unsafe-swiftshader");
  app.commandLine.appendSwitch("disable-gpu-sandbox");
}
app.commandLine.appendSwitch("ignore-gpu-blocklist");

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: "#161916",
    title: "FIBER / INK",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(() => {
  ipcMain.handle("export:choose-directory", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "选择过程帧导出文件夹",
      properties: ["openDirectory", "createDirectory"]
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("export:write-frame", async (_event, payload) => {
    const directory = path.resolve(String(payload.directory));
    const name = path.basename(String(payload.name));
    if (!name.endsWith(".png")) throw new Error("Only PNG frame export is allowed");
    await fs.mkdir(directory, { recursive: true });
    const data = String(payload.dataUrl).replace(/^data:image\/png;base64,/, "");
    await fs.writeFile(path.join(directory, name), Buffer.from(data, "base64"));
    return path.join(directory, name);
  });

  ipcMain.handle("export:write-manifest", async (_event, payload) => {
    const directory = path.resolve(String(payload.directory));
    const name = path.basename(String(payload.name));
    await fs.mkdir(directory, { recursive: true });
    const target = path.join(directory, name);
    await fs.writeFile(target, JSON.stringify(payload.manifest, null, 2));
    return target;
  });

  ipcMain.handle("app:reveal", async (_event, directory) => {
    shell.showItemInFolder(directory);
  });

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
