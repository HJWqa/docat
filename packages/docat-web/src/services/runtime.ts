const SERVER_URL = import.meta.env.VITE_DOCAT_SERVER_URL?.trim()

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '').replace(/\/api$/, '')
}

export function getApiBaseUrl(): string {
  if (!SERVER_URL) return ''
  return normalizeUrl(SERVER_URL)
}

export function getWsUrl(): string {
  if (!SERVER_URL) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${location.host}/ws`
  }

  const wsUrl = new URL('/ws', SERVER_URL)
  wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  return wsUrl.toString()
}
