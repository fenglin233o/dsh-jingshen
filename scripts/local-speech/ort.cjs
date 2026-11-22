const { readFile } = require('node:fs/promises')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')

// The worker loads the CPU build and its exact WASM binary from the plugin.
// Passing the bytes also works from offline npm installs and paths with spaces.
let runtime
exports.loadOrt = function loadOrt() {
  return runtime ??= (async () => {
    const directory = join(__dirname, 'ort')
    const moduleUrl = name => pathToFileURL(join(directory, name)).href
    const ort = await import(moduleUrl('ort.wasm.min.mjs'))
    ort.env.wasm.numThreads = 1
    ort.env.wasm.proxy = false
    ort.env.wasm.wasmPaths = { mjs: moduleUrl('ort-wasm-simd-threaded.mjs') }
    ort.env.wasm.wasmBinary = await readFile(join(directory, 'ort-wasm-simd-threaded.wasm'))
    return ort
  })()
}
