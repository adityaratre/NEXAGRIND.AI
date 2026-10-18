import { readFileSync, existsSync } from 'node:fs'

function readEnv(path = '.env') {
  if (!existsSync(path)) return {}
  const out = {}
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const i = line.indexOf('=')
    if (i < 1) continue
    const key = line.slice(0, i).trim()
    let value = line.slice(i + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    out[key] = value
  }
  return out
}

const env = readEnv()
const url = env.VITE_SUPABASE_URL?.replace(/\/+$/, '')
const anonKey = env.VITE_SUPABASE_ANON_KEY
let failed = false
const result = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failed = true
}

if (!url || !anonKey) {
  console.log('FAIL  Local .env configuration — missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY')
  console.log('Copy .env.example to .env and fill in the Supabase Project URL and publishable/anon key. Do not use a service_role/secret key here. AI provider keys belong only in Supabase Edge Function Secrets.')
  process.exit(1)
}

try {
  const project = new URL(url)
  result('Supabase URL format', project.protocol === 'https:' && project.hostname.endsWith('.supabase.co'), project.hostname)
  if (project.protocol !== 'https:' || !project.hostname.endsWith('.supabase.co')) process.exit(1)
} catch {
  result('Supabase URL format', false, 'URL is invalid')
  process.exit(1)
}

const headers = { apikey: anonKey, Authorization: `Bearer ${anonKey}` }
try {
  const response = await fetch(`${url}/auth/v1/settings`, { headers, signal: AbortSignal.timeout(12000) })
  const body = await response.json().catch(() => ({}))
  result('Supabase Auth endpoint reachable', response.ok, `HTTP ${response.status}`)
  if (response.ok) {
    const providers = Array.isArray(body.external) ? body.external : []
    result('Google provider enabled in Supabase Auth', providers.includes('google'), providers.includes('google') ? 'enabled' : 'not listed; check Auth → Providers → Google')
  }
} catch (error) {
  result('Supabase Auth endpoint reachable', false, error?.cause?.code || error?.message || 'network error')
}

try {
  const response = await fetch(`${url}/rest/v1/reports?select=id&limit=1`, { headers, signal: AbortSignal.timeout(12000) })
  const body = await response.json().catch(() => null)
  if (response.ok) {
    result('Database reports table + anon SELECT policy', true, 'query succeeded')
  } else {
    const message = typeof body?.message === 'string' ? body.message : `HTTP ${response.status}`
    result('Database reports table + anon SELECT policy', false, message)
  }
} catch (error) {
  result('Database reports table + anon SELECT policy', false, error?.cause?.code || error?.message || 'network error')
}

console.log('\nNote: this diagnostic never prints your key. It does not create data or prove Google OAuth sign-in works end-to-end. Run the app and complete a real Google sign-in to test the callback/session.')
process.exitCode = failed ? 1 : 0
