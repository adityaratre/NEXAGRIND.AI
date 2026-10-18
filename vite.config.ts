import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Keep one predictable local port; fail loudly rather than silently sending the user
// to an old Vite server on 5173 while the updated project starts on 5174.
function normalizePublicUrl(raw: string | undefined): string | undefined {
  if (!raw?.trim()) return undefined
  try {
    const parsed = new URL(raw.trim())
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) return undefined
    return parsed.origin.replace(/\/$/, '')
  } catch {
    return undefined
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const publicUrl = normalizePublicUrl(env.VITE_SITE_URL || process.env.VITE_SITE_URL)
  const publicSeoPlugin = {
    name: 'lokpravaah-production-seo',
    transformIndexHtml(html: string) {
      if (publicUrl) return html.replaceAll('__LOKPRAVAAH_SITE_URL__', publicUrl).replaceAll(' data-site-dependent=\"true\"', '')
      return html.replace(/^\s*<(?:link|meta)[^>]*data-site-dependent=\"true\"[^>]*>\s*$/gm, '')
    },
  }
  return {
  plugins: [react(), publicSeoPlugin],
  server: { port: 5173, strictPort: true },
  }
})
