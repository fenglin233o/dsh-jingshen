const domain = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z](?:[a-z0-9-]*[a-z0-9])?$/i

export function videoHost(input: string): string {
  const host = input.trim().toLowerCase()
  if (host.length > 253 || !domain.test(host) || host.split('.').some(label => label.length > 63)) {
    throw new Error('请输入一个 HTTPS 视频域名，不含地址路径或端口。')
  }
  return host
}

export function permittedVideoUrl(input: string, allowedHost: string): string {
  // URL.port normalizes away an explicit :443. Inspect the authority first.
  const authority = /^https:\/\/([^/?#]+)(?:[/?]|$)/i.exec(input)?.[1]
  if (!authority || authority.toLowerCase() !== allowedHost || input.includes('#') || /[\\\s]/.test(input)) {
    throw new Error('视频地址必须位于本人授权的 HTTPS 域名，不含登录信息、端口或片段。')
  }
  const url = new URL(input)
  if (url.protocol !== 'https:' || url.hostname !== allowedHost || url.username || url.password || url.port) {
    throw new Error('视频地址超出本人授权的来源。')
  }
  return url.href
}
