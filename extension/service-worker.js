async function configureSidePanel() {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  } catch (err) {
    console.error('Failed to set side panel behavior:', err)
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void configureSidePanel()
})

chrome.runtime.onStartup.addListener(() => {
  void configureSidePanel()
})

void configureSidePanel()
