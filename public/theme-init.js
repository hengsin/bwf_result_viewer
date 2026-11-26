try {
  var s = localStorage.getItem('bwf:color-scheme:v1')
  if (s === 'light' || s === 'dark') {
    var meta = document.querySelector('meta[name="color-scheme"]')
    if (meta) {
      meta.setAttribute('content', s)
    }
  }
} catch (_e) {}
