import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = process.cwd()
function parseEnv(content) {
  const values = {}
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
  }
  return values
}
let fileEnv = {}
for (const file of ['.env', '.env.local', '.env.production', '.env.production.local']) {
  try { fileEnv = { ...fileEnv, ...parseEnv(await readFile(resolve(root, file), 'utf8')) } } catch { /* optional file */ }
}
const rawUrl = process.env.VITE_SITE_URL || fileEnv.VITE_SITE_URL || ''
let siteUrl = ''
try {
  const parsed = new URL(rawUrl.trim())
  if (parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.search && !parsed.hash) siteUrl = parsed.origin.replace(/\/$/, '')
} catch { /* invalid/missing URL */ }
const dist = resolve(root, 'dist')
await mkdir(dist, { recursive: true })
if (!siteUrl) {
  await writeFile(resolve(dist, 'robots.txt'), 'User-agent: *\nAllow: /\n', 'utf8')
  try { await unlink(resolve(dist, 'sitemap.xml')) } catch { /* no stale sitemap */ }
  console.warn('[SEO] VITE_SITE_URL is missing or is not a valid HTTPS origin. robots.txt created; sitemap.xml was not fabricated. Set your real deployment URL and rebuild.')
  process.exit(0)
}
const today = new Date().toISOString().slice(0, 10)
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${siteUrl}/</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>\n</urlset>\n`
await writeFile(resolve(dist, 'sitemap.xml'), sitemap, 'utf8')
await writeFile(resolve(dist, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${siteUrl}/sitemap.xml\n`, 'utf8')
console.log(`[SEO] Generated robots.txt and sitemap.xml for ${siteUrl}`)
