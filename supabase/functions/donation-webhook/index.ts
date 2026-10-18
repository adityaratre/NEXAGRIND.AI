import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8' }
const MAX_BODY_BYTES = 64 * 1024

type GatewayPayload = {
  event?: string
  paymentId?: string
  orderId?: string
  order_id?: string
  amount?: string | number
  amountPaise?: number
  currency?: string
  utr?: string
  completedAt?: string
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders })
}
function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
}
function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let mismatch = 0
  for (let i = 0; i < left.length; i++) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i)
  return mismatch === 0
}
async function verifySignature(rawBody: Uint8Array, signatureHeader: string, secret: string): Promise<boolean> {
  if (!secret || !signatureHeader.startsWith('sha256=')) return false
  const supplied = signatureHeader.slice('sha256='.length).trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(supplied)) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const expected = `sha256=${toHex(await crypto.subtle.sign('HMAC', key, rawBody))}`
  return constantTimeEqual(signatureHeader.trim().toLowerCase(), expected)
}
function parseAmountPaise(payload: GatewayPayload): number | null {
  if (Number.isSafeInteger(payload.amountPaise)) return Number(payload.amountPaise)
  if (payload.amount === undefined || payload.amount === null) return null
  const value = Number(payload.amount)
  if (!Number.isFinite(value) || value <= 0) return null
  const paise = Math.round(value * 100)
  return Number.isSafeInteger(paise) ? paise : null
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, x-gateway-event, x-gateway-signature, x-gateway-delivery-id, x-gateway-timestamp', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const secret = (Deno.env.get('DONATION_WEBHOOK_SECRET') ?? '').trim()
  const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').trim()
  const serviceRoleKey = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '').trim()
  if (!secret || !supabaseUrl || !serviceRoleKey) {
    console.error('Donation webhook configuration is incomplete.')
    return json({ error: 'Webhook is not configured' }, 503)
  }

  const declaredLength = Number(request.headers.get('content-length') ?? 0)
  if (declaredLength > MAX_BODY_BYTES) return json({ error: 'Payload too large' }, 413)
  const rawBody = new Uint8Array(await request.arrayBuffer())
  if (rawBody.byteLength > MAX_BODY_BYTES) return json({ error: 'Payload too large' }, 413)
  const signature = request.headers.get('x-gateway-signature') ?? ''
  const validSignature = await verifySignature(rawBody, signature, secret).catch(() => false)
  if (!validSignature) return json({ error: 'Invalid webhook signature' }, 401)

  let payload: GatewayPayload
  try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawBody)) as GatewayPayload } catch { return json({ error: 'Invalid JSON payload' }, 400) }
  const event = String(payload.event ?? request.headers.get('x-gateway-event') ?? '').toUpperCase()
  const orderId = String(payload.orderId ?? payload.order_id ?? '').trim()
  if (!orderId || orderId.length > 80) return json({ error: 'Missing or invalid order ID' }, 400)

  const statusMap: Record<string, string> = {
    SUCCESS: 'succeeded', FAILED: 'failed', SUSPICIOUS: 'suspicious', EXPIRED: 'expired', CANCELLED: 'cancelled',
  }
  const nextStatus = statusMap[event]
  if (!nextStatus) return json({ received: true, ignored: true })

  const currency = String(payload.currency ?? 'INR').toUpperCase()
  const amountPaise = parseAmountPaise(payload)
  if (currency !== 'INR' || amountPaise === null || amountPaise < 100 || amountPaise > 10000000) {
    return json({ error: 'Invalid amount or currency' }, 400)
  }

  const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: row, error: lookupError } = await db.from('donation_intents')
    .select('id,order_id,amount_paise,currency,status,gateway_payment_id,utr')
    .eq('order_id', orderId).maybeSingle()
  if (lookupError) {
    console.error('Donation lookup failed:', lookupError.message)
    return json({ error: 'Could not look up donation reference' }, 500)
  }
  if (!row) return json({ error: 'Donation reference not found' }, 404)
  if (Number(row.amount_paise) !== amountPaise || row.currency !== currency) {
    console.error('Donation webhook amount mismatch for order:', orderId)
    return json({ error: 'Donation amount does not match the recorded intent' }, 409)
  }

  if (row.status === 'succeeded') {
    // Gateway retries are idempotent. A different payment ID for an already-paid order needs manual review.
    const incomingPaymentId = String(payload.paymentId ?? '')
    if (!incomingPaymentId || incomingPaymentId === row.gateway_payment_id) return json({ received: true, alreadyProcessed: true })
    return json({ error: 'Reference already has a different successful payment' }, 409)
  }

  const update: Record<string, unknown> = { status: nextStatus, updated_at: new Date().toISOString() }
  if (nextStatus === 'succeeded') {
    const paymentId = String(payload.paymentId ?? '').trim()
    const utr = String(payload.utr ?? '').trim()
    if (!paymentId) return json({ error: 'Successful payment is missing payment ID' }, 400)
    update.gateway_payment_id = paymentId.slice(0, 200)
    update.utr = utr ? utr.slice(0, 100) : null
    const completedAt = payload.completedAt ? new Date(payload.completedAt) : new Date()
    update.verified_at = Number.isNaN(completedAt.getTime()) ? new Date().toISOString() : completedAt.toISOString()
  }

  const { data: changed, error: updateError } = await db.from('donation_intents')
    .update(update).eq('id', row.id).eq('status', 'pending').select('id,status').maybeSingle()
  if (updateError) {
    console.error('Donation webhook update failed:', updateError.message)
    return json({ error: 'Could not record gateway event' }, 409)
  }
  if (!changed) {
    const { data: latest } = await db.from('donation_intents').select('status').eq('id', row.id).maybeSingle()
    if (latest?.status === nextStatus || (nextStatus === 'succeeded' && latest?.status === 'succeeded')) {
      return json({ received: true, alreadyProcessed: true })
    }
    return json({ error: 'Donation reference was already processed with another status' }, 409)
  }
  return json({ received: true, status: changed.status })
})
