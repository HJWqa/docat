import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { loadEnv } from 'vite'

function normalizeServerUrl(url: string): string {
  return url.replace(/\/+$/, '').replace(/\/api$/, '')
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget = normalizeServerUrl(
    (process.env.DOCAT_SERVER_URL ?? env.DOCAT_SERVER_URL ?? '').trim() || 'http://127.0.0.1:9100'
  )

  return {
    plugins: [vue()],
    server: {
      host: '0.0.0.0',
      port: 5173,
      proxy: {
        '/api': proxyTarget,
        '/ws': {
          target: proxyTarget.replace(/^http/, 'ws'),
          ws: true,
        },
      },
    },
  }
})
