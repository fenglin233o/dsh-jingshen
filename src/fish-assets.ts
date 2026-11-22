import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'

/** Only bundled illustrations are public. The conversation and media APIs have separate access checks. */
export function registerFishAssets(ctx: Context, packageRoot: string): () => void {
  const routes = ['activity.png', 'social.png', 'social-rest.png'].map(file => {
    const path = join(packageRoot, 'media', 'fish', file)
    return ctx.webServer.register({ kind: 'exact', path: '/personal-spirit/assets/fish/' + file,
      resource: async request => {
        try {
          const info = await stat(path)
          const etag = `W/"${info.size}-${info.mtimeMs}"`
          const headers = { 'content-type': 'image/png', 'cache-control': 'private, no-cache', etag,
            'x-content-type-options': 'nosniff', 'cross-origin-resource-policy': 'same-origin' }
          if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers })
          return new Response(request.method === 'HEAD' ? null : new Uint8Array(await readFile(path)),
            { headers: { ...headers, 'content-length': String(info.size) } })
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Response(null, { status: 404 })
          throw error
        }
      },
    })
  })
  return () => { for (const remove of routes) remove() }
}
