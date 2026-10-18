import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version, x-supabase-client-platform, x-supabase-client-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
}
const MAX_PROMPT_LENGTH = 4000
const MAX_OUTPUT_TOKENS = 1200
const TIMEOUT_MS = 8000
const MAX_TOTAL_AI_MS = 50000
const MAX_OPENROUTER_MODELS = 2
const hits = new Map<string, number[]>()

type ProviderResult = { answer: string; provider: string; model: string; fallback_level: number }
type ProviderFailure = { provider: string; model: string; status?: number; reason: string }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' } })
}
function env(name: string, fallback = '') { return (Deno.env.get(name) ?? fallback).trim() }
function enabled(name: string, defaultValue = false) { const v = env(name).toLowerCase(); return v ? ['1','true','yes','on'].includes(v) : defaultValue }
function limitRequest(userId: string): boolean {
  const now = Date.now()
  const recent = (hits.get(userId) ?? []).filter(t => now - t < 60_000)
  if (recent.length >= 12) { hits.set(userId, recent); return false }
  recent.push(now); hits.set(userId, recent)
  return true
}
function systemPrompt(task: string, responseLanguage: string) {
  const languageRule = responseLanguage === 'hindi'
    ? 'MANDATORY RESPONSE LANGUAGE: Hindi written in Devanagari. Reply in Hindi, even if technical terms are in English. Do not default to Hinglish or English.'
    : responseLanguage === 'hinglish'
      ? 'MANDATORY RESPONSE LANGUAGE: Hinglish, using natural Roman-script Hindi mixed with English like the user. Do not switch to Devanagari Hindi or formal English unless asked.'
      : responseLanguage === 'english'
        ? 'MANDATORY RESPONSE LANGUAGE: English. Answer in English only unless the user explicitly asks you to translate or answer in another language. Do not default to Hindi.'
        : 'Detect the language and script of the latest user question. English question = English answer; Hindi/Devanagari question = Hindi answer; Roman Hindi mixed with English = Hinglish answer. Keep the same language throughout.'
  const common = `You are LokPravaah AI, a helpful, honest assistant inside an independent public-use civic platform. ${languageRule} Understand Hindi, English and Hinglish. Be practical, clear, respectful and conversational. Never invent facts, laws, sections, penalties, deadlines, official contacts, citations, evidence or case numbers. Distinguish confirmed information from assumptions and suggestions. Never claim that a complaint has been submitted or a claim independently verified. Protect privacy: never ask for passwords, OTPs, PINs, full Aadhaar numbers or unnecessary sensitive data. Keep the answer structured and ask a focused follow-up when essential facts are missing. This platform is not a government portal.`
  const instructions: Record<string, string> = {
    general_chat: `Answer general questions like a capable general-purpose chatbot: education, coding, writing, technology, planning, explanations, brainstorming and everyday topics. Follow the user's requested format and level of detail. For current facts or specialized high-stakes topics, be transparent about limitations and suggest checking reliable primary sources.`,
    legal_rights: `Provide general legal information, not legal representation. First establish country/state and relevant facts when they change the answer. For India-specific queries, distinguish central law from state rules and local procedures. Cite an exact Act/section or official source only when reasonably confident; if not verified, say so and explain how to verify it. Explain what facts would change the answer, practical lawful next steps and relevant official complaint/payment channels. For police/traffic questions, distinguish an official challan/receipt from a demand for unofficial cash; do not assert misconduct without facts. Do not guarantee outcomes.`,
    civic_assistant: `Help users organise civic observations, prepare neutral complaints, identify evidence to preserve and understand grievance channels. Separate observed facts from allegations. Do not claim that the platform submits an official complaint.`,
    document_drafting: `Draft and improve civic complaints, RTI applications, representations, formal letters and document summaries. Use placeholders for unknown facts, do not invent names or dates, and clearly label drafts as not submitted. Explain that RTI processes and authorities depend on jurisdiction.`,
    admin_connection_test: `Reply with exactly: LokPravaah AI connection test successful.`,
  }
  return `${common}\n\nMode-specific instructions: ${instructions[task] ?? instructions.civic_assistant}`
}
async function timedFetch(url: string, init: RequestInit, deadlineMs: number): Promise<Response> {
  const controller = new AbortController()
  const remainingMs = Math.max(0, Math.min(TIMEOUT_MS, deadlineMs - Date.now()))
  if (remainingMs <= 0) throw new Error('AI request time budget exhausted')
  const timer = setTimeout(() => controller.abort(), remainingMs)
  try {
    // Keep the timeout active until the response body has been received as well as its headers.
    // fetch() alone resolves at headers, so clearing the timer there can leave response.json() hanging.
    const response = await fetch(url, { ...init, signal: controller.signal })
    const body = await response.arrayBuffer()
    const headers = new Headers(response.headers)
    // fetch transparently decompresses bodies; do not copy stale wire-level size/encoding metadata.
    headers.delete('content-length')
    headers.delete('content-encoding')
    return new Response(body, { status: response.status, statusText: response.statusText, headers })
  } finally { clearTimeout(timer) }
}
async function readError(response: Response): Promise<string> {
  try {
    const data = await response.json()
    return String(data?.error?.message ?? data?.error ?? data?.message ?? `HTTP ${response.status}`).slice(0, 300)
  } catch { return `HTTP ${response.status}` }
}
async function openRouterCall(model: string, apiKey: string, prompt: string, task: string, responseLanguage: string, deadlineMs: number): Promise<string> {
  const requestHeaders: Record<string, string> = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'LokPravaah Civic Assistant' }
  const siteUrl = env('LOKPRAVAAH_SITE_URL') || env('JANWATCH_SITE_URL')
  if (siteUrl) requestHeaders['HTTP-Referer'] = siteUrl
  const response = await timedFetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST', headers: requestHeaders,
    body: JSON.stringify({ model, temperature: 0.25, max_tokens: MAX_OUTPUT_TOKENS, messages: [{ role: 'system', content: systemPrompt(task, responseLanguage) }, { role: 'user', content: prompt }] }),
  }, deadlineMs)
  if (!response.ok) throw Object.assign(new Error(await readError(response)), { status: response.status })
  const data = await response.json()
  const answer = data?.choices?.[0]?.message?.content
  if (typeof answer !== 'string' || !answer.trim()) throw new Error('Provider returned an empty answer')
  return answer.trim()
}
async function geminiCall(model: string, apiKey: string, prompt: string, task: string, responseLanguage: string, deadlineMs: number): Promise<string> {
  const response = await timedFetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: systemPrompt(task, responseLanguage) }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.25, maxOutputTokens: MAX_OUTPUT_TOKENS } }),
  }, deadlineMs)
  if (!response.ok) throw Object.assign(new Error(await readError(response)), { status: response.status })
  const data = await response.json()
  const answer = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('')
  if (typeof answer !== 'string' || !answer.trim()) throw new Error('Provider returned an empty answer')
  return answer.trim()
}
async function groqCall(model: string, apiKey: string, prompt: string, task: string, responseLanguage: string, deadlineMs: number): Promise<string> {
  const response = await timedFetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, temperature: 0.25, max_tokens: MAX_OUTPUT_TOKENS, messages: [{ role: 'system', content: systemPrompt(task, responseLanguage) }, { role: 'user', content: prompt }] }),
  }, deadlineMs)
  if (!response.ok) throw Object.assign(new Error(await readError(response)), { status: response.status })
  const data = await response.json()
  const answer = data?.choices?.[0]?.message?.content
  if (typeof answer !== 'string' || !answer.trim()) throw new Error('Provider returned an empty answer')
  return answer.trim()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (!enabled('LOKPRAVAAH_AI_ENABLED', enabled('JANWATCH_AI_ENABLED', true))) return json({ ai_available: false, code: 'ai_paused', message: 'The AI assistant is paused for now. You can still use the complaint and RTI drafting tools.' }, 200)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Please sign in to use LokPravaah AI.' }, 401)
  const supabaseUrl = env('SUPABASE_URL')
  const anonKey = env('SUPABASE_ANON_KEY') || (() => { try { return JSON.parse(env('SUPABASE_PUBLISHABLE_KEYS', '{}')).default ?? '' } catch { return '' } })()
  if (!supabaseUrl || !anonKey) return json({ error: 'Supabase authentication is not configured for this function.' }, 500)
  const authClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false, autoRefreshToken: false } })
  const { data: authData, error: authError } = await authClient.auth.getUser()
  if (authError || !authData.user) return json({ error: 'Your session could not be verified. Sign in again and retry.' }, 401)
  if (!limitRequest(authData.user.id)) return json({ error: 'AI request limit reached. Please wait a minute and try again.' }, 429)

  // The admin feature switch is public-readable by design; only admins can change it via RLS.
  const { data: aiFlag, error: aiFlagError } = await authClient.from('app_feature_flags').select('enabled').eq('flag_key', 'janwatch_ai').maybeSingle()
  if (!aiFlagError && aiFlag && aiFlag.enabled === false) {
    return json({ ai_available: false, code: 'ai_paused', message: 'The AI assistant is paused for now. You can still use the complaint and RTI drafting tools.' }, 200)
  }

  let body: { prompt?: unknown; task?: unknown; response_language?: unknown }
  try { body = await req.json() } catch { return json({ error: 'Request body must be valid JSON.' }, 400) }
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  const acceptedTasks = new Set(['general_chat', 'legal_rights', 'civic_assistant', 'document_drafting', 'admin_connection_test'])
  const requestedTask = typeof body.task === 'string' ? body.task.slice(0, 80) : 'civic_assistant'
  const task = acceptedTasks.has(requestedTask) ? requestedTask : 'general_chat'
  const requestedLanguage = typeof body.response_language === 'string' ? body.response_language : 'auto'
  const responseLanguage = ['english', 'hindi', 'hinglish'].includes(requestedLanguage) ? requestedLanguage : 'auto'
  if (!prompt) return json({ error: 'Enter a question first.' }, 400)
  if (prompt.length > MAX_PROMPT_LENGTH) return json({ error: `Question must be no longer than ${MAX_PROMPT_LENGTH} characters.` }, 400)

  const startedAt = Date.now()
  const deadlineMs = startedAt + MAX_TOTAL_AI_MS
  const failures: ProviderFailure[] = []
  const routerKey = env('OPENROUTER_API_KEY')
  const configuredModels = env('OPENROUTER_MODELS')
  // Try up to two configured models, then reserve one attempt for the official free router.
  // This prevents old/paid-only settings from disabling OpenRouter and leaves a time budget for backup providers.
  const configuredList = [...new Set((configuredModels || '').split(',').map(v => v.trim()).filter(Boolean))].slice(0, MAX_OPENROUTER_MODELS - 1)
  const allowPaid = enabled('AI_ALLOW_PAID_OPENROUTER_MODELS', false)
  const configuredSafeModels = allowPaid ? configuredList : configuredList.filter(model => model === 'openrouter/free' || model.endsWith(':free'))
  const safeModels = [...new Set([...configuredSafeModels, 'openrouter/free'])].slice(0, MAX_OPENROUTER_MODELS)
  let level = 0

  if (routerKey) {
    for (const model of safeModels) {
      if (Date.now() >= deadlineMs) break
      level++
      try {
        const answer = await openRouterCall(model, routerKey, prompt, task, responseLanguage, deadlineMs)
        console.log(JSON.stringify({ event: 'janwatch_ai_success', user_id: authData.user.id, provider: 'openrouter', model, fallback_level: level, prompt_chars: prompt.length }))
        return json({ answer, provider: 'OpenRouter', model, fallback_level: level, ai_available: true })
      } catch (error) {
        const failure = error as Error & { status?: number }
        failures.push({ provider: 'openrouter', model, status: failure.status, reason: (failure.message || 'request failed').slice(0, 180) })
      }
    }
  } else failures.push({ provider: 'openrouter', model: '(not configured)', reason: 'OPENROUTER_API_KEY missing' })
  // safeModels always includes openrouter/free when a primary key exists.

  const geminiKey = env('GEMINI_API_KEY')
  if (Date.now() < deadlineMs && enabled('AI_ENABLE_GEMINI_BACKUP', true) && geminiKey) {
    // If an old/invalid model name was saved in Secrets, retry with a known current model.
    const configuredGeminiModel = env('GEMINI_MODEL')
    const geminiModels = [...new Set([configuredGeminiModel, 'gemini-2.5-flash'].filter(Boolean))]
    for (const model of geminiModels) {
      if (Date.now() >= deadlineMs) break
      level++
      try {
        const answer = await geminiCall(model, geminiKey, prompt, task, responseLanguage, deadlineMs)
        console.log(JSON.stringify({ event: 'janwatch_ai_success', user_id: authData.user.id, provider: 'gemini', model, fallback_level: level, prompt_chars: prompt.length }))
        return json({ answer, provider: 'Gemini', model, fallback_level: level, ai_available: true })
      } catch (error) { const failure = error as Error & { status?: number }; failures.push({ provider: 'gemini', model, status: failure.status, reason: (failure.message || 'request failed').slice(0, 180) }) }
    }
  } else failures.push({ provider: 'gemini', model: env('GEMINI_MODEL', 'gemini-2.5-flash'), reason: Date.now() >= deadlineMs ? 'total AI time budget exhausted' : !enabled('AI_ENABLE_GEMINI_BACKUP', true) ? 'backup disabled by configuration' : 'GEMINI_API_KEY missing' })

  const groqKey = env('GROQ_API_KEY')
  if (Date.now() < deadlineMs && enabled('AI_ENABLE_GROQ_BACKUP', true) && groqKey) {
    const model = env('GROQ_MODEL', 'llama-3.3-70b-versatile')
    level++
    try {
      const answer = await groqCall(model, groqKey, prompt, task, responseLanguage, deadlineMs)
      console.log(JSON.stringify({ event: 'janwatch_ai_success', user_id: authData.user.id, provider: 'groq', model, fallback_level: level, prompt_chars: prompt.length }))
      return json({ answer, provider: 'Groq', model, fallback_level: level, ai_available: true })
    } catch (error) { const failure = error as Error & { status?: number }; failures.push({ provider: 'groq', model, status: failure.status, reason: (failure.message || 'request failed').slice(0, 180) }) }
  } else failures.push({ provider: 'groq', model: env('GROQ_MODEL', 'llama-3.3-70b-versatile'), reason: Date.now() >= deadlineMs ? 'total AI time budget exhausted' : !enabled('AI_ENABLE_GROQ_BACKUP', true) ? 'backup disabled by default' : 'GROQ_API_KEY missing' })

  // Never fabricate a response. Return a useful, non-secret diagnostic so the UI can distinguish
  // missing provider credentials from provider/model/rate-limit failures. Full provider errors stay in Edge Function logs.
  console.warn(JSON.stringify({ event: 'janwatch_ai_all_providers_failed', user_id: authData.user.id, failures }))
  const hasAnyKey = Boolean(routerKey || geminiKey || groqKey)
  const missingPrimaryConfig = !hasAnyKey
  const failureCodes = failures.map(f => `${f.provider}${f.status ? `:${f.status}` : ''}`).join(', ')
  return json({
    ai_available: false,
    code: missingPrimaryConfig ? 'ai_not_configured' : 'ai_provider_failed',
    message: missingPrimaryConfig
      ? 'AI is not configured on the server yet. Add OPENROUTER_API_KEY or GEMINI_API_KEY in Supabase Edge Function Secrets, then redeploy janwatch-ai.'
      : `AI providers did not return a response (${failureCodes || 'timeout or configuration error'}). Check Supabase Edge Function logs for janwatch-ai; the issue is in provider configuration, model access, quota, or network—not your question.`,
  }, 200)
})
