/**
 * Preload (sandboxed, context-isolated): exposes a tiny, read-mostly bridge as `window.orbitalDesktop`.
 * The scene does not need it; it lets in-game UI detect the desktop build and open the app settings later.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('orbitalDesktop', {
  isDesktop: true,
  platform: process.platform,
  versions: { electron: process.versions.electron, chrome: process.versions.chrome },
  toggleFullscreen: () => ipcRenderer.send('desktop:toggle-fullscreen'),
  openSettings: () => ipcRenderer.send('desktop:open-menu'),
  gpuInfo: () => ipcRenderer.invoke('desktop:gpu-info'),
});
