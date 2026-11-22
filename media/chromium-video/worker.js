const loopback = url => ['127.0.0.1', 'localhost'].includes(url.hostname) && ['http:', 'https:'].includes(url.protocol)
const allowedActions = new Set(['status', 'play', 'stop'])
const updateBadge = (tabId, text, title) => Promise.allSettled([
  chrome.action.setBadgeText({ tabId, text }), chrome.action.setTitle({ tabId, title })
])

// These functions run on the selected page. No site-specific account data crosses this boundary.
function configureCapture(handle, origin) {
  if (!navigator.mediaDevices?.setCaptureHandleConfig) return false
  navigator.mediaDevices.setCaptureHandleConfig({ handle, exposeOrigin: false, permittedOrigins: origin ? [origin] : [] })
  return true
}
async function operateVideo(action) {
  const area = item => {
    if (!item.isConnected || !item.getClientRects().length) return 0
    const style = getComputedStyle(item)
    if (style.visibility !== 'visible' || Number(style.opacity) === 0 || item.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true }) === false) return 0
    const rect = item.getBoundingClientRect()
    const width = Math.max(0, Math.min(innerWidth, rect.right) - Math.max(0, rect.left))
    const height = Math.max(0, Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top))
    return width * height
  }
  const candidates = [...document.querySelectorAll('video')].map(video => ({ video, area: area(video) })).filter(item => item.area > 0)
  candidates.sort((a, b) => Number(!b.video.paused) - Number(!a.video.paused) || b.area - a.area)
  const video = candidates[0]?.video
  if (!video || !Number.isFinite(video.currentTime)) return null
  if (action === 'play') await video.play()
  else if (action === 'stop') video.pause()
  return { time: video.currentTime, playing: !video.paused && !video.ended && video.readyState >= 2 }
}
async function detach(target) {
  if (!target) return
  await Promise.allSettled([
    chrome.scripting.executeScript({ target: { tabId: target.id }, world: 'MAIN', func: configureCapture, args: ['', null] }),
    updateBadge(target.id, '', '授权当前视频页')
  ])
}
let order = Promise.resolve()
function serialize(operation) {
  const next = order.then(operation)
  order = next.catch(() => {})
  return next
}
async function selectTab(tab) {
  if (!Number.isInteger(tab.id) || !tab.url) return
  const url = new URL(tab.url)
  const { controller, target } = await chrome.storage.session.get(['controller', 'target'])
  if (loopback(url)) {
    const verified = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: async () => {
      const response = await fetch('/personal-spirit/assets/fish/activity.png', { method: 'HEAD', credentials: 'same-origin' })
      return response.ok && response.headers.get('content-type')?.startsWith('image/png')
    } })
    if (!verified[0]?.result) return updateBadge(tab.id, '?', '请打开运行着精神的本地 Harness')
    await chrome.storage.session.remove(['controller', 'target'])
    await detach(target)
    if (controller) await updateBadge(controller.id, '', '连接本地精神')
    if (controller?.id === tab.id && controller.origin === url.origin) return
    await chrome.storage.session.set({ controller: { id: tab.id, origin: url.origin } })
    return updateBadge(tab.id, '主', '本标签页已连接精神，再点一次解除')
  }
  if (url.protocol !== 'https:' || !controller) return updateBadge(tab.id, '?', '请先在本地 Harness 页点击一次本扩展')
  await chrome.storage.session.remove('target')
  await detach(target)
  if (target?.id === tab.id) return
  const handle = 'spirit-video-' + crypto.randomUUID()
  const set = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN',
    func: configureCapture, args: [handle, controller.origin] })
  if (!set[0]?.result) return updateBadge(tab.id, '?', '此页无法提供标签页捕获标识')
  await chrome.storage.session.set({ target: { id: tab.id, handle, documentId: set[0].documentId } })
  return updateBadge(tab.id, '✓', '已授权此视频页，再点一次解除')
}
chrome.action.onClicked.addListener(tab => {
  void serialize(() => selectTab(tab)).catch(() => updateBadge(tab.id, '?', '连接失败，请在本地 Harness 和视频页重新授权'))
})
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !sender.tab || !sender.url
    || !loopback(new URL(sender.url)) || !allowedActions.has(message?.action) || typeof message.handle !== 'string') return
  void serialize(async () => {
    const { controller, target } = await chrome.storage.session.get(['controller', 'target'])
    if (sender.tab.id !== controller?.id || new URL(sender.url).origin !== controller.origin || !target || target.handle !== message.handle) return null
    const results = await chrome.scripting.executeScript({ target: { tabId: target.id, documentIds: [target.documentId] },
      func: operateVideo, args: [message.action] })
    return results[0]?.result ?? null
  }).then(sendResponse, () => sendResponse(null))
  return true
})
chrome.tabs.onRemoved.addListener(id => {
  void serialize(async () => {
    const { controller, target } = await chrome.storage.session.get(['controller', 'target'])
    if (id === controller?.id) { await chrome.storage.session.remove(['controller', 'target']); await detach(target) }
    else if (id === target?.id) await chrome.storage.session.remove('target')
  })
})
