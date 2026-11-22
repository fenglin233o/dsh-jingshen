// Classic Worker so the MediaPipe Emscripten loader can use importScripts.
export const detectorWorker = `
const base = new URL('./', self.location.href)
let detector
let lastTime = -1
const clamp = value => Math.max(0, Math.min(1, value))
self.onmessage = async ({ data }) => {
  const { type, bitmap, timestamp } = data
  try {
    if (type === 'init') {
      const { FilesetResolver, ObjectDetector } = await import(new URL('vision_bundle.mjs', base).href)
      const files = await FilesetResolver.forVisionTasks(new URL('wasm', base).href)
      detector = await ObjectDetector.createFromOptions(files, {
        baseOptions: { modelAssetPath: new URL('efficientdet_lite0.tflite', base).href, delegate: 'CPU' },
        runningMode: 'VIDEO', maxResults: 8, scoreThreshold: 0.42,
      })
      self.postMessage({ type: 'ready' })
      return
    }
    if (type !== 'detect' || !detector || !bitmap) return
    lastTime = Math.max(timestamp, lastTime + 1)
    const result = detector.detectForVideo(bitmap, lastTime)
    const detections = result.detections.flatMap(({ categories, boundingBox }) => {
      const category = categories[0]
      if (!category || !boundingBox || !/^[a-zA-Z0-9_ -]{1,40}$/.test(category.categoryName)) return []
      const { originX, originY, width, height } = boundingBox
      return [{ label: category.categoryName, confidence: category.score,
        box: [clamp(originX / bitmap.width), clamp(originY / bitmap.height),
          clamp(width / bitmap.width), clamp(height / bitmap.height)] }]
    })
    self.postMessage({ type: 'result', detections })
  } catch (error) {
    self.postMessage({ type: 'error', error: String(error) })
  } finally { bitmap?.close() }
}
`
