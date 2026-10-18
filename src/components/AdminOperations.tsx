import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { AlertCircle, BellRing, Check, CirclePower, Clock3, Eye, EyeOff, Flag, LoaderCircle, MessageCircle, Plus, RefreshCw, Save, ShieldCheck, Trash2, Users, Wallet, X, FileText, ExternalLink, Sparkles } from 'lucide-react'
import { supabase } from '../lib/supabase'

type FeatureRow = { flag_key: string; enabled: boolean; label: string; description: string; updated_at: string }
type Announcement = { id: string; title: string; body: string; severity: 'info' | 'warning' | 'critical'; is_active: boolean; created_at: string; expires_at: string | null }
type MessageRow = { id: string; user_id: string; author_name: string; body: string; is_hidden: boolean; created_at: string }
type MessageFlag = { id: string; message_id: string; reporter_id: string; reason: string; status: string; created_at: string }
type Withdrawal = { id: string; user_id: string; points_requested: number; amount_inr: number; payout_method: string; payout_destination: string; gift_card_brand?: string | null; gift_card_code?: string | null; status: string; admin_note: string | null; payout_reference: string | null; created_at: string }
type GiftCardOption = { id: string; brand: string; min_amount_inr: number; max_amount_inr: number; active: boolean }
type ProfileRow = { id: string; display_name: string | null; city?: string | null; ward?: string | null }
type RoleRow = { user_id: string; role: string }
type AuditRow = { id: string; actor_id: string | null; action: string; target_type: string | null; target_id: string | null; metadata: Record<string, unknown>; created_at: string }
type RewardSettings = { enabled: boolean; cash_redemption_enabled: boolean; points_per_rupee: number; min_withdrawal_points: number; max_withdrawal_points: number; enabled_payout_methods: string[]; auto_reward_on_verified: boolean; points_for_verified_report: number; auto_reward_on_resolved: boolean; points_for_resolved_report: number }
type SitePost = { id: string; slug: string; title: string; excerpt: string; body: string; post_type: 'blog' | 'app_update' | 'feature_update'; link_url: string | null; is_published: boolean; published_at: string | null; created_at: string }

const DEFAULT_REWARD_SETTINGS: RewardSettings = { enabled: true, cash_redemption_enabled: false, points_per_rupee: 100, min_withdrawal_points: 10000, max_withdrawal_points: 1000000, enabled_payout_methods: ['UPI'], auto_reward_on_verified: true, points_for_verified_report: 25, auto_reward_on_resolved: true, points_for_resolved_report: 75 }

const DEFAULT_FEATURES: FeatureRow[] = [
  { flag_key: 'reporting', enabled: true, label: 'Civic reports', description: 'Allow citizens to submit new civic reports.', updated_at: '' },
  { flag_key: 'public_chat', enabled: true, label: 'Public community chat', description: 'Enable the live community conversation and message moderation.', updated_at: '' },
  { flag_key: 'rewards', enabled: true, label: 'Rewards & withdrawal requests', description: 'Enable the ledger and manual payout request workflow.', updated_at: '' },
  { flag_key: 'civic_toolkit', enabled: true, label: 'Civic toolkit', description: 'Show complaint/RTI draft tools and official resource links.', updated_at: '' },
  { flag_key: 'evidence_upload', enabled: true, label: 'Evidence uploads', description: 'Allow optional private evidence file uploads.', updated_at: '' },
  { flag_key: 'community_support', enabled: true, label: 'Community support votes', description: 'Allow one support vote per account for public reports.', updated_at: '' },
  { flag_key: 'janwatch_ai', enabled: true, label: 'LokPravaah AI assistant', description: 'Allow signed-in citizens to use LokPravaah AI.', updated_at: '' },
]
const dateLabel = (value: string) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString() }
const readable = (error: unknown) => error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String((error as {message: unknown}).message) : String(error)

export default function AdminOperations({ userId, role, onChanged, notify }: { userId: string; role: string; onChanged: () => void; notify: (message: string) => void }) {
  const [tab, setTab] = useState<'features' | 'alerts' | 'moderation' | 'rewards' | 'roles' | 'audit' | 'content'>(role === 'moderator' ? 'moderation' : 'features')
  const [features, setFeatures] = useState<FeatureRow[]>(DEFAULT_FEATURES)
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [messages, setMessages] = useState<MessageRow[]>([])
  const [flags, setFlags] = useState<MessageFlag[]>([])
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([])
  const [profiles, setProfiles] = useState<ProfileRow[]>([])
  const [roles, setRoles] = useState<RoleRow[]>([])
  const [auditRows, setAuditRows] = useState<AuditRow[]>([])
  const [rewardSettings, setRewardSettings] = useState<RewardSettings>(DEFAULT_REWARD_SETTINGS)
  const [giftCardOptions, setGiftCardOptions] = useState<GiftCardOption[]>([])
  const [giftCardOptionsError, setGiftCardOptionsError] = useState('')
  const [newGiftCardBrand, setNewGiftCardBrand] = useState('')
  const [newGiftCardMin, setNewGiftCardMin] = useState('100')
  const [newGiftCardMax, setNewGiftCardMax] = useState('1000')
  const [giftCardCodes, setGiftCardCodes] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const [alertTitle, setAlertTitle] = useState('')
  const [alertBody, setAlertBody] = useState('')
  const [alertSeverity, setAlertSeverity] = useState<'info' | 'warning' | 'critical'>('info')
  const [alertExpiry, setAlertExpiry] = useState('')
  const [selectedUser, setSelectedUser] = useState('')
  const [grantPoints, setGrantPoints] = useState('100')
  const [rewardAdjustment, setRewardAdjustment] = useState<'grant' | 'deduct'>('grant')
  const [grantReason, setGrantReason] = useState('Approved helpful evidence contribution')
  const [payoutRefs, setPayoutRefs] = useState<Record<string, string>>({})
  const [payoutNotes, setPayoutNotes] = useState<Record<string, string>>({})
  const [userSearch, setUserSearch] = useState('')
  const [posts, setPosts] = useState<SitePost[]>([])
  const [postTitle, setPostTitle] = useState('')
  const [postExcerpt, setPostExcerpt] = useState('')
  const [postBody, setPostBody] = useState('')
  const [postType, setPostType] = useState<SitePost['post_type']>('app_update')
  const [postLink, setPostLink] = useState('')
  const [publishNow, setPublishNow] = useState(true)
  const [editingPostId, setEditingPostId] = useState('')

  const load = useCallback(async () => {
    if (!supabase) { setError('Platform settings are temporarily unavailable. Please try again later.'); setLoading(false); return }
    setLoading(true); setError('')
    // Moderators only need community moderation data. Avoid probing administrator-only tables,
    // which would otherwise produce misleading permission errors in their console.
    if (role === 'moderator') {
      const [messageResult, flagResult] = await Promise.all([
        supabase.from('community_messages').select('id,user_id,author_name,body,is_hidden,created_at').order('created_at', { ascending: false }).limit(150),
        supabase.from('community_message_flags').select('id,message_id,reporter_id,reason,status,created_at').order('created_at', { ascending: false }).limit(150),
      ])
      if (messageResult.error || flagResult.error) setError('Moderation data could not be loaded. Please refresh and try again.')
      if (!messageResult.error) setMessages((messageResult.data ?? []) as MessageRow[])
      if (!flagResult.error) setFlags((flagResult.data ?? []) as MessageFlag[])
      setLoading(false)
      return
    }
    const [featureResult, alertResult, messageResult, flagResult, withdrawalResult, profileResult, roleResult, auditResult, rewardSettingsResult, postsResult, giftCardOptionsResult] = await Promise.all([
      supabase.from('app_feature_flags').select('flag_key,enabled,label,description,updated_at').order('flag_key'),
      supabase.from('site_announcements').select('id,title,body,severity,is_active,created_at,expires_at').order('created_at', { ascending: false }).limit(100),
      supabase.from('community_messages').select('id,user_id,author_name,body,is_hidden,created_at').order('created_at', { ascending: false }).limit(150),
      supabase.from('community_message_flags').select('id,message_id,reporter_id,reason,status,created_at').order('created_at', { ascending: false }).limit(150),
      supabase.from('reward_withdrawals').select('id,user_id,points_requested,amount_inr,payout_method,payout_destination,gift_card_brand,gift_card_code,status,admin_note,payout_reference,created_at').order('created_at', { ascending: false }).limit(150),
      supabase.from('profiles').select('id,display_name,city,ward').order('display_name').limit(500),
      supabase.from('user_roles').select('user_id,role'),
      supabase.from('audit_logs').select('id,actor_id,action,target_type,target_id,metadata,created_at').order('created_at', { ascending: false }).limit(150),
      supabase.from('reward_settings').select('enabled,cash_redemption_enabled,points_per_rupee,min_withdrawal_points,max_withdrawal_points,enabled_payout_methods,auto_reward_on_verified,points_for_verified_report,auto_reward_on_resolved,points_for_resolved_report').eq('id', true).maybeSingle(),
      supabase.from('site_posts').select('id,slug,title,excerpt,body,post_type,link_url,is_published,published_at,created_at').order('created_at', { ascending: false }).limit(100),
      supabase.from('reward_gift_card_options').select('id,brand,min_amount_inr,max_amount_inr,active').order('brand'),
    ])
    if (featureResult.error) setError('Platform settings could not be loaded. Please refresh and try again.')
    else setFeatures(prev => {
      const byKey = new Map<string, FeatureRow>((featureResult.data ?? []).map((row: any) => [String(row.flag_key), row as FeatureRow]))
      return DEFAULT_FEATURES.map(f => ({ ...f, ...(byKey.get(f.flag_key) ?? {}) }))
    })
    if (!alertResult.error) setAnnouncements((alertResult.data ?? []) as Announcement[])
    else setError(current => current || `Announcements could not be loaded${alertResult.error.code ? ` (${alertResult.error.code})` : ''}: ${alertResult.error.message}`)
    if (!messageResult.error) setMessages((messageResult.data ?? []) as MessageRow[])
    if (!flagResult.error) setFlags((flagResult.data ?? []) as MessageFlag[])
    if (!withdrawalResult.error) setWithdrawals((withdrawalResult.data ?? []) as Withdrawal[])
    if (!profileResult.error) setProfiles((profileResult.data ?? []) as ProfileRow[])
    if (!roleResult.error) setRoles((roleResult.data ?? []) as RoleRow[])
    if (!auditResult.error) setAuditRows((auditResult.data ?? []) as AuditRow[])
    if (!giftCardOptionsResult.error) { setGiftCardOptions((giftCardOptionsResult.data ?? []).map((item: any) => ({ ...item, min_amount_inr: Number(item.min_amount_inr), max_amount_inr: Number(item.max_amount_inr) })) as GiftCardOption[]); setGiftCardOptionsError('') }
    else { setGiftCardOptions([]); setGiftCardOptionsError(['42P01', 'PGRST205'].includes(giftCardOptionsResult.error.code ?? '') ? 'Gift-card database table is missing. Apply supabase/lokpravaah_ai_giftcard_repair.sql in Supabase SQL Editor, then refresh this page. Until the migration succeeds, brands cannot be saved or shown to users.' : `Gift-card catalogue could not load (${giftCardOptionsResult.error.code || 'database error'}). Check table permissions and the Supabase logs.`) }
    if (!rewardSettingsResult.error && rewardSettingsResult.data) setRewardSettings({ ...DEFAULT_REWARD_SETTINGS, ...(rewardSettingsResult.data as RewardSettings), max_withdrawal_points: Number(rewardSettingsResult.data.max_withdrawal_points ?? 1000000), enabled_payout_methods: Array.isArray(rewardSettingsResult.data.enabled_payout_methods) && rewardSettingsResult.data.enabled_payout_methods.length ? rewardSettingsResult.data.enabled_payout_methods : ['UPI'], points_per_rupee: Number(rewardSettingsResult.data.points_per_rupee) })
    else if (rewardSettingsResult.error) setError(current => current || 'Reward settings could not be loaded. Please refresh and try again.')
    if (!postsResult.error) setPosts((postsResult.data ?? []) as SitePost[])
    else if (role === 'super_admin') setError(current => current || `Blog & Updates could not be loaded${postsResult.error.code ? ` (${postsResult.error.code})` : ''}: ${postsResult.error.message}`)
    setLoading(false)
  }, [role])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!supabase) return
    const channel = supabase.channel(`janwatch-admin-live-${role}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'community_message_flags' }, () => { void load() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reward_withdrawals' }, () => { void load() })
      .subscribe()
    return () => { void supabase?.removeChannel(channel) }
  }, [load, role])

  async function testAIConnection() {
    if (!supabase) return
    setBusyId('test-ai'); setError('')
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('janwatch-ai', { body: { prompt: 'Reply with exactly: LokPravaah AI connection test successful.', task: 'admin_connection_test' } })
      if (invokeError) {
        setError('AI connection test failed. Deploy the AI function and review its recent logs in Supabase Edge Functions.')
        return
      }
      if (data?.ai_available === false || !String(data?.answer ?? '').trim()) {
        if (data?.code === 'ai_not_configured') setError('AI is not configured on the server yet. Add your AI provider key in Supabase → Edge Functions → Secrets, then deploy janwatch-ai and test again.')
        else if (data?.code === 'ai_paused') setError('LokPravaah AI is switched off. Enable it under Feature switches and test again.')
        else setError('The AI service was reached, but it could not generate a response. Check the latest function log and verify the provider key, model and account limits.')
        return
      }
      notify('AI connection test succeeded.')
    } catch {
      setError('AI connection test failed. Check the Edge Function deployment and recent logs in Supabase.')
    } finally { setBusyId('') }
  }

  async function toggleFeature(feature: FeatureRow) {
    if (!supabase) return
    setBusyId(feature.flag_key); setError('')
    const { error: updateError } = await supabase.from('app_feature_flags').upsert({ flag_key: feature.flag_key, enabled: !feature.enabled, label: feature.label, description: feature.description, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: 'flag_key' })
    setBusyId('')
    if (updateError) { setError('This change could not be saved. Please try again.'); return }
    setFeatures(current => current.map(f => f.flag_key === feature.flag_key ? { ...f, enabled: !feature.enabled, updated_at: new Date().toISOString() } : f))
    notify(`${feature.label} ${feature.enabled ? 'disabled' : 'enabled'}.`)
    onChanged()
  }

  async function createAnnouncement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !alertTitle.trim() || !alertBody.trim()) return
    setBusyId('create-alert'); setError('')
    const { error: insertError } = await supabase.from('site_announcements').insert({ title: alertTitle.trim(), body: alertBody.trim(), severity: alertSeverity, is_active: true, created_by: userId, expires_at: alertExpiry ? new Date(alertExpiry).toISOString() : null })
    setBusyId('')
    if (insertError) { setError(`Announcement save failed${insertError.code ? ` (${insertError.code})` : ''}: ${insertError.message}`); return }
    setAlertTitle(''); setAlertBody(''); setAlertExpiry(''); setAlertSeverity('info')
    notify('Site announcement published.'); await load(); onChanged()
  }

  async function toggleAnnouncement(alert: Announcement) {
    if (!supabase) return
    setBusyId(alert.id); setError('')
    const { error: updateError } = await supabase.from('site_announcements').update({ is_active: !alert.is_active }).eq('id', alert.id)
    setBusyId('')
    if (updateError) { setError(`Announcement update failed${updateError.code ? ` (${updateError.code})` : ''}: ${updateError.message}`); return }
    notify(alert.is_active ? 'Announcement hidden.' : 'Announcement published.')
    await load(); onChanged()
  }

  async function deleteAnnouncement(alert: Announcement) {
    if (!supabase || !window.confirm(`Delete announcement “${alert.title}”?`)) return
    const { error: deleteError } = await supabase.from('site_announcements').delete().eq('id', alert.id)
    if (deleteError) setError('This item could not be deleted. Please try again.')
    else { notify('Announcement deleted.'); await load(); onChanged() }
  }

  async function moderateMessage(message: MessageRow, isHidden: boolean) {
    if (!supabase) return
    setBusyId(message.id)
    const { error: updateError } = await supabase.from('community_messages').update({ is_hidden: isHidden, updated_at: new Date().toISOString() }).eq('id', message.id)
    setBusyId('')
    if (updateError) { setError('This change could not be saved. Please try again.'); return }
    notify(isHidden ? 'Message hidden from public chat.' : 'Message restored to public chat.')
    await load()
  }

  async function resolveFlag(flag: MessageFlag) {
    if (!supabase) return
    const { error: updateError } = await supabase.from('community_message_flags').update({ status: 'reviewed', reviewed_by: userId, reviewed_at: new Date().toISOString() }).eq('id', flag.id)
    if (updateError) setError('This change could not be saved. Please try again.')
    else { notify('Flag marked as reviewed.'); await load() }
  }

  async function removeMessage(message: MessageRow) {
    if (!supabase || !window.confirm('Permanently delete this community message?')) return
    const { error: deleteError } = await supabase.from('community_messages').delete().eq('id', message.id)
    if (deleteError) setError('This item could not be deleted. Please try again.')
    else { notify('Message deleted.'); await load() }
  }

  async function grantReward(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !selectedUser || !Number.isInteger(Number(grantPoints)) || Number(grantPoints) < 1 || Number(grantPoints) > 1000000 || grantReason.trim().length < 3) return
    if (rewardAdjustment === 'grant' && !rewardSettings.enabled) { setError('Enable the reward programme before granting points.'); return }
    const delta = Number(grantPoints) * (rewardAdjustment === 'deduct' ? -1 : 1)
    const actionWord = rewardAdjustment === 'grant' ? 'Grant' : 'Deduct'
    if (!window.confirm(`${actionWord} ${Number(grantPoints).toLocaleString()} points ${rewardAdjustment === 'grant' ? 'to' : 'from'} the selected account? This will be recorded in the reward ledger.`)) return
    setBusyId('grant-reward'); setError('')
    const { error: rpcError } = await supabase.rpc('janwatch_admin_adjust_reward_points', { p_target_user_id: selectedUser, p_delta_points: delta, p_reason: grantReason.trim() })
    setBusyId('')
    if (rpcError) {
      const detail = [rpcError.message, rpcError.details, rpcError.hint].filter(Boolean).join(' — ')
      setError(`Points adjustment failed${rpcError.code ? ` (${rpcError.code})` : ''}: ${detail || 'Unknown database error. Check the Supabase reward-points migration and admin role.'}`)
      return
    }
    notify(`${actionWord}ed ${Number(grantPoints).toLocaleString()} points and recorded the adjustment.`); await load()
  }

  async function processWithdrawal(withdrawal: Withdrawal, action: 'approve' | 'reject' | 'paid') {
    if (!supabase) return
    const reference = payoutRefs[withdrawal.id]?.trim() ?? ''
    const giftCode = giftCardCodes[withdrawal.id]?.trim() ?? ''
    const note = payoutNotes[withdrawal.id]?.trim() ?? ''
    if (action === 'paid' && withdrawal.payout_method === 'Gift card') { setError('For gift cards, use the dedicated Deliver gift card code action.'); return }
    if (action === 'paid' && reference.length < 4) { setError('Enter the real external payment transaction reference before marking a withdrawal paid.'); return }
    if (!window.confirm(action === 'paid' ? 'Confirm that you already sent the money outside LokPravaah and verified the transaction reference?' : `${action === 'approve' ? 'Approve' : 'Reject'} this withdrawal request?`)) return
    setBusyId(withdrawal.id); setError('')
    const { error: rpcError } = await supabase.rpc('janwatch_admin_process_withdrawal', { p_withdrawal_id: withdrawal.id, p_action: action, p_note: note || null, p_reference: reference || null })
    setBusyId('')
    if (rpcError) { setError('This action could not be completed. Please try again.'); return }
    notify(action === 'paid' ? 'Withdrawal marked paid after the external transfer.' : action === 'approve' ? 'Withdrawal approved.' : 'Withdrawal rejected; reserved points will be released.')
    await load()
  }

  async function saveRewardSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || role === 'moderator') return
    const rate = Number(rewardSettings.points_per_rupee)
    const minimum = Number(rewardSettings.min_withdrawal_points)
    const verified = Number(rewardSettings.points_for_verified_report)
    const resolved = Number(rewardSettings.points_for_resolved_report)
    if (!Number.isFinite(rate) || rate <= 0 || rate > 100000000 || !Number.isInteger(minimum) || minimum < 1 || !Number.isInteger(verified) || verified < 0 || verified > 100000 || !Number.isInteger(resolved) || resolved < 0 || resolved > 100000) {
      setError('Check the reward conversion rate, minimum withdrawal, and milestone points.'); return
    }
    if (rewardSettings.cash_redemption_enabled && !rewardSettings.enabled_payout_methods.length) { setError('Enable at least one payout method before opening withdrawals.'); return }
    const maximum = Number(rewardSettings.max_withdrawal_points)
    if (!Number.isInteger(maximum) || maximum < minimum) { setError('Maximum withdrawal points must be an integer greater than or equal to the minimum.'); return }
    if (rewardSettings.cash_redemption_enabled && !window.confirm('Enable cash withdrawal requests? Confirm that your organisation has a funded rewards pool and a real, authorised manual payout process. This does not send money automatically.')) return
    setBusyId('reward-settings'); setError('')
    const payload = { ...rewardSettings, max_withdrawal_points: maximum, enabled_payout_methods: rewardSettings.enabled_payout_methods, points_per_rupee: rate, min_withdrawal_points: minimum, points_for_verified_report: verified, points_for_resolved_report: resolved, updated_by: userId, updated_at: new Date().toISOString() }
    const { error: updateError } = await supabase.from('reward_settings').update(payload).eq('id', true)
    setBusyId('')
    if (updateError) { setError('This change could not be saved. Please try again.'); return }
    notify('Reward programme rules saved.')
    await load()
  }

  async function addGiftCardOption(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || role === 'moderator') return
    const brand = newGiftCardBrand.trim()
    const min = Number(newGiftCardMin), max = Number(newGiftCardMax)
    if (brand.length < 2 || brand.length > 80 || !Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < min) { setError('Enter a gift card brand and valid minimum/maximum rupee values.'); return }
    setBusyId('add-gift-card'); setError('')
    const { error: insertError } = await supabase.from('reward_gift_card_options').insert({ brand, min_amount_inr: min, max_amount_inr: max, active: true, updated_by: userId })
    setBusyId('')
    if (insertError) { setError(insertError.code === '23505' ? 'That gift card brand already exists. Edit its existing limits instead.' : 'Gift card option could not be added. Apply the gift-card SQL migration and try again.'); return }
    setNewGiftCardBrand(''); notify(`${brand} gift card option added.`); await load()
  }

  async function saveGiftCardOption(option: GiftCardOption) {
    if (!supabase || role === 'moderator') return
    if (!option.brand.trim() || option.min_amount_inr <= 0 || option.max_amount_inr < option.min_amount_inr) { setError('Each gift card must have a positive minimum and a maximum at least as high as the minimum.'); return }
    setBusyId(`gift-card-${option.id}`); setError('')
    const { error: updateError } = await supabase.from('reward_gift_card_options').update({ brand: option.brand.trim(), min_amount_inr: option.min_amount_inr, max_amount_inr: option.max_amount_inr, active: option.active, updated_by: userId, updated_at: new Date().toISOString() }).eq('id', option.id)
    setBusyId('')
    if (updateError) { setError('Gift card settings could not be saved. Please try again.'); return }
    notify(`${option.brand} gift card settings saved.`); await load()
  }

  async function deliverGiftCard(withdrawal: Withdrawal) {
    if (!supabase || withdrawal.payout_method !== 'Gift card') return
    const code = giftCardCodes[withdrawal.id]?.trim() ?? ''
    if (code.length < 4 || code.length > 250) { setError('Enter the full gift card code (4–250 characters).'); return }
    if (!window.confirm(`Deliver the ${withdrawal.gift_card_brand || 'gift card'} code to this user's withdrawal history? The code will be visible in the signed-in user's LokPravaah withdrawal section; no email or SMS is sent.`)) return
    setBusyId(withdrawal.id); setError('')
    const { error: rpcError } = await supabase.rpc('janwatch_admin_deliver_gift_card', { p_withdrawal_id: withdrawal.id, p_code: code, p_note: payoutNotes[withdrawal.id]?.trim() || null })
    setBusyId('')
    if (rpcError) { setError('Gift card code could not be delivered. Confirm the request is approved and apply the latest SQL migration.'); return }
    setGiftCardCodes(current => ({ ...current, [withdrawal.id]: '' }))
    notify('Gift card code delivered in the user withdrawal section.'); await load()
  }

  function postSlug(value: string) {
    return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 150) || `post-${Date.now()}`
  }

  async function savePost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || role !== 'super_admin') return
    const title = postTitle.trim(), body = postBody.trim()
    if (title.length < 3 || body.length < 10) { setError('Use a title of at least 3 characters and article content of at least 10 characters.'); return }
    const link = postLink.trim()
    if (link && !/^https:\/\//i.test(link)) { setError('Related links must use HTTPS.'); return }
    setBusyId('save-post'); setError('')
    const existingSlug = editingPostId ? posts.find(item => item.id === editingPostId)?.slug : null
    const baseSlug = postSlug(title)
    const uniqueSlug = existingSlug || `${baseSlug}-${Date.now().toString(36)}`.slice(0, 160)
    const payload = { slug: uniqueSlug, title, excerpt: postExcerpt.trim(), body, post_type: postType, link_url: link || null, is_published: publishNow, ...(editingPostId ? {} : { author_id: userId }), published_at: publishNow ? (posts.find(item => item.id === editingPostId)?.published_at || new Date().toISOString()) : null, updated_at: new Date().toISOString() }
    const result = editingPostId
      ? await supabase.from('site_posts').update(payload).eq('id', editingPostId)
      : await supabase.from('site_posts').insert(payload)
    setBusyId('')
    if (result.error) { setError(`Post save failed${result.error.code ? ` (${result.error.code})` : ''}: ${result.error.message}`); return }
    setPostTitle(''); setPostExcerpt(''); setPostBody(''); setPostLink(''); setPostType('app_update'); setPublishNow(true); setEditingPostId('')
    notify(editingPostId ? 'Post updated.' : publishNow ? 'Blog/update published on the public page.' : 'Draft saved privately.'); await load()
  }

  function editPost(post: SitePost) {
    if (role !== 'super_admin') return
    setEditingPostId(post.id); setPostTitle(post.title); setPostExcerpt(post.excerpt); setPostBody(post.body); setPostType(post.post_type); setPostLink(post.link_url || ''); setPublishNow(post.is_published); setError('')
    document.querySelector('.ops-content-layout')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function cancelEditPost() {
    setEditingPostId(''); setPostTitle(''); setPostExcerpt(''); setPostBody(''); setPostLink(''); setPostType('app_update'); setPublishNow(true); setError('')
  }

  async function togglePost(post: SitePost) {
    if (!supabase || role !== 'super_admin') return
    const next = !post.is_published
    setBusyId(post.id); setError('')
    const { error: updateError } = await supabase.from('site_posts').update({ is_published: next, published_at: next ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq('id', post.id)
    setBusyId('')
    if (updateError) { setError('This change could not be saved. Please try again.'); return }
    notify(next ? 'Post published.' : 'Post moved to draft.'); await load()
  }

  async function deletePost(post: SitePost) {
    if (!supabase || role !== 'super_admin' || !window.confirm(`Permanently delete “${post.title}”?`)) return
    setBusyId(post.id); setError('')
    const { error: deleteError } = await supabase.from('site_posts').delete().eq('id', post.id)
    setBusyId('')
    if (deleteError) { setError('This item could not be deleted. Please try again.'); return }
    notify('Post deleted.'); await load()
  }

  async function changeRole(profile: ProfileRow, nextRole: string) {
    if (!supabase || role !== 'super_admin') return
    setBusyId(profile.id); setError('')
    const { error: rpcError } = await supabase.rpc('janwatch_admin_set_role', { p_target_user_id: profile.id, p_target_role: nextRole || null })
    setBusyId('')
    if (rpcError) { setError('This action could not be completed. Please try again.'); return }
    notify(`Role updated for ${profile.display_name || profile.id}.`); await load()
  }

  const roleMap = useMemo(() => new Map(roles.map(item => [item.user_id, item.role])), [roles])
  const filteredProfiles = useMemo(() => profiles.filter(p => `${p.display_name || ''} ${p.id} ${p.city || ''} ${p.ward || ''}`.toLowerCase().includes(userSearch.toLowerCase())), [profiles, userSearch])
  const messageMap = useMemo(() => new Map(messages.map(item => [item.id, item])), [messages])

  const allTabs = [
    ['features', 'Feature switches', CirclePower], ['alerts', 'Website alerts', BellRing], ['moderation', 'Chat moderation', MessageCircle], ['rewards', 'Rewards & withdrawals', Wallet], ['roles', 'User roles', Users], ['audit', 'Audit history', ShieldCheck], ['content', 'Content & blog', FileText],
  ] as const
  const tabs: ReadonlyArray<(typeof allTabs)[number]> = role === 'moderator' ? [allTabs[2]] : role === 'super_admin' ? allTabs : allTabs.filter(([key]) => key !== 'roles' && key !== 'content')

  return <div className="ops-admin">
    <div className="ops-subhead"><div><div className="section-kicker">PLATFORM OPERATIONS</div><h2>Control every live feature</h2><p>Manage public-facing features, alerts, rewards, moderation and website content. Withdrawal requests require an authorised administrator to complete payment.</p></div><button className="btn btn-secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={15}/> Refresh controls</button></div>
    <div className="ops-tabs">{tabs.map(([key, label, Icon]) => <button key={key} className={tab === key ? 'selected' : ''} onClick={() => setTab(key)}><Icon size={15}/>{label}</button>)}</div>
    {error && <div className="ops-error"><AlertCircle size={17}/><span>{error}</span><button className="icon-btn" onClick={() => setError('')} aria-label="Dismiss error"><X size={15}/></button></div>}{tab === 'rewards' && giftCardOptionsError && <div className="ops-error gift-card-migration-warning"><AlertCircle size={17}/><span><b>Gift-card catalogue unavailable.</b> {giftCardOptionsError}</span><button type="button" className="btn btn-secondary" onClick={() => void load()}><RefreshCw size={14}/> Retry</button></div>}
    {loading && <div className="ops-loading"><LoaderCircle size={19} className="spin"/> Loading administration data…</div>}

    {tab === 'features' && <section className="ops-feature-grid">{features.map(feature => <article className="panel ops-feature-card" key={feature.flag_key}><div className="ops-feature-icon"><CirclePower size={18}/></div><div className="ops-feature-copy"><h3>{feature.label}</h3><p>{feature.description}</p>{feature.flag_key === 'janwatch_ai' && role !== 'moderator' && <button type="button" className="btn btn-secondary ops-ai-test" disabled={busyId === 'test-ai' || loading} onClick={() => void testAIConnection()}>{busyId === 'test-ai' ? <LoaderCircle size={14} className="spin"/> : <Sparkles size={14}/>} Test AI connection</button>}</div><button className={`feature-toggle ${feature.enabled ? 'is-on' : ''}`} type="button" role="switch" aria-checked={feature.enabled} aria-label={`Toggle ${feature.label}`} disabled={busyId === feature.flag_key || loading} onClick={() => void toggleFeature(feature)}><span/>{feature.enabled ? 'ON' : 'OFF'}</button></article>)}</section>}

    {tab === 'alerts' && <div className="ops-alert-layout"><section className="panel ops-form-panel"><div className="panel-heading"><div><div className="section-kicker">BROADCAST</div><h3>Publish a website alert</h3></div><BellRing size={18}/></div><form className="ops-form" onSubmit={createAnnouncement}><label>Alert title<input value={alertTitle} onChange={e => setAlertTitle(e.target.value)} maxLength={120} required placeholder="Scheduled maintenance, service update…"/></label><label>Message<textarea value={alertBody} onChange={e => setAlertBody(e.target.value)} maxLength={1500} required rows={4} placeholder="Explain what users need to know…"/></label><div className="ops-two-cols"><label>Severity<select value={alertSeverity} onChange={e => setAlertSeverity(e.target.value as typeof alertSeverity)}><option value="info">Information</option><option value="warning">Warning</option><option value="critical">Critical</option></select></label><label>Auto-expire (optional)<input type="datetime-local" value={alertExpiry} onChange={e => setAlertExpiry(e.target.value)}/></label></div><button className="btn btn-primary" type="submit" disabled={busyId === 'create-alert'}>{busyId === 'create-alert' ? <LoaderCircle size={15} className="spin"/> : <Plus size={15}/>} Publish alert</button></form></section><section className="panel ops-alert-list"><div className="panel-heading"><div><div className="section-kicker">ANNOUNCEMENT FEED</div><h3>Published and past alerts</h3></div></div>{!announcements.length ? <div className="chat-empty"><BellRing size={24}/><b>No announcements yet</b><span>Published alerts appear on the public welcome page and the signed-in workspace.</span></div> : announcements.map(alert => <article className={`ops-alert-row severity-${alert.severity}`} key={alert.id}><div className="ops-alert-symbol"><BellRing size={16}/></div><div className="ops-alert-content"><div><b>{alert.title}</b><span className={`ops-status ${alert.is_active ? 'active' : 'inactive'}`}>{alert.is_active ? 'Published' : 'Hidden'}</span></div><p>{alert.body}</p><small>{dateLabel(alert.created_at)}{alert.expires_at ? ` · expires ${dateLabel(alert.expires_at)}` : ''}</small></div><div className="ops-inline-actions"><button className="icon-btn" title={alert.is_active ? 'Hide alert' : 'Publish alert'} aria-label={alert.is_active ? 'Hide alert' : 'Publish alert'} disabled={busyId === alert.id} onClick={() => void toggleAnnouncement(alert)}>{alert.is_active ? <EyeOff size={15}/> : <Eye size={15}/>}</button><button className="icon-btn danger-icon" title="Delete alert" aria-label="Delete alert" onClick={() => void deleteAnnouncement(alert)}><Trash2 size={15}/></button></div></article>)}</section></div>}

    {tab === 'moderation' && <div className="ops-moderation-grid"><section className="panel"><div className="panel-heading"><div><div className="section-kicker">USER FLAGS</div><h3>Flagged messages</h3></div><Flag size={18}/></div>{!flags.length ? <div className="chat-empty"><Check size={23}/><b>No message flags</b><span>Community flags will appear here for review.</span></div> : flags.map(flag => { const msg = messageMap.get(flag.message_id); return <article className="ops-flag-row" key={flag.id}><div className="ops-flag-content"><b>{flag.reason}</b><small>{dateLabel(flag.created_at)} · Status: {flag.status}</small><p>{msg?.body || '[Message unavailable or deleted]'}</p><small>Message author: {msg?.author_name || 'Unknown'}</small></div>{flag.status === 'open' && <button className="btn btn-secondary" onClick={() => void resolveFlag(flag)}>Mark reviewed</button>}</article> })}</section><section className="panel"><div className="panel-heading"><div><div className="section-kicker">CONTENT REVIEW</div><h3>Recent public messages</h3></div></div>{!messages.length ? <div className="chat-empty"><MessageCircle size={24}/><b>No messages</b></div> : messages.map(message => <article className="ops-chat-row" key={message.id}><div><b>{message.author_name} {message.is_hidden && <span className="ops-status inactive">Hidden</span>}</b><p>{message.body}</p><small>{dateLabel(message.created_at)}</small></div><div className="ops-inline-actions"><button className="icon-btn" aria-label={message.is_hidden ? 'Restore message' : 'Hide message'} title={message.is_hidden ? 'Restore' : 'Hide'} onClick={() => void moderateMessage(message, !message.is_hidden)}>{message.is_hidden ? <Eye size={15}/> : <EyeOff size={15}/>}</button><button className="icon-btn danger-icon" aria-label="Delete message" title="Delete permanently" onClick={() => void removeMessage(message)}><Trash2 size={15}/></button></div></article>)}</section></div>}

    {tab === 'rewards' && <><section className="panel ops-reward-config-panel"><div className="panel-heading"><div><div className="section-kicker">PROGRAMME RULES</div><h3>Control points, conversion and redemptions</h3><p>Withdrawals are off by default. Configure allowed methods and enable requests only when the programme can honour them.</p></div><Wallet size={19}/></div><form className="ops-reward-config-form" onSubmit={saveRewardSettings}><label className="ops-config-toggle"><input type="checkbox" checked={rewardSettings.enabled} onChange={e => setRewardSettings(v => ({ ...v, enabled: e.target.checked }))}/><span><b>Reward points enabled</b><small>Allows the ledger and milestone rules to grant points.</small></span></label><label className="ops-config-toggle"><input type="checkbox" checked={rewardSettings.cash_redemption_enabled} onChange={e => setRewardSettings(v => ({ ...v, cash_redemption_enabled: e.target.checked }))}/><span><b>Cash withdrawals enabled</b><small>Lets eligible users submit payout requests for administrator review.</small></span></label><div className="ops-config-fields"><label>Points per ₹1<input type="number" min="0.01" max="100000000" step="0.01" value={rewardSettings.points_per_rupee} onChange={e => setRewardSettings(v => ({ ...v, points_per_rupee: Number(e.target.value) }))} required/></label><label>Minimum withdrawal points<input type="number" min="1" step="1" value={rewardSettings.min_withdrawal_points} onChange={e => setRewardSettings(v => ({ ...v, min_withdrawal_points: Number(e.target.value) }))} required/></label><label>Maximum withdrawal points<input type="number" min={rewardSettings.min_withdrawal_points} step="1" value={rewardSettings.max_withdrawal_points} onChange={e => setRewardSettings(v => ({ ...v, max_withdrawal_points: Number(e.target.value) }))} required/></label><label>Points for verified public report<input type="number" min="0" max="100000" step="1" value={rewardSettings.points_for_verified_report} onChange={e => setRewardSettings(v => ({ ...v, points_for_verified_report: Number(e.target.value) }))} required/></label><label>Points for resolved public report<input type="number" min="0" max="100000" step="1" value={rewardSettings.points_for_resolved_report} onChange={e => setRewardSettings(v => ({ ...v, points_for_resolved_report: Number(e.target.value) }))} required/></label></div><div className="ops-payout-method-config"><b>Enabled withdrawal methods</b><p>Users can choose only methods enabled here. Payments and gift card delivery remain manual.</p>{(['UPI', 'Bank transfer', 'Gift card'] as const).map(method => <label key={method}><input type="checkbox" checked={rewardSettings.enabled_payout_methods.includes(method)} onChange={e => setRewardSettings(v => ({ ...v, enabled_payout_methods: e.target.checked ? [...v.enabled_payout_methods.filter(x => x !== method), method] : v.enabled_payout_methods.filter(x => x !== method) }))}/>{method}</label>)}</div><section className="ops-gift-card-admin"><h4>Gift card catalogue and limits</h4><p className="ops-help">Add any brand (Amazon, Google Play, Croma, PVR, etc.). Limits are in rupees and are enforced by the server for each request. Enable “Gift card” under withdrawal methods separately to let users request one.</p>{giftCardOptionsError && <p className="ops-help">Catalogue setup is incomplete. Apply the SQL migration before adding or saving brands.</p>}<form className="ops-config-fields" onSubmit={addGiftCardOption}><label>Gift card brand<input value={newGiftCardBrand} onChange={e => setNewGiftCardBrand(e.target.value)} placeholder="Amazon" maxLength={80} required/></label><label>Minimum ₹ amount<input type="number" min="1" step="1" value={newGiftCardMin} onChange={e => setNewGiftCardMin(e.target.value)} required/></label><label>Maximum ₹ amount<input type="number" min={newGiftCardMin || 1} step="1" value={newGiftCardMax} onChange={e => setNewGiftCardMax(e.target.value)} required/></label><button className="btn btn-secondary" type="submit" disabled={busyId === 'add-gift-card' || Boolean(giftCardOptionsError)}>{busyId === 'add-gift-card' ? 'Adding…' : <><Plus size={15}/> Add gift card</>}</button></form>{giftCardOptions.length ? <div className="ops-gift-card-list">{giftCardOptions.map(option => <article key={option.id}><label>Brand<input value={option.brand} onChange={e => setGiftCardOptions(rows => rows.map(row => row.id === option.id ? { ...row, brand: e.target.value } : row))} maxLength={80}/></label><label>Min ₹<input type="number" min="1" value={option.min_amount_inr} onChange={e => setGiftCardOptions(rows => rows.map(row => row.id === option.id ? { ...row, min_amount_inr: Number(e.target.value) } : row))}/></label><label>Max ₹<input type="number" min={option.min_amount_inr} value={option.max_amount_inr} onChange={e => setGiftCardOptions(rows => rows.map(row => row.id === option.id ? { ...row, max_amount_inr: Number(e.target.value) } : row))}/></label><label className="ops-config-toggle"><input type="checkbox" checked={option.active} onChange={e => setGiftCardOptions(rows => rows.map(row => row.id === option.id ? { ...row, active: e.target.checked } : row))}/> Active</label><button type="button" className="btn btn-secondary" disabled={busyId === `gift-card-${option.id}` || Boolean(giftCardOptionsError)} onClick={() => void saveGiftCardOption(option)}><Save size={14}/> Save</button></article>)}</div> : <p className="ops-help">No gift card brands added yet.</p>}</section><div className="ops-config-toggles"><label><input type="checkbox" checked={rewardSettings.auto_reward_on_verified} onChange={e => setRewardSettings(v => ({ ...v, auto_reward_on_verified: e.target.checked }))}/> Auto-grant on Verified status</label><label><input type="checkbox" checked={rewardSettings.auto_reward_on_resolved} onChange={e => setRewardSettings(v => ({ ...v, auto_reward_on_resolved: e.target.checked }))}/> Auto-grant on Resolved status</label></div><div className="ops-reward-config-foot"><p>Milestone rewards are granted once per public report status milestone, only when an authorised account changes its status. They do not prove independent verification or guarantee payment.</p><button className="btn btn-primary" type="submit" disabled={busyId === 'reward-settings' || loading || role === 'moderator'}>{busyId === 'reward-settings' ? <LoaderCircle size={15} className="spin"/> : <Save size={15}/>} Save reward rules</button></div></form></section><div className="ops-rewards-layout"><section className="panel ops-form-panel"><div className="panel-heading"><div><div className="section-kicker">QUALITY CONTRIBUTIONS</div><h3>Grant manual reward points</h3></div><Wallet size={18}/></div><form className="ops-form" onSubmit={grantReward}><label>Citizen account<select value={selectedUser} onChange={e => setSelectedUser(e.target.value)} required><option value="">Choose a profile…</option>{profiles.map(profile => <option value={profile.id} key={profile.id}>{profile.display_name || profile.id} · {profile.id.slice(0, 8)}</option>)}</select></label><label>Adjustment<select value={rewardAdjustment} onChange={e => setRewardAdjustment(e.target.value as 'grant' | 'deduct')}><option value="grant">Grant points</option><option value="deduct">Deduct points</option></select></label><label>Points amount<input type="number" min="1" max="1000000" step="1" value={grantPoints} onChange={e => setGrantPoints(e.target.value)} required/></label><label>Reason / reviewed contribution<input value={grantReason} onChange={e => setGrantReason(e.target.value)} maxLength={400} required/></label><button className="btn btn-primary" type="submit" disabled={busyId === 'grant-reward' || role === 'moderator' || (rewardAdjustment === 'grant' && !rewardSettings.enabled)}>{busyId === 'grant-reward' ? <LoaderCircle size={15} className="spin"/> : <Plus size={15}/>} {rewardAdjustment === 'grant' ? 'Grant points' : 'Deduct points'}</button><p className="ops-help">Record the reason for every adjustment. Deductions are limited to the account’s available, unreserved points.</p></form></section><section className="panel ops-payout-panel"><div className="panel-heading"><div><div className="section-kicker">MANUAL PAYOUT QUEUE</div><h3>Withdrawal requests</h3></div><Clock3 size={18}/></div><p className="ops-help">Approve or reject requests. To mark “paid”, first send the transfer using your authorised payout process, then enter its real transaction reference. This interface does not initiate a bank/UPI transfer.</p>{!withdrawals.length ? <div className="chat-empty"><Wallet size={24}/><b>No withdrawal requests</b></div> : withdrawals.map(withdrawal => <article className="ops-withdrawal-row" key={withdrawal.id}><div className="ops-withdrawal-main"><div><b>₹{Number(withdrawal.amount_inr).toLocaleString('en-IN')} · {withdrawal.points_requested.toLocaleString()} points</b><span className={`withdraw-status withdraw-${withdrawal.status}`}>{withdrawal.status}</span></div><small>User: {withdrawal.user_id.slice(0, 8)}… · {dateLabel(withdrawal.created_at)}</small><small>{withdrawal.payout_method}{withdrawal.gift_card_brand ? ` · ${withdrawal.gift_card_brand}` : ''} · {withdrawal.payout_destination === 'IN_APP' ? 'In-app code delivery' : withdrawal.payout_destination}</small>{withdrawal.gift_card_code && <small>Delivered code: {withdrawal.gift_card_code}</small>}{withdrawal.admin_note && <p>{withdrawal.admin_note}</p>}</div>{['pending', 'approved'].includes(withdrawal.status) && <div className="ops-withdrawal-actions"><input value={payoutNotes[withdrawal.id] ?? ''} onChange={e => setPayoutNotes(c => ({ ...c, [withdrawal.id]: e.target.value }))} placeholder="Admin note (optional)" maxLength={500}/><div>{withdrawal.status === 'pending' && <button className="btn btn-secondary" disabled={busyId === withdrawal.id} onClick={() => void processWithdrawal(withdrawal, 'approve')}>Approve</button>}<button className="btn btn-danger" disabled={busyId === withdrawal.id} onClick={() => void processWithdrawal(withdrawal, 'reject')}>Reject</button></div>{withdrawal.status === 'approved' && (withdrawal.payout_method === 'Gift card' ? <><input value={giftCardCodes[withdrawal.id] ?? ''} onChange={e => setGiftCardCodes(c => ({ ...c, [withdrawal.id]: e.target.value }))} placeholder="Paste gift card code for user" maxLength={250}/><button className="btn btn-primary" disabled={busyId === withdrawal.id} onClick={() => void deliverGiftCard(withdrawal)}>{busyId === withdrawal.id ? 'Delivering…' : 'Deliver gift card code'}</button></> : <><input value={payoutRefs[withdrawal.id] ?? ''} onChange={e => setPayoutRefs(c => ({ ...c, [withdrawal.id]: e.target.value }))} placeholder="Real external transaction reference" maxLength={160}/><button className="btn btn-primary" disabled={busyId === withdrawal.id} onClick={() => void processWithdrawal(withdrawal, 'paid')}>{busyId === withdrawal.id ? 'Saving…' : 'Mark paid after transfer'}</button></>)}</div>}</article>)}</section></div></>}

    {tab === 'roles' && <section className="panel ops-roles-panel"><div className="panel-heading"><div><div className="section-kicker">ACCESS CONTROL</div><h3>User role management</h3><p>Only super administrators can assign roles. Worker grants task access only; moderator/admin permissions remain separate.</p></div><Users size={18}/></div>{role !== 'super_admin' ? <div className="ops-denied"><ShieldCheck size={25}/><b>Super administrator permission required</b><span>This account can manage platform features, but only a super administrator can change user roles.</span></div> : <><input className="ops-search" value={userSearch} onChange={e => setUserSearch(e.target.value)} placeholder="Search by name, account ID, city or ward…"/><div className="ops-role-list">{filteredProfiles.map(profile => <article key={profile.id}><div className="ops-role-user"><span className="ops-role-avatar">{(profile.display_name || 'C').slice(0, 1).toUpperCase()}</span><div><b>{profile.display_name || 'Unnamed account'}</b><small>{profile.id} · {[profile.city, profile.ward].filter(Boolean).join(', ')}</small></div></div><label><span className="sr-only">Role for {profile.display_name || profile.id}</span><select disabled={busyId === profile.id || profile.id === userId} value={roleMap.get(profile.id) || 'citizen'} onChange={e => void changeRole(profile, e.target.value === 'citizen' ? '' : e.target.value)}><option value="citizen">Citizen</option><option value="worker">Worker (directly assign work)</option><option value="moderator">Moderator</option><option value="admin">Administrator</option><option value="super_admin">Super administrator</option></select></label></article>)}{!filteredProfiles.length && <p className="ops-help">No users match this search. Try a different name, account ID, city or ward.</p>}</div></>}</section>}

    {tab === 'audit' && <section className="panel ops-audit-panel"><div className="panel-heading"><div><div className="section-kicker">ACCOUNTABILITY</div><h3>Recent audit events</h3><p>Recent changes made by administrators.</p></div><ShieldCheck size={18}/></div>{!auditRows.length ? <div className="chat-empty"><ShieldCheck size={24}/><b>No recent activity</b><span>Recent administrative activity will appear here.</span></div> : <div className="ops-audit-list">{auditRows.map(row => <article key={row.id}><span className="ops-audit-icon"><ShieldCheck size={15}/></span><div><b>{row.action.replace(/_/g, ' ')}</b><small>{dateLabel(row.created_at)} · Actor {row.actor_id?.slice(0, 8) || 'system'} · {row.target_type || 'system'} {row.target_id ? `· ${row.target_id}` : ''}</small><code>{row.target_type ? `Related to ${row.target_type.replace(/_/g, ' ')}` : 'Platform activity'}</code></div></article>)}</div>}</section>}
    {tab === 'content' && role === 'super_admin' && <div className="ops-content-layout"><section className="panel ops-form-panel"><div className="panel-heading"><div><div className="section-kicker">SUPER ADMIN EDITOR</div><h3>{editingPostId ? 'Edit blog or product update' : 'Publish a blog or product update'}</h3><p>This content appears in the public Blog & Updates page. Drafts remain private until published.</p></div><FileText size={19}/></div><form className="ops-form" onSubmit={savePost}><label>Post title<input value={postTitle} onChange={e => setPostTitle(e.target.value)} maxLength={160} minLength={3} required placeholder="New feature: community updates"/></label><label>Short excerpt<input value={postExcerpt} onChange={e => setPostExcerpt(e.target.value)} maxLength={500} placeholder="One or two lines shown on the public card"/></label><label>Post type<select value={postType} onChange={e => setPostType(e.target.value as SitePost['post_type'])}><option value="blog">Blog article</option><option value="app_update">App update</option><option value="feature_update">Feature update</option></select></label><label>Article content<textarea value={postBody} onChange={e => setPostBody(e.target.value)} rows={8} minLength={10} maxLength={20000} required placeholder="Write the full post. Plain text and line breaks are supported."/></label><label>Related HTTPS link (optional)<input type="url" value={postLink} onChange={e => setPostLink(e.target.value)} placeholder="https://example.com/release-notes"/></label><label className="ops-config-toggle"><input type="checkbox" checked={publishNow} onChange={e => setPublishNow(e.target.checked)}/><span><b>Publish immediately</b><small>Turn off to save a private draft.</small></span></label><button className="btn btn-primary" type="submit" disabled={busyId === 'save-post' || loading}>{busyId === 'save-post' ? <LoaderCircle size={15} className="spin"/> : editingPostId ? <Save size={15}/> : <Plus size={15}/>} {editingPostId ? 'Save changes' : publishNow ? 'Publish post' : 'Save draft'}</button>{editingPostId && <button className="btn btn-secondary" type="button" onClick={cancelEditPost}>Cancel editing</button>}</form></section><section className="panel ops-content-list"><div className="panel-heading"><div><div className="section-kicker">CONTENT LIBRARY</div><h3>Blogs and updates</h3></div><span className="ops-status active">{posts.length} total</span></div>{!posts.length ? <div className="chat-empty"><FileText size={25}/><b>No content yet</b><span>Create your first post using the editor.</span></div> : posts.map(post => <article className="ops-post-row" key={post.id}><div className="ops-post-row-main"><div><span className="ops-post-type">{post.post_type.replace('_', ' ')}</span><span className={`ops-status ${post.is_published ? 'active' : 'inactive'}`}>{post.is_published ? 'Published' : 'Draft'}</span></div><b>{post.title}</b><p>{post.excerpt || post.body.slice(0, 180)}</p><small>{dateLabel(post.published_at || post.created_at)} · /{post.slug}</small>{post.link_url && <a href={post.link_url} target="_blank" rel="noopener noreferrer">Open related link <ExternalLink size={12}/></a>}</div><div className="ops-inline-actions"><button className="icon-btn" disabled={busyId === post.id} onClick={() => editPost(post)} aria-label="Edit post" title="Edit post"><FileText size={15}/></button><button className="icon-btn" disabled={busyId === post.id} onClick={() => void togglePost(post)} aria-label={post.is_published ? 'Unpublish post' : 'Publish post'} title={post.is_published ? 'Move to draft' : 'Publish'}>{post.is_published ? <EyeOff size={15}/> : <Eye size={15}/>}</button><button className="icon-btn danger-icon" disabled={busyId === post.id} onClick={() => void deletePost(post)} aria-label="Delete post" title="Delete post"><Trash2 size={15}/></button></div></article>)}</section></div>}

    <div className="admin-footer"><ShieldCheck size={15}/> Administrative actions are limited by your assigned role.</div>
  </div>
}
