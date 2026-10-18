import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  ArrowRight, BadgeCheck, CircleAlert, CircleCheck, Heart, HandHeart,
  LoaderCircle, LockKeyhole, ShieldCheck, Sparkles, Wallet,
} from 'lucide-react'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import './DonationPage.css'

type CheckoutResult = {
  status?: string
  order_id?: string
  amount_received?: number | string
  utr?: string
  paymentId?: string
  reason?: string
  error?: string
}
type CheckoutOptions = {
  key: string
  order_id: string
  amount: number
  currency: 'INR'
  name: string
  description: string
  customer?: { name?: string; email?: string }
  metadata: Record<string, string | number | boolean>
  portalUrl: string
  apiUrl: string
  theme: { color: string }
  successUrl?: string
  handler: (result: CheckoutResult) => void
  onSuccess?: (result: CheckoutResult) => void
  onFailed?: (result: CheckoutResult) => void
  onSuspicious?: (result: CheckoutResult) => void
  onExpired?: (result: CheckoutResult) => void
  onCancelled?: (result: CheckoutResult) => void
  onClose?: () => void
}
declare global {
  interface Window {
    Youpi?: { pay: (options: CheckoutOptions) => Promise<unknown> }
  }
}

type Props = { userId?: string | null; userName?: string }
type GatewayState = 'not-configured' | 'loading' | 'ready' | 'error'
const PRESETS = [51, 101, 251, 501, 1001, 2100]
const MIN_DONATION_PAISE = 100
const MAX_DONATION_PAISE = 10_000_000 // ₹1,00,000

const gatewayPortalUrl = (import.meta.env.VITE_DONATION_GATEWAY_PORTAL_URL as string | undefined)?.trim().replace(/\/+$/, '') ?? ''
const gatewayApiUrl = ((import.meta.env.VITE_DONATION_GATEWAY_API_URL as string | undefined)?.trim().replace(/\/+$/, '') || gatewayPortalUrl)
const merchantKey = (import.meta.env.VITE_DONATION_MERCHANT_KEY as string | undefined)?.trim() ?? ''
const gatewayConfigured = Boolean(gatewayPortalUrl && gatewayApiUrl && merchantKey)

function makeOrderId(): string {
  const random = typeof window !== 'undefined' && window.crypto?.randomUUID
    ? window.crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()
    : Math.random().toString(36).slice(2, 14).toUpperCase()
  return `LPDON-${Date.now().toString(36).toUpperCase()}-${random}`
}
function money(paise: number): string {
  return (paise / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 })
}

export default function DonationPage({ userId = null, userName = '' }: Props) {
  const [amountText, setAmountText] = useState('251')
  const [selectedPreset, setSelectedPreset] = useState<number | null>(251)
  const [donorName, setDonorName] = useState(userName)
  const [donorEmail, setDonorEmail] = useState('')
  const [anonymous, setAnonymous] = useState(false)
  const [message, setMessage] = useState('')
  const [gatewayState, setGatewayState] = useState<GatewayState>(gatewayConfigured ? 'loading' : 'not-configured')
  const [launching, setLaunching] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'info' | 'success' | 'warning' | 'error'; title: string; body: string } | null>(null)
  const [lastOrderId, setLastOrderId] = useState('')

  const parsedAmount = useMemo(() => {
    if (!amountText.trim() || !/^\d+(?:\.\d{0,2})?$/.test(amountText.trim())) return null
    const value = Number(amountText)
    if (!Number.isFinite(value)) return null
    return Math.round(value * 100)
  }, [amountText])
  const amountValid = parsedAmount !== null && parsedAmount >= MIN_DONATION_PAISE && parsedAmount <= MAX_DONATION_PAISE
  const paymentReady = gatewayState === 'ready' && isSupabaseConfigured && Boolean(supabase)

  useEffect(() => {
    if (userName && !donorName) setDonorName(userName)
  }, [userName, donorName])

  useEffect(() => {
    if (!gatewayConfigured) {
      setGatewayState('not-configured')
      return
    }
    if (!/^https?:\/\//i.test(gatewayPortalUrl) || !/^https?:\/\//i.test(gatewayApiUrl)) {
      setGatewayState('error')
      return
    }
    if (window.Youpi?.pay) {
      setGatewayState('ready')
      return
    }

    let disposed = false
    const selector = 'script[data-lokpravaah-donation-sdk="true"]'
    let script = document.querySelector<HTMLScriptElement>(selector)
    const onLoad = () => { if (!disposed) setGatewayState(window.Youpi?.pay ? 'ready' : 'error') }
    const onError = () => { if (!disposed) setGatewayState('error') }
    if (script) {
      script.addEventListener('load', onLoad)
      script.addEventListener('error', onError)
      if (window.Youpi?.pay) setGatewayState('ready')
    } else {
      script = document.createElement('script')
      script.src = `${gatewayPortalUrl}/youpi.js`
      script.async = true
      script.dataset.lokpravaahDonationSdk = 'true'
      script.dataset.youpiKey = merchantKey
      script.dataset.apiUrl = gatewayApiUrl
      script.dataset.portalUrl = gatewayPortalUrl
      script.dataset.currency = 'INR'
      script.dataset.name = 'LokPravaah'
      script.dataset.themeColor = '#55d8a1'
      script.addEventListener('load', onLoad)
      script.addEventListener('error', onError)
      document.head.appendChild(script)
    }
    return () => {
      disposed = true
      script?.removeEventListener('load', onLoad)
      script?.removeEventListener('error', onError)
    }
  }, [])

  function selectPreset(value: number) {
    setSelectedPreset(value)
    setAmountText(String(value))
    setNotice(null)
  }

  async function startDonation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setNotice(null)
    if (!amountValid || parsedAmount === null) {
      setNotice({ tone: 'error', title: 'Check the amount', body: 'Enter an amount from ₹1 to ₹1,00,000, with up to two decimal places.' })
      return
    }
    if (!gatewayConfigured || gatewayState !== 'ready' || !window.Youpi?.pay) {
      setNotice({ tone: 'warning', title: 'Donation checkout is not configured', body: 'Payments are not enabled yet. The site administrator must configure the gateway URL and merchant key before anyone can donate.' })
      return
    }
    if (!supabase || !isSupabaseConfigured) {
      setNotice({ tone: 'error', title: 'Donation records are unavailable', body: 'The platform database is not configured, so checkout has been stopped before any payment session was created.' })
      return
    }
    if (donorEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(donorEmail.trim())) {
      setNotice({ tone: 'error', title: 'Check the email address', body: 'Enter a valid email address or leave the field blank.' })
      return
    }

    setLaunching(true)
    const orderId = makeOrderId()
    setLastOrderId(orderId)
    try {
      const { error } = await supabase.from('donation_intents').insert({
        order_id: orderId,
        donor_user_id: anonymous ? null : userId,
        amount_paise: parsedAmount,
        currency: 'INR',
        donor_name: anonymous ? null : (donorName.trim().slice(0, 80) || null),
        donor_email: anonymous ? null : (donorEmail.trim().slice(0, 254) || null),
        is_anonymous: anonymous,
        message: message.trim().slice(0, 300) || null,
        status: 'pending',
      })
      if (error) throw new Error(`Could not create a donation record: ${error.message}`)

      setNotice({ tone: 'info', title: 'Opening payment checkout…', body: `Reference: ${orderId}. Your contribution will remain pending until the signed gateway webhook verifies the payment.` })
      await window.Youpi.pay({
        key: merchantKey,
        order_id: orderId,
        amount: Number((parsedAmount / 100).toFixed(2)),
        currency: 'INR',
        name: 'LokPravaah',
        description: 'Voluntary contribution to support LokPravaah development and operating costs',
        customer: anonymous ? undefined : { name: donorName.trim().slice(0, 80), email: donorEmail.trim().slice(0, 254) },
        metadata: { purpose: 'lokpravaah_donation', order_id: orderId, amount_paise: parsedAmount },
        portalUrl: gatewayPortalUrl,
        apiUrl: gatewayApiUrl,
        theme: { color: '#55d8a1' },
        handler: () => {
          setNotice({ tone: 'success', title: 'Checkout response received', body: `Thank you for supporting LokPravaah. Reference ${orderId} is awaiting server-side verification; this browser response is not a final receipt.` })
          setLaunching(false)
        },
        onSuccess: () => {
          setNotice({ tone: 'success', title: 'Payment is being verified', body: `Thank you for supporting LokPravaah. Reference ${orderId} will only be marked paid after the signed server webhook confirms it.` })
          setLaunching(false)
        },
        onFailed: result => {
          setNotice({ tone: 'error', title: 'Payment was not confirmed', body: `${result.reason || result.error || 'The checkout could not confirm this payment.'} If money was debited, check your bank statement and contact support with reference ${orderId} before trying again.` })
          setLaunching(false)
        },
        onSuspicious: () => {
          setNotice({ tone: 'warning', title: 'Payment needs review', body: `Reference ${orderId} has been flagged for review. Please do not repeat the payment while its status is being checked.` })
          setLaunching(false)
        },
        onExpired: () => {
          setNotice({ tone: 'warning', title: 'Checkout session expired', body: `Reference ${orderId} expired before the gateway confirmed payment. Check your bank account before starting another attempt.` })
          setLaunching(false)
        },
        onCancelled: () => {
          setNotice({ tone: 'info', title: 'Checkout cancelled', body: `Reference ${orderId} was cancelled in checkout. If you approved a transfer in your UPI app, verify your bank statement before retrying.` })
          setLaunching(false)
        },
        onClose: () => setLaunching(false),
      })
    } catch (error) {
      setNotice({ tone: 'error', title: 'Could not start donation checkout', body: error instanceof Error ? error.message : 'Please check the gateway setup and try again.' })
      setLaunching(false)
    }
  }

  return <div className="donation-page">
    <section className="donation-hero">
      <div className="donation-orb donation-orb-one" aria-hidden="true" />
      <div className="donation-orb donation-orb-two" aria-hidden="true" />
      <div className="donation-hero-copy">
        <div className="donation-eyebrow"><span className="donation-eyebrow-dot" /> COMMUNITY-SUPPORTED DEVELOPMENT</div>
        <h1>Help keep civic action <em>within reach.</em></h1>
        <p>Contribute any amount to help support LokPravaah’s hosting, accessibility, moderation and continued development. Every contribution is voluntary.</p>
        <div className="donation-hero-points"><span><ShieldCheck size={15} /> Independent civic-tech project</span><span><Heart size={15} /> Any contribution is appreciated</span></div>
      </div>
      <div className="donation-hero-art" aria-hidden="true"><div className="donation-art-ring ring-a"/><div className="donation-art-ring ring-b"/><div className="donation-art-center"><HandHeart size={45}/></div><span className="donation-art-spark spark-a">✦</span><span className="donation-art-spark spark-b">✳</span><div className="donation-art-tag tag-a"><Heart size={14}/> Your support matters</div><div className="donation-art-tag tag-b"><Sparkles size={14}/> Built for the community</div></div>
    </section>

    <div className="donation-layout">
      <section className="donation-form-card">
        <div className="donation-card-header"><div className="donation-icon"><Wallet size={20}/></div><div><span className="donation-section-kicker">MAKE A CONTRIBUTION</span><h2>Choose your amount</h2><p>One-time contribution · INR</p></div></div>
        <form onSubmit={startDonation}>
          <div className="donation-presets" aria-label="Suggested amounts">{PRESETS.map(value => <button type="button" key={value} className={`donation-preset ${selectedPreset === value ? 'selected' : ''}`} onClick={() => selectPreset(value)}>{money(value * 100)}{value === 251 && <small>Popular</small>}</button>)}</div>
          <label className="donation-field"><span>Custom amount (₹)</span><div className="donation-amount-input"><span>₹</span><input type="number" inputMode="decimal" min="1" max="100000" step="0.01" value={amountText} onChange={e => { setAmountText(e.target.value); setSelectedPreset(PRESETS.find(v => String(v) === e.target.value) ?? null); setNotice(null) }} aria-describedby="donation-amount-help" required/><span className="donation-inr-pill">INR</span></div><small id="donation-amount-help">₹1 minimum · ₹1,00,000 maximum · up to 2 decimals</small></label>
          <div className="donation-field-grid"><label className="donation-field"><span>Name <small>(optional)</small></span><input type="text" maxLength={80} value={donorName} onChange={e => setDonorName(e.target.value)} disabled={anonymous} placeholder="Your name" autoComplete="name"/></label><label className="donation-field"><span>Email <small>(optional)</small></span><input type="email" maxLength={254} value={donorEmail} onChange={e => setDonorEmail(e.target.value)} disabled={anonymous} placeholder="you@example.com" autoComplete="email"/></label></div>
          <label className="donation-anonymous"><input type="checkbox" checked={anonymous} onChange={e => setAnonymous(e.target.checked)}/><span><b>Keep my contribution anonymous</b><small>Your name and email will not be attached to this donation record.</small></span></label>
          <label className="donation-field"><span>Message <small>(optional)</small></span><textarea rows={2} maxLength={300} value={message} onChange={e => setMessage(e.target.value)} placeholder="Leave a note of support (max 300 characters)"/></label>
          <div className="donation-summary"><span>Your one-time contribution</span><strong>{amountValid && parsedAmount !== null ? money(parsedAmount) : '—'}</strong></div>
          <button className="donation-submit" type="submit" disabled={!paymentReady || !amountValid || launching}>{launching ? <><LoaderCircle size={17} className="donation-spin"/> Preparing checkout…</> : <><Heart size={17}/> Donate {amountValid && parsedAmount !== null ? money(parsedAmount) : 'now'} <ArrowRight size={16}/></>}</button>
          {!isSupabaseConfigured && <div className="donation-inline-warning"><CircleAlert size={16}/><span>Supabase is not configured. No payment session will be started until donation records are enabled.</span></div>}
          {gatewayState === 'not-configured' && <div className="donation-inline-warning"><CircleAlert size={16}/><span>Checkout is not configured yet. Add the donation gateway URL and public merchant key to the site environment, then redeploy.</span></div>}
          {gatewayState === 'loading' && <div className="donation-gateway-state"><LoaderCircle size={15} className="donation-spin"/> Connecting to payment checkout…</div>}
          {gatewayState === 'error' && <div className="donation-inline-warning"><CircleAlert size={16}/><span>The payment checkout could not be loaded. Check the gateway URLs, gateway availability and browser console.</span></div>}
          {notice && <div className={`donation-notice notice-${notice.tone}`} role="status"><div className="donation-notice-icon">{notice.tone === 'success' ? <CircleCheck size={19}/> : notice.tone === 'error' || notice.tone === 'warning' ? <CircleAlert size={19}/> : <BadgeCheck size={19}/>}</div><div><b>{notice.title}</b><p>{notice.body}</p>{lastOrderId && <code>Reference: {lastOrderId}</code>}</div></div>}
        </form>
        <div className="donation-security-note"><LockKeyhole size={15}/><span>Payment status is confirmed on the server using a signed gateway webhook, not just a browser message.</span></div>
      </section>

      <aside className="donation-info-column">
        <section className="donation-info-card"><div className="donation-info-icon"><Sparkles size={19}/></div><h3>What your support helps with</h3><div className="donation-use-row"><span>01</span><div><b>Keep the service available</b><p>Hosting, infrastructure and routine maintenance.</p></div></div><div className="donation-use-row"><span>02</span><div><b>Make the platform easier to use</b><p>Accessibility, usability improvements and language support.</p></div></div><div className="donation-use-row"><span>03</span><div><b>Keep improving civic tools</b><p>Responsible development, moderation and platform reliability.</p></div></div></section>
        <section className="donation-info-card donation-transparency"><div className="donation-info-icon"><ShieldCheck size={19}/></div><h3>Transparent by design</h3><p>Contributions are voluntary and do not guarantee a particular report outcome or government response. LokPravaah is an independent civic-tech project, not a government portal.</p><div className="donation-transparency-foot"><BadgeCheck size={15}/><span>No tax-deduction promise is made. Keep your own bank/payment record.</span></div></section>
        <section className="donation-help-card"><Heart size={19}/><div><b>Not ready to donate?</b><p>You can still help by reporting a local issue, improving a report with useful details, or sharing LokPravaah with your community.</p></div></section>
      </aside>
    </div>
    <p className="donation-footer-note">Please donate only through the checkout that opens from this page. Never share a UPI PIN, password or OTP with anyone claiming to represent LokPravaah.</p>
  </div>
}
