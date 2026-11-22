const channel = 'dsh-jingshen/video-tab/v1'
window.addEventListener('message', async event => {
  const data = event.data
  if (event.source !== window || event.origin !== location.origin || data?.channel !== channel || data.kind !== 'command') return
  if (!['play', 'stop', 'status'].includes(data.action) || !/^[0-9a-f-]{36}$/.test(data.id)
    || !/^spirit-video-[0-9a-f-]{36}$/.test(data.handle)) return
  let result
  try { result = await chrome.runtime.sendMessage({ action: data.action, handle: data.handle }) } catch { /* Extension was closed or reloaded. */ }
  window.postMessage({ channel, id: data.id, kind: 'reply', result }, location.origin)
})
