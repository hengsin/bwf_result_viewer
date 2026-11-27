const { contextBridge, ipcRenderer } = require('electron')

const VALID_ACTIONS = new Set(['in', 'out', 'reset'])

contextBridge.exposeInMainWorld('bwfDesktop', {
  getZoomFactor: () => ipcRenderer.invoke('bwf:get-zoom'),
  zoom: (action) => {
    if (!VALID_ACTIONS.has(action)) {
      return Promise.resolve(1)
    }
    return ipcRenderer.invoke('bwf:zoom', action)
  },
  setZoomFactor: (factor) => {
    if (typeof factor !== 'number' || !Number.isFinite(factor)) {
      return Promise.resolve(1)
    }
    return ipcRenderer.invoke('bwf:set-zoom', factor)
  },
  onZoomChanged: (callback) => {
    if (typeof callback !== 'function') {
      return () => {}
    }
    const listener = (_event, factor) => {
      if (typeof factor === 'number' && Number.isFinite(factor)) {
        callback(factor)
      }
    }
    ipcRenderer.on('bwf:zoom-changed', listener)
    return () => {
      ipcRenderer.removeListener('bwf:zoom-changed', listener)
    }
  },
})
