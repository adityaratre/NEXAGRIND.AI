import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode, RefObject } from 'react'
import type { User } from '@supabase/supabase-js'
import {
  Activity, AlertTriangle, ArrowRight, ArrowUpRight, Bell, Check, ChevronDown,
  CircleHelp, Clock3, Compass, FileText, Filter, Globe2, LayoutDashboard,
  Leaf, LogOut, MapPin, Menu, MessageSquareText, Moon, Plus, Search, Settings,
  ShieldCheck, Sparkles, Sun, ThumbsUp, Users, Waves, X, Zap, Camera, Send,
  BadgeCheck, LocateFixed, ExternalLink, Eye, RefreshCw, LockKeyhole, Mail,
  CheckCircle2, Map as MapIcon, Image as ImageIcon, LoaderCircle, CircleAlert, UserRound, FileDown, ClipboardCheck,
  PanelLeftClose, PanelLeftOpen, Coins, Wallet, BellRing, CirclePower, HandHeart, Gift
} from 'lucide-react'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import CivicToolkit from './components/CivicToolkit'
import JanwatchAI from './components/JanwatchAI'
import CommunityChat from './components/CommunityChat'
import RewardsPage from './components/RewardsPage'
import AdminOperations from './components/AdminOperations'
import WorkerReferralHub, { ReferralStudio } from './components/WorkerReferralHub'
import DonationPage from './components/DonationPage'

type DbStatus = 'submitted' | 'under_review' | 'verified' | 'in_progress' | 'resolved' | 'rejected'
type SuggestedSeverity = 'normal' | 'high' | 'urgent'
type ViewName = 'Overview' | 'Explore map' | 'My reports' | 'Community' | 'Public chat' | 'Rewards' | 'Civic toolkit' | 'LokPravaah AI' | 'Worker Hub' | 'Refer & Earn' | 'Donate' | 'My profile'
const PRIVILEGED_PLATFORM_ROLES = ['moderator', 'admin', 'super_admin'] as const
type Language = 'EN' | 'HI'
type Theme = 'dark' | 'light'
type EntryScreen = 'welcome' | 'auth' | 'onboarding' | 'workspace'
type AuthMode = 'login' | 'register' | 'reset'
type AccountType = 'citizen' | 'volunteer' | 'organisation'
type Profile = { display_name: string | null; avatar_url: string | null; impact_points: number | null; preferred_language: string | null; phone?: string | null; city?: string | null; ward?: string | null; account_type?: AccountType | null; preferred_service?: string | null }
type Issue = {
  id: string
  code: string
  title: string
  description: string
  area: string
  category: string
  status: DbStatus
  suggestedSeverity: SuggestedSeverity
  createdAt: string
  updatedAt: string
  reporterId: string
  visibility: 'public' | 'private'
  latitude: number | null
  longitude: number | null
  evidencePaths: string[]
  reporterName?: string
  reporterCity?: string
  reporterWard?: string
  votes: number | null
  supportedByMe: boolean
}
type Stats = { total: number | null; active: number | null; resolved: number | null; mine: number | null }
type Coordinates = { lat: number; lon: number; label: string }
type ReportEvent = { event_type: string; note: string | null; created_at: string }
type FeatureKey = 'reporting' | 'public_chat' | 'rewards' | 'civic_toolkit' | 'evidence_upload' | 'community_support' | 'janwatch_ai'
type SiteAnnouncement = { id: string; title: string; body: string; severity: 'info' | 'warning' | 'critical'; created_at: string; expires_at: string | null }

const EMPTY_STATS: Stats = { total: null, active: null, resolved: null, mine: null }
const CATEGORIES = [
  'Roads & Footpaths', 'Waste & Sanitation', 'Streetlights', 'Water & Drainage',
  'Public Safety', 'Parks & Public Spaces', 'Other'
]
const VIEW_ITEMS: { label: ViewName; icon: typeof LayoutDashboard }[] = [
  { label: 'Overview', icon: LayoutDashboard },
  { label: 'Explore map', icon: Compass },
  { label: 'My reports', icon: FileText },
  { label: 'Community', icon: Users },
  { label: 'Public chat', icon: MessageSquareText },
  { label: 'Rewards', icon: Coins },
  { label: 'Civic toolkit', icon: ClipboardCheck },
  { label: 'LokPravaah AI', icon: Sparkles },
  { label: 'Worker Hub', icon: HandHeart },
  { label: 'Refer & Earn', icon: Gift },
  { label: 'Donate', icon: Wallet },
]
const DEFAULT_FEATURE_FLAGS: Record<FeatureKey, boolean> = { reporting: true, public_chat: true, rewards: true, civic_toolkit: true, evidence_upload: true, community_support: true, janwatch_ai: true }
function getSavedSidebarCollapsed(): boolean { try { return localStorage.getItem('janwatch.sidebarCollapsed') === 'true' } catch { return false } }
const DB_STATUSES: DbStatus[] = ['submitted', 'under_review', 'verified', 'in_progress', 'resolved', 'rejected']

function normalizeTerms(value: string): string[] {
  return [...new Set(value.toLocaleLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(term => term.length > 2))]
}
function overlapRatio(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0
  const common = [...left].filter(term => right.has(term)).length
  return common / new Set([...left, ...right]).size
}
function assessSeverity(category: string, title: string, details: string): SuggestedSeverity {
  const value = `${category} ${title} ${details}`.toLocaleLowerCase()
  const urgentTerms = ['live wire', 'exposed wire', 'electric shock', 'gas leak', 'fire', 'open manhole', 'building collapse', 'wall collapse', 'fallen electric pole', 'electrocution', 'खुला बिजली तार', 'बिजली का तार', 'गैस लीक', 'आग लग', 'खुला मैनहोल', 'इमारत गिर', 'दीवार गिर', 'करंट लग']
  const highTerms = ['severe flooding', 'water entering homes', 'road collapsed', 'major pothole', 'sewage overflow', 'contaminated drinking water', 'dangerous road', 'accident risk', 'flooding', 'overflowing drain', 'गंभीर जलभराव', 'घर में पानी', 'सड़क धंस', 'बड़ा गड्ढा', 'सीवेज', 'दूषित पानी', 'दुर्घटना', 'नाली का पानी', 'खतरनाक सड़क']
  if (urgentTerms.some(term => value.includes(term))) return 'urgent'
  if (highTerms.some(term => value.includes(term))) return 'high'
  return 'normal'
}

function statusLabel(status: DbStatus): string {
  const labels: Record<DbStatus, string> = {
    submitted: 'Submitted', under_review: 'Under review', verified: 'Verified',
    in_progress: 'In progress', resolved: 'Resolved', rejected: 'Rejected'
  }
  return labels[status]
}
function uiStatus(status: string): DbStatus {
  return DB_STATUSES.includes(status as DbStatus) ? status as DbStatus : 'submitted'
}
function formatDate(date: string): string {
  const parsed = new Date(date)
  return Number.isNaN(parsed.getTime()) ? 'Date unavailable' : parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
function relativeDate(date: string): string {
  const parsed = new Date(date).getTime()
  if (!Number.isFinite(parsed)) return 'Date unavailable'
  const diff = Math.max(0, Date.now() - parsed)
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(parsed).toLocaleDateString()
}
function readableError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) return String((error as { message: unknown }).message)
  return 'Something went wrong. Please try again.'
}
function friendlyAuthError(error: unknown): string {
  const raw = readableError(error)
  const value = raw.toLowerCase()
  if (/(rate.?limit|too many.*email|over_email_send_rate_limit|email.*limit)/i.test(raw)) {
    return "Email delivery is temporarily limited. Wait a little before requesting another email, or try signing in if you already created your account."
  }
  if (value.includes('invalid login credentials')) {
    return "Your email or password was not recognised. Check your details or use Forgot password to reset your password."
  }
  if (value.includes('email not confirmed') || value.includes('email_not_confirmed')) {
    return "Please verify your email using the confirmation link we sent you. If you cannot find it, check your spam folder or request another email later."
  }
  if (value.includes('user already registered') || value.includes('already been registered')) {
    return "An account with this email may already exist. Switch to Sign in or use Forgot password instead of registering again."
  }
  if (value.includes('password should be at least') || value.includes('weak_password')) {
    return "Choose a stronger password with at least 8 characters, including a mix of letters and numbers."
  }
  if (value.includes('network') || value.includes('failed to fetch')) {
    return "We could not connect just now. Check your internet connection and try again."
  }
  return 'We could not complete that action. Please check your details and try again.'
}

function getCapturedReferralCode(metadataCode = ''): string {
  try {
    const urlCode = new URLSearchParams(window.location.search).get('ref')?.trim().toUpperCase() || ''
    if (/^[A-Z0-9]{8}$/.test(urlCode)) {
      try { sessionStorage.setItem('janwatch.pendingReferralCode', urlCode) } catch { /* optional session storage */ }
      return urlCode
    }
  } catch { /* optional URL access */ }
  try {
    const savedCode = String(sessionStorage.getItem('janwatch.pendingReferralCode') || '').trim().toUpperCase()
    if (/^[A-Z0-9]{8}$/.test(savedCode)) return savedCode
  } catch { /* optional session storage */ }
  const metaCode = String(metadataCode || '').trim().toUpperCase()
  return /^[A-Z0-9]{8}$/.test(metaCode) ? metaCode : ''
}

function getSavedTheme(): Theme {
  try { return localStorage.getItem('janwatch.theme') === 'light' ? 'light' : 'dark' } catch { return 'dark' }
}
function getSavedLanguage(): Language {
  try { return localStorage.getItem('janwatch.language') === 'HI' ? 'HI' : 'EN' } catch { return 'EN' }
}
function mapIssue(row: any): Issue {
  return {
    id: String(row.id), code: String(row.public_code ?? 'JW-UNKNOWN'),
    title: String(row.title ?? 'Untitled report'), description: String(row.description ?? ''),
    area: String(row.address_label ?? 'Location not provided'), category: String(row.category ?? 'Other'),
    status: uiStatus(String(row.status ?? 'submitted')),
    suggestedSeverity: (['normal', 'high', 'urgent'].includes(String(row.suggested_severity)) ? String(row.suggested_severity) : 'normal') as SuggestedSeverity,
    createdAt: String(row.created_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? row.created_at ?? new Date().toISOString()),
    reporterId: String(row.reporter_id ?? ''), visibility: row.visibility === 'private' ? 'private' : 'public',
    latitude: typeof row.latitude === 'number' ? row.latitude : null,
    longitude: typeof row.longitude === 'number' ? row.longitude : null,
    evidencePaths: Array.isArray(row.evidence_paths) ? row.evidence_paths.filter((p: unknown) => typeof p === 'string') : [],
    votes: null, supportedByMe: false,
  }
}

export default function App() {
  const client = supabase
  // The public welcome page is intentional: even a returning authenticated user lands here first.
  const [entryScreen, setEntryScreen] = useState<EntryScreen>('welcome')
  const [authMode, setAuthMode] = useState<AuthMode>('login')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authFullName, setAuthFullName] = useState('')
  const [authConfirmPassword, setAuthConfirmPassword] = useState('')
  const [authMessage, setAuthMessage] = useState('')
  const [profilePhone, setProfilePhone] = useState('')
  const [profileCity, setProfileCity] = useState('')
  const [profileWard, setProfileWard] = useState('')
  const [accountType, setAccountType] = useState<AccountType>('citizen')
  const [preferredService, setPreferredService] = useState(CATEGORIES[0])
  const [savingOnboarding, setSavingOnboarding] = useState(false)
  const [onboardingMode, setOnboardingMode] = useState<'setup' | 'edit'>('setup')
  const [active, setActive] = useState<ViewName>('Overview')
  const [dark, setDark] = useState<Theme>(getSavedTheme() === 'dark' ? 'dark' : 'light')
  const [language, setLanguage] = useState<Language>(getSavedLanguage())
  const [mobileNav, setMobileNav] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(getSavedSidebarCollapsed)
  const [featureFlags, setFeatureFlags] = useState<Record<FeatureKey, boolean>>(DEFAULT_FEATURE_FLAGS)
  const [siteAnnouncements, setSiteAnnouncements] = useState<SiteAnnouncement[]>([])
  const [showReport, setShowReport] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [showActivity, setShowActivity] = useState(false)
  const [admin, setAdmin] = useState(false)
  const [adminRole, setAdminRole] = useState('')
  const [toast, setToast] = useState('')
  const [authLoading, setAuthLoading] = useState(true)
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState('')
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [issues, setIssues] = useState<Issue[]>([])
  const [stats, setStats] = useState<Stats>(EMPTY_STATS)
  const [loadingReports, setLoadingReports] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [dataError, setDataError] = useState('')
  const [dataLoaded, setDataLoaded] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('All reports')
  const [savingReport, setSavingReport] = useState(false)
  const [reportTitle, setReportTitle] = useState('')
  const [reportCategory, setReportCategory] = useState(CATEGORIES[0])
  const [reportDetails, setReportDetails] = useState('')
  const [reportArea, setReportArea] = useState('')
  const [reportCoordinates, setReportCoordinates] = useState<{ latitude: number; longitude: number } | null>(null)
  const [locating, setLocating] = useState(false)
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null)
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null)
  const [signedEvidenceUrl, setSignedEvidenceUrl] = useState('')
  const [issueEvents, setIssueEvents] = useState<ReportEvent[]>([])
  const [adminUpdatingId, setAdminUpdatingId] = useState('')
  const [mapFocus, setMapFocus] = useState<Coordinates | null>(null)
  const [mapAddressQuery, setMapAddressQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const notificationWrapRef = useRef<HTMLDivElement>(null)
  const mapFocusRef = useRef<Coordinates | null>(null)

  const notify = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(current => current === message ? '' : current), 3600)
  }, [])
  const loadPlatformSettings = useCallback(async () => {
    if (!client) return
    const [featuresResult, alertsResult] = await Promise.all([
      client.from('app_feature_flags').select('flag_key,enabled'),
      client.from('site_announcements').select('id,title,body,severity,created_at,expires_at').eq('is_active', true).order('created_at', { ascending: false }).limit(4),
    ])
    if (!featuresResult.error && featuresResult.data) {
      setFeatureFlags(current => {
        const next = { ...current }
        for (const row of featuresResult.data as { flag_key: string; enabled: boolean }[]) {
          if (row.flag_key in next) next[row.flag_key as FeatureKey] = row.enabled
        }
        return next
      })
    }
    if (!alertsResult.error && alertsResult.data) setSiteAnnouncements(alertsResult.data as SiteAnnouncement[])
  }, [client])
  useEffect(() => {
    if (!client) return
    void loadPlatformSettings()
    const channel = client.channel('janwatch-platform-settings')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_feature_flags' }, () => { void loadPlatformSettings() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'site_announcements' }, () => { void loadPlatformSettings() })
      .subscribe()
    return () => { void client.removeChannel(channel) }
  }, [client, loadPlatformSettings])
  const isHi = language === 'HI'
  useEffect(() => { mapFocusRef.current = mapFocus }, [mapFocus])
  const isLive = Boolean(client && user && dataLoaded && !dataError)
  const userName = String(profile?.display_name || user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split('@')[0] || 'Citizen')
  const avatarUrl = String(profile?.avatar_url || user?.user_metadata?.avatar_url || '')
  const resolveAssignedRole = useCallback(async (targetUserId: string): Promise<string> => {
    if (!client) return ''
    // Treat an empty/unknown RPC result just like an RPC failure and try the own-row lookup.
    // The previous code only fell back on an RPC error, which could hide the admin entry
    // when the endpoint returned an empty or stale role without an error.
    try {
      const rpcResult = await client.rpc('janwatch_current_user_role')
      const rpcRole = String(rpcResult.data ?? '').trim().toLowerCase()
      if (!rpcResult.error && (PRIVILEGED_PLATFORM_ROLES.includes(rpcRole as typeof PRIVILEGED_PLATFORM_ROLES[number]) || rpcRole === 'worker')) return rpcRole
    } catch { /* use the own-role lookup below */ }
    try {
      const fallback = await client.from('user_roles').select('role').eq('user_id', targetUserId).maybeSingle()
      const fallbackRole = String(fallback.data?.role ?? '').trim().toLowerCase()
      if (!fallback.error && (PRIVILEGED_PLATFORM_ROLES.includes(fallbackRole as typeof PRIVILEGED_PLATFORM_ROLES[number]) || fallbackRole === 'worker')) return fallbackRole
    } catch { /* role remains unconfirmed */ }
    return ''
  }, [client])
  const hasAdminAccess = Boolean(user && ['admin', 'super_admin'].includes(adminRole))
  const hasConsoleAccess = Boolean(user && PRIVILEGED_PLATFORM_ROLES.includes(adminRole as typeof PRIVILEGED_PLATFORM_ROLES[number]))
  const hasModerationAccess = hasConsoleAccess

  useEffect(() => {
    if (!client) {
      setAuthLoading(false)
      setAuthError('Sign-in is temporarily unavailable. Please try again later.')
      return
    }
    let mounted = true
    void client.auth.getSession().then(({ data, error }) => {
      if (!mounted) return
      if (error) setAuthError('We could not restore your session. Please refresh and try again.')
      const sessionUser = data.session?.user ?? null
      setUser(sessionUser)
      if (sessionUser) {
        const meta = sessionUser.user_metadata ?? {}
        setAuthFullName(current => current || String(meta.full_name || meta.name || sessionUser.email?.split('@')[0] || ''))
        setProfilePhone(current => current || String(meta.phone || ''))
        setProfileCity(current => current || String(meta.city || ''))
        setProfileWard(current => current || String(meta.ward || ''))
        setAccountType((meta.account_type as AccountType) || 'citizen')
        setPreferredService(String(meta.preferred_service || CATEGORIES[0]))
      }
      try {
        const authFlow = sessionStorage.getItem('janwatch.authFlow')
        if (sessionUser && authFlow) {
          const setupComplete = sessionUser.user_metadata?.janwatch_onboarding_complete === true
          setOnboardingMode(setupComplete ? 'edit' : 'setup')
          setEntryScreen(setupComplete ? 'workspace' : 'onboarding')
          sessionStorage.removeItem('janwatch.authFlow')
        }
      } catch { /* session storage may be unavailable */ }
      setAuthLoading(false)
    }).catch((error: unknown) => {
      if (!mounted) return
      setAuthError(friendlyAuthError(error))
      setAuthLoading(false)
    })
    const { data: listener } = client.auth.onAuthStateChange((event, session) => {
      const sessionUser = session?.user ?? null
      setUser(sessionUser)
      if (sessionUser) {
        const meta = sessionUser.user_metadata ?? {}
        setAuthFullName(current => current || String(meta.full_name || meta.name || sessionUser.email?.split('@')[0] || ''))
        setProfilePhone(current => current || String(meta.phone || ''))
        setProfileCity(current => current || String(meta.city || ''))
        setProfileWard(current => current || String(meta.ward || ''))
        setAccountType((meta.account_type as AccountType) || 'citizen')
        setPreferredService(String(meta.preferred_service || CATEGORIES[0]))
      }
      setAuthError('')
      setAuthLoading(false)
      if (event === 'PASSWORD_RECOVERY') {
        setAuthMode('reset')
        setAuthPassword('')
        setAuthConfirmPassword('')
        setEntryScreen('auth')
        try { sessionStorage.removeItem('janwatch.authFlow') } catch { /* optional */ }
      }
      try {
        const authFlow = sessionStorage.getItem('janwatch.authFlow')
        if (sessionUser && authFlow) {
          setEntryScreen(sessionUser.user_metadata?.janwatch_onboarding_complete === true ? 'workspace' : 'onboarding')
          sessionStorage.removeItem('janwatch.authFlow')
        }
      } catch { /* session storage may be unavailable */ }
      if (!session?.user) {
        setEntryScreen('welcome')
        setIssues([])
        setStats(EMPTY_STATS)
        setProfile(null)
        setDataLoaded(false)
        setDataError('')
        setAdmin(false)
        setAdminRole('')
        setSelectedIssue(null)
        setSignedEvidenceUrl('')
        setShowReport(false)
        setShowSettings(false)
        setShowHelp(false)
        setShowActivity(false)
      }
    })
    return () => { mounted = false; listener.subscription.unsubscribe() }
  }, [client])

  const refreshData = useCallback(async (silent = false) => {
    if (!client || !user) return
    if (silent) setRefreshing(true)
    else setLoadingReports(true)
    setDataError('')
    const reportColumns = 'id,public_code,title,description,category,status,suggested_severity,address_label,created_at,updated_at,reporter_id,visibility,latitude,longitude,evidence_paths'
    const canReviewAllReports = ['admin', 'super_admin'].includes(adminRole)
    try {
      const reportRequest = canReviewAllReports
        ? client.from('reports').select(reportColumns).order('created_at', { ascending: false }).limit(500)
        : client.from('reports').select(reportColumns).or(`visibility.eq.public,reporter_id.eq.${user.id}`).order('created_at', { ascending: false }).limit(200)
      const [reportResult, totalResult, activeResult, resolvedResult, mineResult, profileResult] = await Promise.all([
        reportRequest,
        client.from('reports').select('id', { count: 'exact', head: true }).eq('visibility', 'public'),
        client.from('reports').select('id', { count: 'exact', head: true }).eq('visibility', 'public').in('status', ['submitted', 'under_review', 'verified', 'in_progress']),
        client.from('reports').select('id', { count: 'exact', head: true }).eq('visibility', 'public').eq('status', 'resolved'),
        client.from('reports').select('id', { count: 'exact', head: true }).eq('reporter_id', user.id),
        client.from('profiles').select('display_name,avatar_url,impact_points,preferred_language,phone,city,ward,account_type,preferred_service').eq('id', user.id).maybeSingle(),
      ])
      if (reportResult.error) throw reportResult.error
      let nextIssues = (reportResult.data ?? []).map(mapIssue)
      if (nextIssues.length > 0) {
        const voteResult = await client.from('report_votes').select('report_id,user_id').in('report_id', nextIssues.map(i => i.id))
        if (!voteResult.error && voteResult.data) {
          const countByReport = new Map<string, number>()
          const supported = new Set<string>()
          for (const vote of voteResult.data as { report_id: string; user_id: string }[]) {
            countByReport.set(vote.report_id, (countByReport.get(vote.report_id) ?? 0) + 1)
            if (vote.user_id === user.id) supported.add(vote.report_id)
          }
          nextIssues = nextIssues.map(issue => ({ ...issue, votes: countByReport.get(issue.id) ?? 0, supportedByMe: supported.has(issue.id) }))
        }
      }
      setIssues(nextIssues)
      setStats({
        total: totalResult.error ? null : (totalResult.count ?? 0),
        active: activeResult.error ? null : (activeResult.count ?? 0),
        resolved: resolvedResult.error ? null : (resolvedResult.count ?? 0),
        mine: mineResult.error ? null : (mineResult.count ?? 0),
      })
      if (!profileResult.error && profileResult.data) {
        const p = profileResult.data as Profile
        setProfile(p)
        setAuthFullName(current => current || String(p.display_name || ''))
        setProfilePhone(current => current || String(p.phone || ''))
        setProfileCity(current => current || String(p.city || ''))
        setProfileWard(current => current || String(p.ward || ''))
        if (p.account_type) setAccountType(p.account_type)
        if (p.preferred_service) setPreferredService(p.preferred_service)
        if (p.preferred_language === 'hi' || p.preferred_language === 'en') {
          const nextLanguage = p.preferred_language === 'hi' ? 'HI' : 'EN'
          setLanguage(nextLanguage)
          try { localStorage.setItem('janwatch.language', nextLanguage) } catch { /* optional preference */ }
        }
      } else {
        setProfile(null)
      }
      setDataLoaded(true)
      if (!mapFocusRef.current) {
        const firstLocated = nextIssues.find(i => i.latitude != null && i.longitude != null)
        if (firstLocated) {
          const firstFocus = { lat: firstLocated.latitude!, lon: firstLocated.longitude!, label: firstLocated.code }
          mapFocusRef.current = firstFocus
          setMapFocus(firstFocus)
        }
      }
    } catch (error) {
      const message = 'Reports could not be loaded. Please check your connection and try again.'
      setDataError(message)
      setDataLoaded(false)
      if (!silent) notify(message)
    } finally {
      setLoadingReports(false)
      setRefreshing(false)
    }
  }, [client, user, notify, adminRole])

  useEffect(() => {
    if (!user || !client) { setAdminRole(''); setAdmin(false); return }
    let current = true
    const refreshRole = async () => {
      const role = await resolveAssignedRole(user.id)
      if (!current) return
      setAdminRole(role)
      if (!role) setAdmin(false)
    }
    void refreshRole()
    // Roles are often assigned from the Supabase dashboard while a session is open.
    // Refresh when the user returns to the tab rather than requiring a sign-out first.
    const onFocus = () => { void refreshRole() }
    window.addEventListener('focus', onFocus)
    return () => { current = false; window.removeEventListener('focus', onFocus) }
  }, [client, user?.id, resolveAssignedRole])

  useEffect(() => {
    if (!user || !client) return
    void refreshData(false)
  }, [user?.id, client, refreshData, user])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchRef.current?.focus()
      }
      if (event.key === 'Escape') {
        setShowReport(false); setShowSettings(false); setShowHelp(false); setShowActivity(false); setSelectedIssue(null); setMobileNav(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!showActivity) return
    const onPointerDown = (event: PointerEvent) => {
      if (notificationWrapRef.current && !notificationWrapRef.current.contains(event.target as Node)) setShowActivity(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [showActivity])

  function openAuth(mode: AuthMode) {
    setAuthMode(mode)
    setAuthMessage('')
    setAuthError('')
    setEntryScreen('auth')
  }
  async function chooseAuth(mode: AuthMode) {
    // The public welcome page intentionally only offers Sign in / Register. If a
    // previous account is already active, clear it first so the choice is real.
    if (client && user) {
      const { error } = await client.auth.signOut()
      if (error) { notify('Could not open sign-in. Please try again.'); return }
    }
    openAuth(mode)
  }

  function openNewReport() {
    if (!featureFlags.reporting) { notify('New report submissions are temporarily disabled by the administrator.'); return }
    setShowReport(true)
    setMobileNav(false)
  }

  async function submitEmailAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!client) {
      setAuthError('Account services are temporarily unavailable. Please try again later.')
      return
    }
    const email = authEmail.trim().toLowerCase()
    if (authMode === 'reset') {
      if (authPassword.length < 8) { setAuthError('Use a new password with at least 8 characters.'); return }
      if (authPassword !== authConfirmPassword) { setAuthError('Passwords do not match.'); return }
      setAuthBusy(true); setAuthError(''); setAuthMessage('')
      try {
        const { error } = await client.auth.updateUser({ password: authPassword })
        if (error) throw error
        setAuthPassword(''); setAuthConfirmPassword('')
        setAuthMessage('Password updated successfully. Your account is ready.')
        notify('Password updated successfully.')
        setAuthMode('login')
        setEntryScreen('workspace')
      } catch (error) { setAuthError(friendlyAuthError(error)) }
      finally { setAuthBusy(false) }
      return
    }
    if (!email || !authPassword) { setAuthError('Enter your email and password.'); return }
    if (authMode === 'register') {
      if (authFullName.trim().length < 2) { setAuthError('Enter your full name.'); return }
      if (authPassword.length < 8) { setAuthError('Use a password with at least 8 characters.'); return }
      if (authPassword !== authConfirmPassword) { setAuthError('Passwords do not match.'); return }
    }
    setAuthBusy(true)
    setAuthError('')
    setAuthMessage('')
    try {
      sessionStorage.setItem('janwatch.authFlow', authMode)
      if (authMode === 'register') {
        const { data, error } = await client.auth.signUp({
          email,
          password: authPassword,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
            data: { full_name: authFullName.trim(), janwatch_onboarding_complete: false, referral_code: getCapturedReferralCode() || undefined },
          },
        })
        if (error) throw error
        if (data.session && data.user) {
          setOnboardingMode('setup')
          setEntryScreen('onboarding')
          setAuthMessage('Account created. Complete your citizen profile to continue.')
        } else if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          setAuthMode('login')
          setAuthMessage('An account with this email may already exist. Sign in or use Forgot password. If you cannot verify it, try signing in or resetting your password.')
          try { sessionStorage.removeItem('janwatch.authFlow') } catch { /* optional */ }
        } else {
          setAuthMessage('Your account request was received. Check your inbox for a confirmation link before signing in. If no email arrives, check your spam folder or try again later.')
          setAuthMode('login')
          try { sessionStorage.removeItem('janwatch.authFlow') } catch { /* optional */ }
        }
      } else {
        const { error } = await client.auth.signInWithPassword({ email, password: authPassword })
        if (error) throw error
        // Auth listener determines whether this account needs first-time profile setup.
      }
    } catch (error) {
      setAuthError(friendlyAuthError(error))
      try { sessionStorage.removeItem('janwatch.authFlow') } catch { /* optional */ }
    } finally {
      setAuthBusy(false)
    }
  }

  async function resetPassword() {
    if (!client) { setAuthError('Account services are temporarily unavailable. Please try again later.'); return }
    const email = authEmail.trim().toLowerCase()
    if (!email) { setAuthError('Enter your email address first, then select Forgot password.'); return }
    setAuthBusy(true); setAuthError(''); setAuthMessage('')
    try {
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/` })
      if (error) throw error
      setAuthMessage('If an account uses this email, a password reset link has been sent.')
    } catch (error) { setAuthError(friendlyAuthError(error)) }
    finally { setAuthBusy(false) }
  }

  async function resendConfirmation() {
    if (!client) { setAuthError('Account services are temporarily unavailable. Please try again later.'); return }
    const email = authEmail.trim().toLowerCase()
    if (!email) { setAuthError('Enter your registered email address first.'); return }
    setAuthBusy(true); setAuthError(''); setAuthMessage('')
    try {
      const { error } = await client.auth.resend({ type: 'signup', email, options: { emailRedirectTo: `${window.location.origin}/` } })
      if (error) throw error
      setAuthMessage('If your account needs confirmation, a new email may arrive shortly. Check your inbox and spam folder.')
    } catch (error) { setAuthError(friendlyAuthError(error)) }
    finally { setAuthBusy(false) }
  }

  async function saveOnboarding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!client || !user) { setAuthError('Please sign in again to save your profile.'); setEntryScreen('auth'); return }
    const meta = user.user_metadata ?? {}
    const nameValue = (authFullName || String(meta.full_name || meta.name || '')).trim()
    const cityValue = (profileCity || String(meta.city || '')).trim()
    const wardValue = (profileWard || String(meta.ward || '')).trim()
    const phoneValue = (profilePhone || String(meta.phone || '')).trim()
    const typeValue = accountType || (meta.account_type as AccountType) || 'citizen'
    const serviceValue = preferredService || String(meta.preferred_service || CATEGORIES[0])
    if (nameValue.length < 2) { setAuthError('Enter your full name.'); return }
    if (cityValue.length < 2) { setAuthError('Enter your city or town.'); return }
    if (wardValue.length < 1) { setAuthError('Enter your ward or local area.'); return }
    setSavingOnboarding(true); setAuthError('')
    try {
      const details = {
        id: user.id,
        display_name: nameValue,
        phone: phoneValue || null,
        city: cityValue,
        ward: wardValue,
        account_type: typeValue,
        preferred_service: serviceValue,
      }
      const { data, error } = await client.from('profiles').upsert(details, { onConflict: 'id' }).select('id,display_name,avatar_url,impact_points,preferred_language,phone,city,ward,account_type,preferred_service').single()
      if (error) throw error
      const { data: updatedAuth, error: metadataError } = await client.auth.updateUser({ data: {
        full_name: nameValue, city: cityValue, ward: wardValue, phone: phoneValue,
        account_type: typeValue, preferred_service: serviceValue, janwatch_onboarding_complete: true,
        referral_code: getCapturedReferralCode(String(meta.referral_code || '')) || undefined,
      } })
      if (metadataError) throw metadataError
      const capturedReferral = getCapturedReferralCode(String(meta.referral_code || ''))
      if (capturedReferral) {
        try { await client.rpc('janwatch_capture_referral', { p_referral_code: capturedReferral }) } catch { /* referral attribution is optional and must not block profile setup */ }
      }
      try { sessionStorage.removeItem('janwatch.pendingReferralCode') } catch { /* optional session storage */ }
      try { await client.rpc('janwatch_qualify_my_referral') } catch { /* qualification is retried in the referral workspace */ }
      setProfile(data as Profile)
      setAuthFullName(nameValue); setProfileCity(cityValue); setProfileWard(wardValue); setProfilePhone(phoneValue)
      setAccountType(typeValue); setPreferredService(serviceValue)
      if (updatedAuth.user) setUser(updatedAuth.user)
      try { sessionStorage.removeItem('janwatch.authFlow') } catch { /* optional */ }
      setEntryScreen('workspace')
      notify(onboardingMode === 'edit' ? 'Your profile has been updated.' : 'Your LokPravaah profile has been saved.')
      setOnboardingMode('edit')
      await refreshData(true)
    } catch (error) {
      setAuthError('We could not save your profile. Please check your details and try again.')
    } finally { setSavingOnboarding(false) }
  }

  async function signInWithGoogle() {
    if (!client) {
      setAuthError('Account services are temporarily unavailable. Please try again later.')
      return
    }
    setAuthBusy(true); setAuthError(''); setAuthMessage('')
    try {
      sessionStorage.setItem('janwatch.authFlow', authMode)
      const referralCode = getCapturedReferralCode()
      const redirectTo = referralCode ? `${window.location.origin}/?ref=${encodeURIComponent(referralCode)}` : `${window.location.origin}/`
      const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })
      if (error) { setAuthError(friendlyAuthError(error)); setAuthBusy(false); try { sessionStorage.removeItem('janwatch.authFlow') } catch { /* optional */ } }
    } catch (error) { setAuthError(friendlyAuthError(error)); setAuthBusy(false); try { sessionStorage.removeItem('janwatch.authFlow') } catch { /* optional */ } }
  }


  async function signOut() {
    if (!client) return
    setAuthBusy(true)
    try {
      const { error } = await client.auth.signOut()
      setAuthBusy(false)
      if (error) notify('Could not sign out. Please try again.')
      else { setAdmin(false); setShowSettings(false); setSelectedIssue(null) }
    } catch { setAuthBusy(false); notify('Could not sign out. Please try again.') }
  }

  async function toggleLanguage() {
    const next: Language = language === 'EN' ? 'HI' : 'EN'
    setLanguage(next)
    try { localStorage.setItem('janwatch.language', next) } catch { /* preference is optional */ }
    if (client && user) {
      try {
        const { error } = await client.from('profiles').update({ preferred_language: next === 'HI' ? 'hi' : 'en' }).eq('id', user.id)
        if (error) notify('Language changed for this session, but could not be saved to your profile.')
      } catch { notify('Language changed for this session, but could not be saved to your profile.') }
    }
  }

  async function useCurrentLocation() {
    if (!navigator.geolocation) { notify('This browser does not support location access.'); return }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(position => {
      const latitude = Number(position.coords.latitude.toFixed(6))
      const longitude = Number(position.coords.longitude.toFixed(6))
      setReportCoordinates({ latitude, longitude })
      setMapFocus({ lat: latitude, lon: longitude, label: 'Your current location' })
      setMapAddressQuery('')
      if (!reportArea.trim()) setReportArea(`${latitude.toFixed(4)}, ${longitude.toFixed(4)}`)
      setLocating(false)
      notify('Location captured. Check the address before submitting.')
    }, error => {
      setLocating(false)
      const reason = error.code === error.PERMISSION_DENIED ? 'Location permission was denied.' : error.code === error.TIMEOUT ? 'Location request timed out.' : 'Could not determine your location.'
      notify(reason)
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 })
  }

  async function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!client || !user) { notify('Sign in is required to submit a report.'); return }
    if (reportTitle.trim().length < 6) { notify('Report title must contain at least 6 characters.'); return }
    if (reportArea.trim().length < 3) { notify('Enter an area, street, or landmark.'); return }
    if (evidenceFile) {
      const allowed = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm']
      if (!allowed.includes(evidenceFile.type)) { notify('Evidence must be JPG, PNG, WEBP, MP4, or WEBM.'); return }
      if (evidenceFile.size > 50 * 1024 * 1024) { notify('Evidence file must be 50 MB or smaller.'); return }
    }
    setSavingReport(true)
    let evidencePath: string | null = null
    try {
      // Lightweight rule-based duplicate screening: it finds candidates, never blocks by itself.
      const { data: recentCandidates, error: duplicateCheckError } = await client.from('reports')
        .select('public_code,title,category,status,suggested_severity,address_label,created_at')
        .eq('visibility', 'public').eq('category', reportCategory)
        .order('created_at', { ascending: false }).limit(80)
      if (duplicateCheckError) {
        notify('Duplicate screening could not be completed; the report can still be submitted.')
      } else {
        const titleWords = new Set(normalizeTerms(reportTitle))
        const areaWords = new Set(normalizeTerms(reportArea))
        const candidates = (recentCandidates ?? []).map((row: any) => {
          const rowTitle = new Set(normalizeTerms(String(row.title ?? '')))
          const rowArea = new Set(normalizeTerms(String(row.address_label ?? '')))
          const titleOverlap = overlapRatio(titleWords, rowTitle)
          const areaOverlap = overlapRatio(areaWords, rowArea)
          return { row, titleOverlap, areaOverlap, score: titleOverlap * 0.68 + areaOverlap * 0.32 }
        }).filter((candidate: any) => candidate.titleOverlap >= 0.48 && candidate.areaOverlap >= 0.25)
          .sort((a: any, b: any) => b.score - a.score).slice(0, 3)
        if (candidates.length) {
          const summary = candidates.map((c: any) => `• ${c.row.public_code || 'Existing report'} — ${c.row.title} (${c.row.address_label || 'location not recorded'})`).join('\n')
          const proceed = window.confirm(`These existing reports may describe the same issue:\n\n${summary}\n\nReview the community report list first, or choose OK to submit this as a separate report.`)
          if (!proceed) { setSavingReport(false); return }
        }
      }
      if (evidenceFile) {
        const safeName = evidenceFile.name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-90)
        evidencePath = `${user.id}/${crypto.randomUUID()}-${safeName}`
        const { error: uploadError } = await client.storage.from('citizen-evidence').upload(evidencePath, evidenceFile, { contentType: evidenceFile.type, upsert: false })
        if (uploadError) throw new Error('evidence-upload-unavailable')
      }
      const payload = {
        reporter_id: user.id, title: reportTitle.trim(), description: reportDetails.trim(), category: reportCategory,
        suggested_severity: assessSeverity(reportCategory, reportTitle, reportDetails),
        address_label: reportArea.trim(), visibility: 'public', latitude: reportCoordinates?.latitude ?? null,
        longitude: reportCoordinates?.longitude ?? null, evidence_paths: evidencePath ? [evidencePath] : [],
      }
      const { data, error } = await client.from('reports').insert(payload)
        .select('id,public_code,title,description,category,status,suggested_severity,address_label,created_at,updated_at,reporter_id,visibility,latitude,longitude,evidence_paths').single()
      if (error) {
        if (evidencePath) await client.storage.from('citizen-evidence').remove([evidencePath]).catch(() => undefined)
        throw error
      }
      setShowReport(false); setReportTitle(''); setReportDetails(''); setReportArea(''); setReportCoordinates(null); setEvidenceFile(null); setReportCategory(CATEGORIES[0])
      setActive('My reports'); setFilter('All reports')
      await refreshData(true)
      notify(`Report submitted successfully. Reference: ${data.public_code}`)
    } catch (error) {
      notify('Your report could not be submitted. Please check the details and try again.')
    } finally {
      setSavingReport(false)
    }
  }

  async function supportIssue(issue: Issue) {
    if (!featureFlags.community_support) { notify('Community support votes are temporarily disabled by the administrator.'); return }
    if (!client || !user) { notify('Sign in to support a report.'); return }
    if (issue.visibility !== 'public') { notify('Private reports cannot receive community votes.'); return }
    if (issue.supportedByMe) { notify('You have already supported this report.'); return }
    const { error } = await client.from('report_votes').insert({ report_id: issue.id, user_id: user.id })
    if (error) {
      notify(error.code === '23505' ? 'You have already supported this report.' : 'Your support could not be saved. Please try again.')
      return
    }
    setIssues(prev => prev.map(item => item.id === issue.id ? { ...item, votes: item.votes == null ? null : item.votes + 1, supportedByMe: true } : item))
    setSelectedIssue(current => current?.id === issue.id ? { ...current, votes: current.votes == null ? null : current.votes + 1, supportedByMe: true } : current)
    notify('Your support was saved.')
  }

  async function refreshMyRole() {
    if (!client || !user) { notify('Sign in first to refresh your platform role.'); return }
    const role = await resolveAssignedRole(user.id)
    setAdminRole(role)
    if (role) {
      const label = role === 'super_admin' ? 'Super admin' : role === 'admin' ? 'Admin' : 'Moderator'
      notify(`Your platform role is up to date: ${label}.`)
    } else {
      notify('We could not verify a platform role for this signed-in account. Confirm the account ID and database permissions, then try again.')
    }
  }

  async function openAdmin() {
    if (!client || !user) { notify('Sign in first.'); return }
    try {
      // Always re-check at click time. Both the admin navigation and this action use
      // the same resolver so an empty RPC response cannot silently hide valid access.
      const role = await resolveAssignedRole(user.id)
      if (!role) {
        notify('Admin access could not be confirmed for this account. Refresh the page and verify that your signed-in account has the correct assigned role.')
        return
      }
      setAdminRole(role); setAdmin(true); setShowSettings(false); setActive('Overview'); setMobileNav(false)
    } catch {
      notify('Admin access could not be verified. Check your connection and try again.')
    }
  }

  function exportMyData() {
    if (!user) { notify('Sign in to export your data.'); return }
    const reportRows = issues.filter(issue => issue.reporterId === user.id).map(issue => ({
      reference: issue.code, title: issue.title, description: issue.description, category: issue.category,
      status: issue.status, suggestedSeverity: issue.suggestedSeverity, location: issue.area, createdAt: issue.createdAt, updatedAt: issue.updatedAt,
      latitude: issue.latitude, longitude: issue.longitude, evidencePaths: issue.evidencePaths,
    }))
    const payload = {
      exportedAt: new Date().toISOString(),
      account: { email: user.email, emailVerified: Boolean(user.email_confirmed_at) },
      profile: { name: userName, phone: profile?.phone ?? null, city: profile?.city ?? null, ward: profile?.ward ?? null, accountType: profile?.account_type ?? 'citizen', preferredService: profile?.preferred_service ?? null },
      reports: reportRows,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' })
    const objectUrl = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = `lokpravaah-data-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(anchor); anchor.click(); anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
    notify(`Export prepared with ${reportRows.length} of your currently loaded report records.`)
  }

  async function updateReportStatus(issue: Issue, status: DbStatus) {
    if (!client || !user || !['admin', 'super_admin'].includes(adminRole)) { notify('Administrator access is required.'); return }
    if (issue.status === status) return
    setAdminUpdatingId(issue.id)
    const { error } = await client.from('reports').update({ status, updated_at: new Date().toISOString() }).eq('id', issue.id)
    setAdminUpdatingId('')
    if (error) { notify('The report status could not be updated. Please try again.'); return }
    setIssues(prev => prev.map(item => item.id === issue.id ? { ...item, status, updatedAt: new Date().toISOString() } : item))
    setSelectedIssue(current => current?.id === issue.id ? { ...current, status, updatedAt: new Date().toISOString() } : current)
    notify(`${issue.code} status updated to ${statusLabel(status)}.`)
    await refreshData(true)
  }

  async function openIssue(issue: Issue) {
    setSelectedIssue(issue); setSignedEvidenceUrl(''); setIssueEvents([])
    if (!client || !user) return
    const fullReportColumns = 'id,public_code,title,description,category,status,suggested_severity,address_label,created_at,updated_at,reporter_id,visibility,latitude,longitude,evidence_paths'
    const canReviewPrivateDetails = ['admin', 'super_admin'].includes(adminRole)
    const [reportResult, eventsResult, reporterResult] = await Promise.all([
      client.from('reports').select(fullReportColumns).eq('id', issue.id).maybeSingle(),
      client.from('report_events').select('event_type,note,created_at').eq('report_id', issue.id).order('created_at', { ascending: false }).limit(50),
      canReviewPrivateDetails
        ? client.from('profiles').select('display_name,city,ward').eq('id', issue.reporterId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ])
    if (reportResult.error) notify('Full report details could not be refreshed. Check administrator access and retry.')
    if (eventsResult.error) notify('Report status history could not be loaded. Retry opening the report shortly.')
    else if (eventsResult.data) setIssueEvents(eventsResult.data as ReportEvent[])
    let currentIssue = reportResult.data ? mapIssue(reportResult.data) : issue
    if (canReviewPrivateDetails && reporterResult.data) {
      currentIssue = { ...currentIssue, reporterName: String(reporterResult.data.display_name || ''), reporterCity: String(reporterResult.data.city || ''), reporterWard: String(reporterResult.data.ward || '') }
    }
    setSelectedIssue(currentIssue)
    if (currentIssue.reporterId !== user.id && !canReviewPrivateDetails) return
    if (!currentIssue.evidencePaths.length) return
    try {
      const { data, error } = await client.storage.from('citizen-evidence').createSignedUrl(currentIssue.evidencePaths[0], 300)
      if (!error && data?.signedUrl) setSignedEvidenceUrl(data.signedUrl)
      else if (error) notify('The evidence could not be opened. Please try again.')
    } catch { notify('The evidence could not be opened. Please try again.') }
  }

  function focusIssueOnMap(issue: Issue) {
    setActive('Explore map'); setAdmin(false)
    if (issue.latitude != null && issue.longitude != null) { setMapFocus({ lat: issue.latitude, lon: issue.longitude, label: issue.code }); setMapAddressQuery('') }
    else { setMapFocus(null); setMapAddressQuery(issue.area) }
    setSelectedIssue(null); setMobileNav(false)
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return issues.filter(issue => {
      if (active === 'My reports' && issue.reporterId !== user?.id) return false
      if (active === 'Community' && issue.visibility !== 'public') return false
      if (active === 'Explore map' && issue.visibility !== 'public' && issue.reporterId !== user?.id) return false
      const matchesQuery = !q || [issue.code, issue.title, issue.description, issue.area, issue.category].some(value => value.toLowerCase().includes(q))
      const matchesStatus = filter === 'All reports' || statusLabel(issue.status) === filter
      return matchesQuery && matchesStatus
    })
  }, [issues, query, filter, active, user?.id])

  if (authLoading) return <AuthLoading dark={dark} />
  if (entryScreen === 'welcome') return <WelcomeScreen dark={dark} setDark={setDark} language={language} setLanguage={setLanguage} announcements={siteAnnouncements} onSignIn={() => void chooseAuth('login')} onRegister={() => void chooseAuth('register')} />
  if (entryScreen === 'auth') return <AuthScreen dark={dark} setDark={setDark} language={language} setLanguage={setLanguage} isConfigured={isSupabaseConfigured} busy={authBusy} error={authError} message={authMessage} mode={authMode} setMode={mode => { setAuthMode(mode); setAuthError(''); setAuthMessage('') }} email={authEmail} setEmail={setAuthEmail} password={authPassword} setPassword={setAuthPassword} fullName={authFullName} setFullName={setAuthFullName} confirmPassword={authConfirmPassword} setConfirmPassword={setAuthConfirmPassword} onSubmit={submitEmailAuth} onGoogle={() => void signInWithGoogle()} onForgotPassword={() => void resetPassword()} onResend={() => void resendConfirmation()} onBack={() => { setEntryScreen('welcome'); setAuthError(''); setAuthMessage('') }} />
  if (entryScreen === 'onboarding') {
    if (!user) return <WelcomeScreen dark={dark} setDark={setDark} language={language} setLanguage={setLanguage} announcements={siteAnnouncements} onSignIn={() => void chooseAuth('login')} onRegister={() => void chooseAuth('register')} />
    return <OnboardingScreen mode={onboardingMode} dark={dark} userEmail={user.email ?? ''} fullName={authFullName || String(user.user_metadata?.full_name || user.user_metadata?.name || '')} setFullName={setAuthFullName} phone={profilePhone || String(user.user_metadata?.phone || '')} setPhone={setProfilePhone} city={profileCity || String(user.user_metadata?.city || '')} setCity={setProfileCity} ward={profileWard || String(user.user_metadata?.ward || '')} setWard={setProfileWard} accountType={accountType} setAccountType={setAccountType} preferredService={preferredService} setPreferredService={setPreferredService} saving={savingOnboarding} error={authError} onSubmit={saveOnboarding} onBack={() => setEntryScreen(onboardingMode === 'edit' ? 'workspace' : 'welcome')} />
  }
  if (entryScreen !== 'workspace') return <WelcomeScreen dark={dark} setDark={setDark} language={language} setLanguage={setLanguage} announcements={siteAnnouncements} onSignIn={() => void chooseAuth('login')} onRegister={() => void chooseAuth('register')} />
  if (!user) return <WelcomeScreen dark={dark} setDark={setDark} language={language} setLanguage={setLanguage} announcements={siteAnnouncements} onSignIn={() => void chooseAuth('login')} onRegister={() => void chooseAuth('register')} />

  const viewTitles: Record<ViewName, string> = { Overview: isHi ? 'अवलोकन' : 'Overview', 'Explore map': isHi ? 'नक्शा देखें' : 'Explore map', 'My reports': isHi ? 'मेरी रिपोर्ट' : 'My reports', Community: isHi ? 'सामुदायिक रिपोर्ट' : 'Community reports', 'Public chat': isHi ? 'सार्वजनिक चैट' : 'Public chat', Rewards: isHi ? 'रिवॉर्ड्स' : 'Rewards', 'Civic toolkit': isHi ? 'नागरिक सहायता टूलकिट' : 'Civic toolkit', 'LokPravaah AI': isHi ? 'लोकप्रवाह AI' : 'LokPravaah AI', 'Worker Hub': isHi ? 'वर्कर हब' : 'Worker Hub', 'Refer & Earn': isHi ? 'रेफर करें' : 'Refer & Earn', Donate: isHi ? 'दान करें' : 'Donate', 'My profile': isHi ? 'मेरी प्रोफ़ाइल' : 'My profile' }
  const viewTitle = viewTitles[active]

  return (
    <div className={`app-shell ${dark === 'dark' ? 'theme-dark' : 'theme-light'}`}>
      <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''} ${sidebarCollapsed && !mobileNav ? 'sidebar-collapsed' : ''}`} aria-label="Main navigation">
        <div className="sidebar-brand-row"><Brand /><button className="icon-btn sidebar-close" onClick={() => setMobileNav(false)} aria-label="Close navigation" title="Close navigation"><X size={19}/></button></div>
        <div className="workspace-switch" aria-label="Current workspace"><div className="workspace-icon"><Globe2 size={17}/></div><div className="workspace-copy"><b>{isHi ? 'लोकप्रवाह समुदाय' : 'LokPravaah Community'}</b><small>{isHi ? 'नागरिक पोर्टल' : 'Citizen portal'}</small></div></div>
        <div className="nav-label">{isHi ? 'कार्यक्षेत्र' : 'WORKSPACE'}</div>
        <nav className="main-nav">
          {VIEW_ITEMS.filter(({ label }) => label === 'Public chat' ? featureFlags.public_chat : label === 'Rewards' ? featureFlags.rewards : label === 'Civic toolkit' ? featureFlags.civic_toolkit : label === 'LokPravaah AI' ? featureFlags.janwatch_ai : true).map(({ label, icon: Icon }) => <button key={label} className={`nav-link ${active === label && !admin ? 'active' : ''}`} title={sidebarCollapsed ? label : undefined} aria-label={label} onClick={() => { setActive(label); setMobileNav(false); setAdmin(false) }}><Icon size={18}/><span>{isHi ? translateView(label) : label}</span>{label === 'My reports' && <span className="nav-count">{stats.mine == null ? '—' : stats.mine}</span>}</button>)}
        </nav>
        <div className="nav-label section-gap">{isHi ? 'आपका योगदान' : 'YOUR CONTRIBUTION'}</div>
        <div className="impact-card contribution-card">
          <div className="impact-top"><div className="impact-icon"><FileText size={18}/></div><span className="level-pill">REAL ACTIVITY</span></div>
          <div className="impact-number">{displayCount(stats.mine)}</div>
          <div className="impact-label">{isHi ? 'आपके द्वारा जमा रिपोर्ट' : 'Reports submitted by you'}</div>
          <div className="contribution-foot"><span>{stats.mine === null ? 'Count unavailable until data loads' : stats.mine === 1 ? 'One recorded contribution' : `${stats.mine} recorded contributions`}</span></div>
        </div>
        <div className="sidebar-bottom">
          {hasConsoleAccess && <button className={`nav-link admin-sidebar-link ${admin ? 'active' : ''}`} onClick={() => void openAdmin()}><ShieldCheck size={18}/><span>{adminRole === 'moderator' ? 'Moderation console' : 'Admin console'}</span></button>}
          <button className={`nav-link ${active === 'My profile' ? 'active' : ''}`} onClick={() => { setActive('My profile'); setAdmin(false); setMobileNav(false) }}><UserRound size={18}/><span>{isHi ? 'मेरी प्रोफ़ाइल' : 'My profile'}</span></button>
          <button className="nav-link" onClick={() => { setShowHelp(true); setMobileNav(false) }}><CircleHelp size={18}/><span>{isHi ? 'मदद केंद्र' : 'Help centre'}</span></button>
          <button className="nav-link" onClick={() => { setActive('My profile'); setAdmin(false); setShowSettings(false); setMobileNav(false) }}><Settings size={18}/><span>{isHi ? 'सेटिंग्स' : 'Settings'}</span></button>
          <div className="profile-row">
            {avatarUrl ? <img className="avatar profile-avatar-img" src={avatarUrl} alt="" /> : <div className="avatar">{userName.slice(0, 1).toUpperCase()}</div>}
            <div className="profile-copy"><b>{userName}</b><small>{user.email || 'Signed-in citizen'}</small></div>
            <button className="icon-btn" aria-label="Sign out" title="Sign out" onClick={() => void signOut()}><LogOut size={17}/></button>
          </div>
        </div>
      </aside>
      {mobileNav && <button className="mobile-scrim" onClick={() => setMobileNav(false)} aria-label="Close navigation"/>}
      <main className="main-content">
        <header className="topbar">
          <div className="topbar-left"><button className="icon-btn desktop-collapse-btn" onClick={() => setSidebarCollapsed(v => { const next = !v; try { localStorage.setItem('janwatch.sidebarCollapsed', String(next)) } catch { /* optional preference */ } return next })} aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}>{sidebarCollapsed ? <PanelLeftOpen size={18}/> : <PanelLeftClose size={18}/>}</button><button className="icon-btn menu-btn" onClick={() => setMobileNav(true)} aria-label="Open menu"><Menu size={20}/></button><div className="breadcrumb"><span>LokPravaah</span><span className="crumb-slash">/</span><b>{admin ? (adminRole === 'moderator' ? 'Moderation' : adminRole === 'admin' ? 'Admin' : 'Super Admin') : viewTitle}</b></div></div>
          <div className="topbar-actions">
            <div className="system-status"><span className={`live-dot ${!isLive ? 'dot-muted' : ''}`}/>{loadingReports ? 'Loading data' : isLive ? 'Live updates' : dataError ? 'Currently unavailable' : 'Refreshing'}</div>
            <button className="icon-btn" onClick={() => void toggleLanguage()} aria-label="Switch language" title="Switch language"><Globe2 size={18}/><span className="language-code">{language}</span></button>
            <button className="icon-btn" onClick={() => { const next = dark === 'dark' ? 'light' : 'dark'; setDark(next); try { localStorage.setItem('janwatch.theme', next) } catch { /* optional preference */ } }} aria-label="Toggle theme" title="Toggle theme">{dark === 'dark' ? <Sun size={18}/> : <Moon size={18}/>}</button>
            <div className="notification-wrap" ref={notificationWrapRef}><button className="icon-btn notification-btn" onClick={() => setShowActivity(v => !v)} aria-label="Recent report activity" title="Recent report activity"><Bell size={18}/></button>{showActivity && <div className="notification-pop activity-pop"><div className="activity-pop-top"><b>Recent report activity</b><button className="icon-btn" onClick={() => setShowActivity(false)} aria-label="Close recent report activity"><X size={15}/></button></div>{issues.slice(0, 5).length ? issues.slice(0, 5).map(issue => <button className="activity-row" key={issue.id} onClick={() => { setShowActivity(false); void openIssue(issue) }}><span className="activity-dot"/><span><b>{issue.title}</b><small>{statusLabel(issue.status)} · {relativeDate(issue.updatedAt)}</small></span></button>) : <p>No report activity is available yet.</p>}</div>}</div>
            <button className="top-avatar" onClick={() => { setShowSettings(true); setShowActivity(false); setMobileNav(false) }} title="Open account settings" aria-label="Open account settings">{userName.slice(0, 1).toUpperCase()}</button>
          </div>
        </header>
        <div className="page-wrap">
          {!admin && <SiteAnnouncementStrip announcements={siteAnnouncements} compact />}
          {admin ? <AdminPanel issues={issues} role={adminRole} userId={user.id} updatingId={adminUpdatingId} reportsLoading={loadingReports || refreshing} reportsError={dataError} onRefreshReports={() => void refreshData(false)} onExit={() => setAdmin(false)} onUpdate={(issue, status) => void updateReportStatus(issue, status)} onOpenReport={issue => void openIssue(issue)} onPlatformChanged={() => void loadPlatformSettings()} notify={notify} /> : <>
            {dataError && <div className="data-warning"><CircleAlert size={17}/><div><b>Live data could not be loaded</b><span>{dataError}</span></div><button className="btn btn-secondary" onClick={() => void refreshData(false)}><RefreshCw size={15}/> Retry</button></div>}
            {active === 'Overview' && <>
              <section className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-line"/>{isHi ? 'आपका शहर. आपकी आवाज़.' : 'YOUR CITY. YOUR VOICE.'}</div><h1>{isHi ? 'बेहतर मोहल्ला,' : 'Make your neighbourhood'}<br/><span>{isHi ? 'आपकी पहल से।' : 'better, together.'}</span></h1><p className="welcome-sub">{isHi ? 'समस्या दिखे? रिपोर्ट करें। बदलाव की शुरुआत यहीं से होती है।' : 'Spot a problem? Report it. Real change starts with people who care.'}</p></div><div className="welcome-actions"><button className="btn btn-secondary" onClick={() => setActive('Explore map')}><Compass size={17}/> Explore map</button>{featureFlags.reporting && <button className="btn btn-primary" onClick={openNewReport}><Plus size={18}/> Report an issue <ArrowRight size={16}/></button>}</div></section>
              <section className="hero-banner"><div className="hero-orb orb-one"/><div className="hero-orb orb-two"/><div className="hero-grid"/><div className="hero-content"><div className="hero-kicker"><Sparkles size={14}/> REAL REPORTS. CLEAR PROGRESS.</div><h2>A better city doesn't<br/>happen <em>by accident.</em></h2><p>Report a civic issue, follow its status, and help your neighbourhood speak with one voice.</p>{featureFlags.reporting && <button className="hero-cta" onClick={openNewReport}>Create a report <ArrowUpRight size={17}/></button>}</div><div className="hero-art hero-art-reworked" aria-hidden="true"><div className="orbit orbit-a"/><div className="orbit orbit-b"/><div className="art-core"><Waves size={43}/></div><div className="float-chip chip-a"><span className="chip-icon mint"><FileText size={14}/></span><span><b>Citizen report</b><small>Capture the details</small></span></div><div className="float-chip chip-b"><span className="chip-icon gold"><Activity size={14}/></span><span><b>Track progress</b><small>See status changes</small></span></div><div className="art-spark spark-a">✳</div><div className="art-spark spark-b">✦</div></div><div className="hero-footer"><span><span className="live-dot"/> CITIZEN-POWERED CHANGE</span><span>LokPravaah <i/></span></div></section>
              <section className="stats-grid"><StatCard icon={<FileText size={18}/>} label="Public reports" value={displayCount(stats.total)} hint="All public records" tone="mint"/><StatCard icon={<Activity size={18}/>} label="Active reports" value={displayCount(stats.active)} hint="Not resolved or rejected" tone="blue"/><StatCard icon={<CheckCircle2 size={18}/>} label="Resolved reports" value={displayCount(stats.resolved)} hint="Marked as resolved" tone="purple"/><StatCard icon={<Users size={18}/>} label="Your reports" value={displayCount(stats.mine)} hint="Submitted by your account" tone="gold"/></section>
              <section className="content-grid"><div className="panel reports-panel"><ReportPanelHeading active={active} count={filtered.length} onViewAll={() => setActive('Community')}/><ReportTools query={query} onQuery={setQuery} filter={filter} onFilter={setFilter} inputRef={searchRef}/><ReportList issues={filtered.slice(0, 7)} loading={loadingReports} dataError={dataError} allCount={issues.length} supportEnabled={featureFlags.community_support} onSupport={supportIssue} onOpen={openIssue} onMap={focusIssueOnMap}/><div className="panel-footer"><span>{loadingReports ? 'Loading reports…' : `Showing ${Math.min(filtered.length, 7)} of ${filtered.length} matching reports`}</span><span className="refresh-note"><Activity size={14}/>{isLive ? 'Information refreshed' : 'Connection unavailable'}</span></div></div><div className="right-column"><QuickActions onReport={openNewReport} onMap={() => setActive('Explore map')} onCommunity={() => setActive('Community')} reportingEnabled={featureFlags.reporting}/><ReportingTipsPanel/></div></section>
              <section className="bottom-banner"><div className="bottom-symbol"><Leaf size={21}/></div><div><b>Change starts closer than you think.</b><p>One report. One neighbourhood. A better tomorrow.</p></div>{featureFlags.reporting && <button className="btn btn-secondary" onClick={openNewReport}>Get started <ArrowRight size={16}/></button>}</section>
              <footer className="footer"><div className="footer-brand"><Waves size={16}/> LokPravaah <span>© 2026</span></div><span>Community reporting platform · Not an official government dispatch system.</span>{hasConsoleAccess && <button onClick={() => void openAdmin()} className="admin-entry"><ShieldCheck size={14}/> {adminRole === 'moderator' ? 'Moderation console' : 'Admin console'}</button>}</footer>
            </>}
            {active === 'My reports' && <PageHeader eyebrow="YOUR ACTIVITY" title="Your reports." subtitle="Reports submitted from your account and their current status." onReport={() => openNewReport()}><button className="btn btn-secondary" onClick={() => void refreshData(false)} disabled={refreshing}><RefreshCw size={15}/> Refresh</button></PageHeader>}
            {active === 'Community' && <PageHeader eyebrow="COMMUNITY PULSE" title="Community reports." subtitle="Public reports shared by the community. Support issues that need attention." onReport={() => openNewReport()}><button className="btn btn-secondary" onClick={() => void refreshData(false)} disabled={refreshing}><RefreshCw size={15}/> Refresh</button></PageHeader>}
            {(active === 'My reports' || active === 'Community') && <section className="panel standalone-list"><ReportTools query={query} onQuery={setQuery} filter={filter} onFilter={setFilter} inputRef={searchRef}/><ReportList issues={filtered} loading={loadingReports} dataError={dataError} allCount={issues.length} supportEnabled={featureFlags.community_support} onSupport={supportIssue} onOpen={openIssue} onMap={focusIssueOnMap}/><div className="panel-footer"><span>{loadingReports ? 'Loading reports…' : `${filtered.length} matching reports`}</span><span className="refresh-note"><Activity size={14}/>{isLive ? 'Live updates' : 'Unable to refresh'}</span></div></section>}
            {active === 'My profile' && <ProfilePage name={userName} email={user.email ?? ''} emailVerified={Boolean(user.email_confirmed_at)} profile={profile} accountType={accountType} preferredService={preferredService} stats={stats} platformRole={adminRole} onRefreshRole={() => void refreshMyRole()} onEdit={() => { setAuthFullName(userName); setProfilePhone(String(profile?.phone || user.user_metadata?.phone || '')); setProfileCity(String(profile?.city || user.user_metadata?.city || '')); setProfileWard(String(profile?.ward || user.user_metadata?.ward || '')); setAccountType((profile?.account_type || user.user_metadata?.account_type || 'citizen') as AccountType); setPreferredService(String(profile?.preferred_service || user.user_metadata?.preferred_service || CATEGORIES[0])); setOnboardingMode('edit'); setEntryScreen('onboarding') }} onSettings={() => setShowSettings(true)} onExport={() => exportMyData()} />}
            {active === 'Civic toolkit' && (featureFlags.civic_toolkit ? <CivicToolkit userName={userName} profile={profile} /> : <FeaturePaused title="Civic toolkit paused" body="An administrator has temporarily disabled the civic toolkit." />)}
            {active === 'LokPravaah AI' && (featureFlags.janwatch_ai ? <JanwatchAI /> : <FeaturePaused title="LokPravaah AI paused" body="An administrator has temporarily disabled the AI assistant. You can still use the complaint and RTI drafting tools." />)}
            {active === 'Public chat' && <CommunityChat userId={user.id} displayName={userName} currentRole={adminRole} isAdmin={hasModerationAccess} enabled={featureFlags.public_chat} notify={notify} />}
            {active === 'Rewards' && <RewardsPage userId={user.id} enabled={featureFlags.rewards} notify={notify} />}
            {active === 'Worker Hub' && <WorkerReferralHub userId={user.id} displayName={userName} isAdmin={hasAdminAccess} city={profile?.city} ward={profile?.ward} notify={notify} />}
            {active === 'Refer & Earn' && <ReferralStudio userMetadata={user.user_metadata as Record<string, unknown>} notify={notify} />}
            {active === 'Donate' && <DonationPage userId={user.id} userName={userName} /> }
            {active === 'Explore map' && <><PageHeader eyebrow="LOCATION EXPLORER" title="Explore your area." subtitle="Map pins are available for reports where a real coordinate was captured. No sample locations are shown." onReport={() => openNewReport()}><button className="btn btn-secondary" onClick={() => void useMapLocation()}><LocateFixed size={15}/> Use my location</button></PageHeader><MapPage issues={filtered} focus={mapFocus} addressQuery={mapAddressQuery} onFocus={setMapFocus} onAddressQuery={setMapAddressQuery} onOpen={openIssue} onReport={() => openNewReport()}/></>}
          </>}
        </div>
      </main>
      {showReport && <ReportModal evidenceEnabled={featureFlags.evidence_upload} title={reportTitle} setTitle={setReportTitle} category={reportCategory} setCategory={setReportCategory} details={reportDetails} setDetails={setReportDetails} area={reportArea} setArea={setReportArea} coordinates={reportCoordinates} file={evidenceFile} setFile={setEvidenceFile} saving={savingReport} locating={locating} onLocate={() => void useCurrentLocation()} onClose={() => setShowReport(false)} onSubmit={submitReport}/>}
      {selectedIssue && <IssueDetail issue={selectedIssue} events={issueEvents} isOwner={selectedIssue.reporterId === user.id} isAdmin={['admin', 'super_admin'].includes(adminRole)} evidenceUrl={signedEvidenceUrl} onClose={() => { setSelectedIssue(null); setSignedEvidenceUrl(''); setIssueEvents([]) }} onSupport={() => void supportIssue(selectedIssue)} onMap={() => focusIssueOnMap(selectedIssue)} onDraft={() => downloadComplaintDraft(selectedIssue, userName, profile?.city || '', profile?.ward || '')} onAdminStatus={status => void updateReportStatus(selectedIssue, status)}/>}
      {showSettings && <SettingsModal name={userName} email={user.email ?? ''} isAdmin={hasConsoleAccess} consoleLabel={adminRole === 'moderator' ? 'Open moderation console' : 'Open admin console'} dark={dark} language={language} onTheme={next => { setDark(next); try { localStorage.setItem('janwatch.theme', next) } catch { /* optional */ } }} onLanguage={() => void toggleLanguage()} onAdmin={() => void openAdmin()} onSignOut={() => void signOut()} onClose={() => setShowSettings(false)}/>}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)}/>}
      {toast && <div className="toast"><div className="toast-check"><Check size={15}/></div><span>{toast}</span><button onClick={() => setToast('')} aria-label="Dismiss"><X size={15}/></button></div>}
    </div>
  )

  function useMapLocation() {
    if (!navigator.geolocation) { notify('This browser does not support location access.'); return }
    navigator.geolocation.getCurrentPosition(position => {
      setMapFocus({ lat: position.coords.latitude, lon: position.coords.longitude, label: 'Your current location' })
      setMapAddressQuery('')
      notify('Map focused on your current location. No location was saved to a report.')
    }, error => notify(error.code === error.PERMISSION_DENIED ? 'Location permission was denied.' : 'Could not determine your location.'), { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 })
  }
}

function displayCount(value: number | null): string { return value == null ? '—' : value.toLocaleString() }

function Brand() {
  return <div className="brand"><div className="brand-mark"><Waves size={23} strokeWidth={2.6}/></div><div><div className="brand-name">LokPravaah<span>.</span></div><div className="brand-tag">CIVIC ACTION PLATFORM</div></div></div>
}

function SiteAnnouncementStrip({ announcements, compact = false }: { announcements: SiteAnnouncement[]; compact?: boolean }) {
  const [dismissed, setDismissed] = useState<string[]>([])
  const visible = announcements.filter(alert => !dismissed.includes(alert.id) && (!alert.expires_at || new Date(alert.expires_at).getTime() > Date.now()))
  if (!visible.length) return null
  return <div className={`site-announcements ${compact ? 'site-announcements-compact' : ''}`}>{visible.map(alert => <div className={`site-announcement site-announcement-${alert.severity}`} key={alert.id} role={alert.severity === 'critical' ? 'alert' : 'status'}><BellRing size={17}/><div><b>{alert.title}</b><p>{alert.body}</p>{alert.expires_at && <small>Until {formatDate(alert.expires_at)}</small>}</div><button className="icon-btn" onClick={() => setDismissed(items => [...items, alert.id])} aria-label={`Dismiss ${alert.title}`} title="Dismiss alert"><X size={16}/></button></div>)}</div>
}

function FeaturePaused({ title, body }: { title: string; body: string }) {
  return <section className="panel feature-paused"><CirclePower size={26}/><h2>{title}</h2><p>{body}</p></section>
}

type PublicPost = { id: string; slug: string; title: string; excerpt: string; body: string; post_type: 'blog' | 'app_update' | 'feature_update'; link_url: string | null; published_at: string | null; created_at: string }

function WelcomeScreen({ dark, setDark, language, setLanguage, announcements, onSignIn, onRegister }: { dark: Theme; setDark: (t: Theme) => void; language: Language; setLanguage: (l: Language) => void; announcements: SiteAnnouncement[]; onSignIn: () => void; onRegister: () => void }) {
  type PublicPage = 'home' | 'updates' | 'support' | 'how' | 'donate'
  const resolvePublicPage = (): PublicPage => {
    const key = window.location.hash.replace(/^#/, '')
    return key === 'updates' || key === 'support' || key === 'how' || key === 'donate' ? key : 'home'
  }
  const [publicPage, setPublicPage] = useState<PublicPage>(resolvePublicPage)
  const [posts, setPosts] = useState<PublicPost[]>([])
  const [postsLoading, setPostsLoading] = useState(false)
  const [postsError, setPostsError] = useState('')
  const hi = language === 'HI'

  useEffect(() => {
    if (publicPage !== 'updates') return
    if (!supabase) { setPostsError('Updates are temporarily unavailable. Please try again later.'); return }
    let active = true
    setPostsLoading(true); setPostsError('')
    void (async () => {
      try {
        const { data, error } = await supabase.from('site_posts').select('id,slug,title,excerpt,body,post_type,link_url,published_at,created_at').eq('is_published', true).order('published_at', { ascending: false }).limit(30)
        if (!active) return
        if (error) setPostsError('We could not load the latest posts. Please refresh and try again.')
        else setPosts((data ?? []) as PublicPost[])
      } catch (error) {
        if (active) setPostsError('We could not load the latest posts. Please refresh and try again.')
      } finally { if (active) setPostsLoading(false) }
    })()
    return () => { active = false }
  }, [publicPage])

  useEffect(() => {
    const syncPageFromHistory = () => { setPublicPage(resolvePublicPage()); window.scrollTo({ top: 0, behavior: 'auto' }) }
    window.addEventListener('popstate', syncPageFromHistory)
    window.addEventListener('hashchange', syncPageFromHistory)
    return () => { window.removeEventListener('popstate', syncPageFromHistory); window.removeEventListener('hashchange', syncPageFromHistory) }
  }, [])
  const setPage = (page: PublicPage) => {
    const nextUrl = page === 'home' ? `${window.location.pathname}${window.location.search}` : `${window.location.pathname}${window.location.search}#${page}`
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== nextUrl) window.history.pushState({ publicPage: page }, '', nextUrl)
    setPublicPage(page)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const services = [
    { name: 'Roads & footpaths', icon: AlertTriangle, copy: 'Potholes, broken pavements and unsafe crossings' },
    { name: 'Waste & sanitation', icon: Leaf, copy: 'Overflowing bins, litter and public hygiene' },
    { name: 'Streetlights', icon: Zap, copy: 'Non-working lights and dark public streets' },
    { name: 'Water & drainage', icon: Waves, copy: 'Leaks, waterlogging and blocked drains' },
    { name: 'Public safety', icon: ShieldCheck, copy: 'Hazards that need civic attention' },
    { name: 'Parks & public spaces', icon: Compass, copy: 'Damaged facilities and neglected spaces' },
  ]
  return <div className={`public-site theme-${dark}`}>
    <header className="public-nav"><button className="brand brand-link public-brand-button" type="button" onClick={() => setPage('home')} aria-label="LokPravaah home"><Brand/></button><nav aria-label="Public navigation"><button className={publicPage === 'home' ? 'public-nav-current' : ''} onClick={() => setPage('home')}>Home</button><button className={publicPage === 'how' ? 'public-nav-current' : ''} onClick={() => setPage('how')}>How it works</button><button className={publicPage === 'updates' ? 'public-nav-current' : ''} onClick={() => setPage('updates')}>Blog & updates</button><button className={publicPage === 'donate' ? 'public-nav-current' : ''} onClick={() => setPage('donate')}>Donate</button><button className={publicPage === 'support' ? 'public-nav-current' : ''} onClick={() => setPage('support')}>Support</button></nav><div className="public-actions"><button className="icon-btn" onClick={() => { const next = language === 'EN' ? 'HI' : 'EN'; setLanguage(next); try { localStorage.setItem('janwatch.language', next) } catch { /* optional */ } }} title="Switch language" aria-label="Switch language"><Globe2 size={17}/><span className="language-code">{language}</span></button><button className="icon-btn" onClick={() => { const next = dark === 'dark' ? 'light' : 'dark'; setDark(next); try { localStorage.setItem('janwatch.theme', next) } catch { /* optional */ } }} title="Toggle appearance" aria-label="Toggle appearance">{dark === 'dark' ? <Sun size={17}/> : <Moon size={17}/>}</button><button className="btn btn-secondary" onClick={onSignIn}>Sign in</button><button className="btn btn-primary" onClick={onRegister}>Register <ArrowRight size={16}/></button></div></header>
    <SiteAnnouncementStrip announcements={announcements}/>
    {publicPage === 'updates' ? <main className="public-subpage" id="updates"><div className="public-subpage-hero"><div className="eyebrow"><span className="eyebrow-line"/> LOKPRAVAAH JOURNAL</div><h1>Product updates.<br/><em>Ideas for better cities.</em></h1><p>Read app announcements, new features, guides and notes from the project. Posts published by the site administrator appear here.</p><div className="public-subpage-actions"><button className="btn btn-primary" onClick={onRegister}>Join the community <ArrowRight size={16}/></button><button className="btn btn-secondary" onClick={() => setPage('home')}>Back to home</button></div></div>
      {postsError && <div className="public-posts-status" role="status"><AlertTriangle size={18}/><div><b>Updates are not available yet</b><p>{postsError}</p></div></div>}
      {postsLoading ? <div className="public-post-grid"><div className="public-post-skeleton"/><div className="public-post-skeleton"/><div className="public-post-skeleton"/></div> : posts.length ? <div className="public-post-grid">{posts.map(post => <article className="public-post-card" key={post.id}><div className="public-post-meta"><span>{post.post_type === 'app_update' ? 'APP UPDATE' : post.post_type === 'feature_update' ? 'NEW FEATURE' : 'FROM THE BLOG'}</span><time>{new Date(post.published_at || post.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</time></div><h2>{post.title}</h2><p>{post.excerpt || post.body.slice(0, 210)}</p><details className="public-post-read"><summary>Read article <ArrowRight size={14}/></summary><div>{post.body}</div>{post.link_url && <a href={post.link_url} target="_blank" rel="noopener noreferrer">Open related link <ArrowUpRight size={14}/></a>}</details></article>)}</div> : !postsError && <div className="public-post-empty"><div className="public-post-empty-icon"><FileText size={25}/></div><h2>Something useful is coming here.</h2><p>No posts have been published yet. The super administrator can write a blog, add links, and publish product or feature updates from the Admin Console → Content & blog.</p><button className="btn btn-secondary" onClick={() => setPage('support')}>Need help? Visit support <ArrowRight size={15}/></button></div>}
    </main> : publicPage === 'donate' ? <main className="public-subpage donation-public-subpage"><DonationPage /></main> : publicPage === 'support' ? <main className="public-subpage support-subpage"><div className="public-subpage-hero"><div className="eyebrow"><span className="eyebrow-line"/> HELP & PROJECT INFORMATION</div><h1>Support for your<br/><em>civic-tech journey.</em></h1><p>LokPravaah helps people document local civic concerns. For account or product questions, start with the resources below. It is an independent project, not an official government service.</p><div className="support-cards"><article><span className="support-card-icon"><CircleHelp size={20}/></span><h2>Using LokPravaah</h2><p>Sign in to draft reports, track status, use civic tools, and join constructive community conversations.</p><button className="text-link" onClick={() => setPage('how')}>How it works <ArrowRight size={15}/></button></article><article><span className="support-card-icon"><Sparkles size={20}/></span><h2>AI assistant</h2><p>AI can help organise your wording. Review its suggestions and verify official procedures before taking action.</p><button className="text-link" onClick={onSignIn}>Open your workspace <ArrowRight size={15}/></button></article><article><span className="support-card-icon"><HandHeart size={20}/></span><h2>Support this project</h2><p>Voluntary contributions can help cover platform hosting, moderation and continued development.</p><button className="text-link" onClick={() => setPage('donate')}>Donate any amount <ArrowRight size={15}/></button></article></div></div>
      <section className="support-creator"><div className="support-creator-label"><div className="section-kicker">PROJECT CREATOR</div><h2>Built by Aditya Ratre<span className="profile-title-dot">.</span></h2><p>Student, developer and digital creator building civic-tech tools to make public participation clearer and easier to organise.</p></div><div className="support-creator-card"><div className="creator-avatar">AR</div><div className="support-creator-main"><b>Aditya Ratre</b><span>Founder · Designer · Developer</span><p>Creator of LokPravaah and the NexaGrind technology projects.</p><div className="support-links"><a href="https://work.adityaratre.workers.dev/" target="_blank" rel="noopener noreferrer">Creator website <ArrowUpRight size={14}/></a><a href="https://www.linkedin.com/in/adityaratre/" target="_blank" rel="noopener noreferrer">LinkedIn <ArrowUpRight size={14}/></a><a href="https://github.com/adityaratre/NEXAGRIND.AI" target="_blank" rel="noopener noreferrer">GitHub project <ArrowUpRight size={14}/></a></div></div></div></section><div className="support-disclaimer"><ShieldCheck size={17}/><p><b>Safety note</b><br/>Do not submit emergencies through this website. Do not share passwords, payment credentials, Aadhaar numbers or sensitive personal details in public channels. AI output must be verified.</p></div></main> : publicPage === 'how' ? <main className="public-subpage how-subpage"><div className="public-subpage-hero"><div className="eyebrow"><span className="eyebrow-line"/> HOW IT WORKS</div><h1>From a concern<br/><em>to a clearer record.</em></h1><p>Use LokPravaah to structure local concerns, add evidence you have permission to share, and follow recorded updates.</p></div><div className="public-how-steps"><article><span>01</span><FileText size={24}/><h2>Document the issue</h2><p>Choose a category, write a factual description, and add the location. Photos are optional and may reveal sensitive information.</p></article><article><span>02</span><MapPin size={24}/><h2>Keep track</h2><p>Check your dashboard for the status recorded by authorised reviewers. A status does not guarantee an authority's response.</p></article><article><span>03</span><Users size={24}/><h2>Support responsibly</h2><p>Support relevant public reports, use community chat respectfully, and avoid publishing private people's personal information.</p></article></div><div className="public-subpage-actions"><button className="btn btn-primary" onClick={onRegister}>Create an account <ArrowRight size={16}/></button><button className="btn btn-secondary" onClick={() => setPage('support')}>Contact / project support</button></div></main> : <main id="top"><section className="public-hero"><div className="hero-copy"><div className="eyebrow"><span className="eyebrow-line"/> CIVIC REPORTING · COMMUNITY ACTION</div><h1>Better neighbourhoods<br/><em>start with your voice.</em></h1><p>Report everyday civic issues, add clear location details, and follow each report as its status changes. One place for citizens to document problems and support improvements—with no invented demo activity.</p><div className="hero-actions"><button className="btn btn-primary btn-large" onClick={onRegister}>Register — it’s free <ArrowRight size={17}/></button><button className="btn btn-secondary btn-large" onClick={onSignIn}>I already have an account</button><span><ShieldCheck size={15}/> Secure account access · Real reports, not demo records</span></div><div className="hero-metrics"><div><b>01</b><span>Report a concern</span></div><div><b>02</b><span>Track status updates</span></div><div><b>03</b><span>Support your community</span></div></div></div><div className="hero-visual"><div className="hero-orbit orbit-one"/><div className="hero-orbit orbit-two"/><div className="hero-feature-card"><div className="hero-card-top"><div className="hero-card-mark"><Waves size={20}/></div><span className="hero-live"><i/> CITIZEN PORTAL</span></div><div className="hero-feature-title">Your neighbourhood,<br/>in clearer view.</div><div className="hero-feature-sub">A structured way to report public issues and follow updates.</div><div className="hero-feature-line"><span className="hero-feature-icon"><MapPin size={16}/></span><span><b>Location-aware reports</b><small>Address and optional map coordinates</small></span><CheckCircle2 size={17}/></div><div className="hero-feature-line"><span className="hero-feature-icon"><Activity size={16}/></span><span><b>Status you can track</b><small>Submitted · Under review · Resolved</small></span><CheckCircle2 size={17}/></div><div className="hero-card-foot"><span>LOKPRAVAAH COMMUNITY</span><span>Transparency by design <ShieldCheck size={13}/></span></div></div><div className="hero-floating-chip chip-top"><span><MapPin size={15}/></span><div><b>Report locally</b><small>Details matter</small></div></div><div className="hero-floating-chip chip-bottom"><span><Users size={15}/></span><div><b>Community-led</b><small>Small actions add up</small></div></div></div></section>
      <section className="public-trust-strip"><span><ShieldCheck size={16}/> No demo reports or fabricated counters</span><span><LockKeyhole size={16}/> Private account access</span><span><Activity size={16}/> Status from recorded updates</span></section>
      <section className="public-services" id="services"><div className="public-section-heading"><div><div className="section-kicker">WHAT CAN YOU REPORT?</div><h2>Civic services, all in one place.</h2><p>Choose the category that best describes the issue. You can add its exact location and more details when creating a report.</p></div><button className="text-link" onClick={onRegister}>Report an issue <ArrowRight size={15}/></button></div><div className="service-grid">{services.map(({name,icon:Icon,copy},i)=><button className="service-card" key={name} onClick={onRegister}><span className="service-icon"><Icon size={20}/></span><span className="service-index">0{i+1}</span><b>{name}</b><small>{copy}</small><span className="service-link">Get started <ArrowRight size={14}/></span></button>)}</div></section>
      <section className="how-section" id="how-it-works"><div className="public-section-heading"><div><div className="section-kicker">SIMPLE BY DESIGN</div><h2>From concern to clear record.</h2><p>LokPravaah helps organise community reports. It does not replace emergency services or guarantee municipal action.</p></div><button className="text-link" onClick={() => setPage('how')}>Explore full guide <ArrowRight size={15}/></button></div><div className="steps-grid"><article><span>01</span><FileText size={22}/><h3>Share the details</h3><p>Describe the issue, select a civic category, and add an address or optional GPS coordinates.</p></article><article><span>02</span><Activity size={22}/><h3>Follow the status</h3><p>Check the status stored with your report. Updates appear when an authorised account records them.</p></article><article><span>03</span><Users size={22}/><h3>Build a useful record</h3><p>Support public reports and help your community see the concerns already documented.</p></article></div></section>
      <section className="public-blog-promo"><div><div className="section-kicker">WHAT'S NEW</div><h2>Product notes and community guides.</h2><p>App updates, new feature notes and practical guides will be published by the super administrator.</p></div><button className="btn btn-secondary" onClick={() => setPage('updates')}>Explore Blog & Updates <ArrowRight size={15}/></button></section>
      <section className="public-cta" id="about"><div><div className="section-kicker">YOUR COMMUNITY STARTS HERE</div><h2>Make the issue visible.<br/>Keep the record clear.</h2><p>Create a LokPravaah account to submit reports and track your own activity.</p></div><div className="welcome-cta-actions"><button className="btn btn-primary btn-large" onClick={onRegister}>Register <ArrowRight size={17}/></button><button className="btn btn-secondary btn-large" onClick={onSignIn}>Sign in</button></div></section>
      <section className="creator-section" id="creator"><div className="creator-copy"><div className="section-kicker">MADE WITH PURPOSE</div><h2>Creator of this website<span className="profile-title-dot">.</span></h2><p>LokPravaah is designed and developed as a civic-tech project to help communities organise local concerns, keep records, and make participation easier.</p><div className="creator-card"><div className="creator-avatar">AR</div><div><b>Aditya Ratre</b><span>Founder · Designer · Developer of LokPravaah</span><button className="creator-text-link" type="button" onClick={() => setPage('support')}>Creator details & support <ArrowRight size={14}/></button></div></div><p className="creator-note">The creator website opens separately only when you choose an external link.</p></div><div className="creator-preview"><div className="creator-preview-top"><span className="creator-live-dot"/> CREATOR PORTFOLIO <ExternalLink size={14}/></div><div className="creator-preview-body"><Globe2 size={28}/><h3>Explore the creator’s work</h3><p>Projects, development work and creator profile.</p><button className="btn btn-secondary" onClick={() => setPage('support')}>View creator details <ArrowRight size={15}/></button></div></div></section></main>}
    <footer className="public-footer"><button className="public-footer-brand" onClick={() => setPage('home')}><Brand/></button><span>© 2026 LokPravaah · Civic reporting platform</span><button type="button" onClick={() => setPage('updates')}>Blog & updates</button><button type="button" onClick={() => setPage('donate')}>Donate</button><button type="button" onClick={() => setPage('support')}>Support & creator</button><span>Not for emergencies · Not an official government service</span></footer>
  </div>
}

function AuthScreen({ dark, setDark, language, setLanguage, isConfigured, busy, error, message, mode, setMode, email, setEmail, password, setPassword, fullName, setFullName, confirmPassword, setConfirmPassword, onSubmit, onGoogle, onForgotPassword, onResend, onBack }: { dark: Theme; setDark: (t: Theme) => void; language: Language; setLanguage: (l: Language) => void; isConfigured: boolean; busy: boolean; error: string; message: string; mode: AuthMode; setMode: (m: AuthMode) => void; email: string; setEmail: (v: string) => void; password: string; setPassword: (v: string) => void; fullName: string; setFullName: (v: string) => void; confirmPassword: string; setConfirmPassword: (v: string) => void; onSubmit: (e: FormEvent<HTMLFormElement>) => void; onGoogle: () => void; onForgotPassword: () => void; onResend: () => void; onBack: () => void }) {
  const hi = language === 'HI'
  return <div className={`auth-screen theme-${dark}`}><div className="auth-nav"><button className="back-home" onClick={onBack}><ArrowRight size={15} className="back-arrow"/> Back to welcome</button><Brand/><div className="auth-nav-actions"><button className="icon-btn" onClick={() => { const next = language === 'EN' ? 'HI' : 'EN'; setLanguage(next); try { localStorage.setItem('janwatch.language', next) } catch { /* optional */ } }} aria-label="Switch language"><Globe2 size={18}/><span className="language-code">{language}</span></button><button className="icon-btn" onClick={() => { const next = dark === 'dark' ? 'light' : 'dark'; setDark(next); try { localStorage.setItem('janwatch.theme', next) } catch { /* optional */ } }} aria-label="Toggle theme">{dark === 'dark' ? <Sun size={18}/> : <Moon size={18}/>}</button></div></div>
    <div className="auth-layout"><section className="auth-intro"><div className="eyebrow"><span className="eyebrow-line"/>{hi ? 'आपके शहर के लिए बना' : 'BUILT FOR BETTER NEIGHBOURHOODS'}</div><h1>{hi ? 'आपकी आवाज़।\nआपका शहर।' : 'Your city.\nYour voice.'}</h1><p>{hi ? 'नागरिक समस्याओं को रिपोर्ट करें, प्रगति पर नज़र रखें और समुदाय के साथ बदलाव लाएँ।' : 'Report civic issues, follow real status updates, and help your community turn everyday concerns into visible progress.'}</p><div className="auth-benefits"><div><span><Check size={15}/></span><div><b>Report civic issues</b><small>Choose a service category and add the location.</small></div></div><div><span><ShieldCheck size={15}/></span><div><b>Secure account access</b><small>Email/password or Google sign-in.</small></div></div><div><span><Activity size={15}/></span><div><b>Track your reports</b><small>See status updates saved to your account.</small></div></div></div><div className="auth-note"><LockKeyhole size={15}/><span>Your password is protected by our secure sign-in service.</span></div></section>
      <section className="auth-card"><div className="auth-card-top"><div className="auth-card-icon"><Waves size={24}/></div><span className="secure-pill"><span className="live-dot"/> SECURE ACCESS</span></div><div className="section-kicker">CITIZEN PORTAL</div><h2>{mode === 'register' ? 'Create your account.' : mode === 'reset' ? 'Set a new password.' : (hi ? 'वापसी पर स्वागत है' : 'Welcome back.')}</h2><p>{mode === 'register' ? 'Register once to submit reports and track your activity.' : mode === 'reset' ? 'Choose a new password for your LokPravaah account.' : 'Sign in to access the LokPravaah citizen workspace.'}</p>
        {mode !== 'reset' ? <div className="auth-tabs"><button className={mode === 'login' ? 'selected' : ''} onClick={() => setMode('login')} type="button">Sign in</button><button className={mode === 'register' ? 'selected' : ''} onClick={() => setMode('register')} type="button">Create account</button></div> : <button className="forgot-password reset-back" type="button" onClick={() => { setMode('login'); setPassword(''); setConfirmPassword('') }}>← Back to sign in</button>}
        <form className="auth-form" onSubmit={onSubmit}>{mode === 'register' && <label>Full name<input autoComplete="name" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Enter your full name" minLength={2} maxLength={100} required/></label>}{mode !== 'reset' && <label>Email address<input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required/></label>}<label>{mode === 'reset' ? 'New password' : 'Password'}<input type="password" autoComplete={mode === 'register' || mode === 'reset' ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} placeholder={mode === 'login' ? 'Enter your password' : 'At least 8 characters'} minLength={mode === 'login' ? 1 : 8} required/></label>{(mode === 'register' || mode === 'reset') && <label>Confirm password<input type="password" autoComplete="new-password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Re-enter password" minLength={8} required/></label>}<button className="btn btn-primary auth-submit" type="submit" disabled={!isConfigured || busy}>{busy ? <LoaderCircle size={16} className="spin"/> : mode === 'register' ? <Users size={16}/> : <LockKeyhole size={16}/>} {busy ? 'Please wait…' : mode === 'register' ? 'Create account' : mode === 'reset' ? 'Update password' : 'Sign in'} <ArrowRight size={16}/></button></form>
        {mode === 'login' && <button className="forgot-password" type="button" onClick={onForgotPassword} disabled={!isConfigured || busy}>Forgot password?</button>}
        {mode !== 'reset' && /(verification|confirm your email|confirmation|verify your email|email sending limit|rate limit)/i.test(`${message} ${error}`) && <button className="resend-confirmation" type="button" onClick={onResend} disabled={!isConfigured || busy}><Mail size={14}/>{busy ? 'Please wait…' : 'Resend confirmation email'}</button>}
        {mode !== 'reset' && <><div className="auth-divider"><span/><small>OR CONTINUE WITH</small><span/></div><button className="google-signin" onClick={onGoogle} disabled={!isConfigured || busy}><GoogleMark/>{busy ? 'Connecting…' : 'Continue with Google'}<ArrowRight size={17}/></button></>}
        {!isConfigured && <div className="auth-error"><CircleAlert size={16}/><span>Sign-in is temporarily unavailable. Please try again later.</span></div>}{error && isConfigured && <div className="auth-error"><CircleAlert size={16}/><span>{error}</span></div>}{message && <div className="auth-success"><CheckCircle2 size={16}/><span>{message}</span></div>}
        <div className="auth-card-footer"><ShieldCheck size={14}/> Your session is protected.</div>
      </section></div><footer className="auth-footer"><span>© 2026 LokPravaah</span><span>Community reports · Transparent progress · Privacy first</span><span>Secure access · Privacy first</span></footer>
  </div>
}

function OnboardingScreen({ mode, dark, userEmail, fullName, setFullName, phone, setPhone, city, setCity, ward, setWard, accountType, setAccountType, preferredService, setPreferredService, saving, error, onSubmit, onBack }: { mode: 'setup' | 'edit'; dark: Theme; userEmail: string; fullName: string; setFullName: (v: string) => void; phone: string; setPhone: (v: string) => void; city: string; setCity: (v: string) => void; ward: string; setWard: (v: string) => void; accountType: AccountType; setAccountType: (v: AccountType) => void; preferredService: string; setPreferredService: (v: string) => void; saving: boolean; error: string; onSubmit: (e: FormEvent<HTMLFormElement>) => void; onBack: () => void }) {
  return <div className={`auth-screen theme-${dark}`}><div className="auth-nav"><button className="back-home" type="button" onClick={onBack}><ArrowRight size={15} className="back-arrow"/> Back to welcome</button><Brand/><span className="secure-pill"><ShieldCheck size={13}/> {mode === 'edit' ? 'EDIT PROFILE' : 'PROFILE SETUP'}</span></div><div className="onboarding-wrap"><div className="onboarding-heading"><div className="onboarding-step">{mode === 'edit' ? 'YOUR ACCOUNT · EDIT DETAILS' : 'STEP 1 OF 1 · YOUR CITIZEN PROFILE'}</div><h1>{mode === 'edit' ? 'Keep your profile current.' : 'Let’s make this personal.'}</h1><p>These details help organise your reports by local area. Your account type does not grant administrator permissions.</p><div className="onboarding-email"><Mail size={16}/>{userEmail}</div></div><form className="onboarding-card" onSubmit={onSubmit}><div className="onboarding-form-head"><span><Users size={20}/></span><div><b>Profile details</b><small>Fields marked with * are required.</small></div></div><label>Full name *<input autoComplete="name" value={fullName} onChange={e=>setFullName(e.target.value)} minLength={2} maxLength={100} required placeholder="e.g. Aditya Ratre"/></label><div className="onboarding-two"><label>City or town *<input autoComplete="address-level2" value={city} onChange={e=>setCity(e.target.value)} minLength={2} maxLength={100} required placeholder="Your city / town"/></label><label>Ward or local area *<input value={ward} onChange={e=>setWard(e.target.value)} maxLength={100} required placeholder="Ward number / neighbourhood"/></label></div><div className="onboarding-two"><label>Phone (optional)<input type="tel" autoComplete="tel" value={phone} onChange={e=>setPhone(e.target.value)} maxLength={20} placeholder="Contact number"/></label><label>How will you participate? *<select value={accountType} onChange={e=>setAccountType(e.target.value as AccountType)}><option value="citizen">Citizen</option><option value="volunteer">Community volunteer</option><option value="organisation">Organisation representative</option></select></label></div><label>Primary civic service category *<select value={preferredService} onChange={e=>setPreferredService(e.target.value)}>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select><small className="field-help">You can report any category later; this only personalises your starting point.</small></label>{error&&<div className="auth-error"><CircleAlert size={16}/><span>{error}</span></div>}<div className="onboarding-privacy"><LockKeyhole size={15}/><span>Your profile details are stored in your LokPravaah profile. Do not submit passwords, identity numbers or sensitive personal information here.</span></div><button className="btn btn-primary auth-submit" type="submit" disabled={saving}>{saving?<LoaderCircle size={16} className="spin"/>:<CheckCircle2 size={16}/>} {saving ? (mode === 'edit' ? 'Saving changes…' : 'Saving your profile…') : (mode === 'edit' ? 'Save profile changes' : 'Save profile and open dashboard')} <ArrowRight size={16}/></button></form></div></div>
}

function AuthLoading({ dark }: { dark: Theme }) {
  return <div className={`auth-screen theme-${dark}`}><Brand/><div className="auth-loading"><LoaderCircle size={30} className="spin"/><h2>Checking your session</h2><p>Connecting securely to LokPravaah.</p></div></div>
}

function GoogleMark() { return <svg className="google-mark" viewBox="0 0 48 48" role="img" aria-label="Google"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.27 5.48-4.78 7.18l7.73 6C44.4 38.05 46.98 31.9 46.98 24.55z"/><path fill="#FBBC05" d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.28-3.13.77-4.59l-7.98-6.2A23.9 23.9 0 0 0 0 24c0 3.87.93 7.53 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.8l-7.73-6c-2.14 1.45-4.89 2.3-8.17 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg> }

function ReportPanelHeading({ active, count, onViewAll }: { active: ViewName; count: number; onViewAll: () => void }) {
  return <div className="panel-heading"><div><div className="section-kicker">COMMUNITY PULSE</div><h3>{active === 'My reports' ? 'Your reports' : active === 'Explore map' ? 'Located reports' : active === 'Community' ? 'Community reports' : 'Recent reports'} <span className="count-bubble">{count}</span></h3></div><button className="text-link" onClick={onViewAll}>View community <ArrowRight size={15}/></button></div>
}
function ReportTools({ query, onQuery, filter, onFilter, inputRef }: { query: string; onQuery: (q: string) => void; filter: string; onFilter: (f: string) => void; inputRef: RefObject<HTMLInputElement | null> }) {
  return <div className="report-tools"><div className="search-box"><Search size={16}/><input ref={inputRef} placeholder="Search reports, areas…" value={query} onChange={e => onQuery(e.target.value)}/><kbd>Ctrl K</kbd></div><label className="filter-select-wrap"><Filter size={15}/><select aria-label="Filter reports by status" value={filter} onChange={e => onFilter(e.target.value)}><option>All reports</option>{DB_STATUSES.map(status => <option key={status}>{statusLabel(status)}</option>)}</select><ChevronDown size={14}/></label></div>
}
function ReportList({ issues, loading, dataError, allCount, supportEnabled = true, onSupport, onOpen, onMap }: { issues: Issue[]; loading: boolean; dataError: string; allCount: number; supportEnabled?: boolean; onSupport: (i: Issue) => void; onOpen: (i: Issue) => void; onMap: (i: Issue) => void }) {
  if (loading && issues.length === 0) return <div className="empty-state"><LoaderCircle size={24} className="spin"/><b>Loading live reports</b><span>Getting the latest community reports.</span></div>
  if (dataError && issues.length === 0) return <div className="empty-state"><CircleAlert size={25}/><b>Reports unavailable</b><span>Check your connection and try again.</span></div>
  if (issues.length === 0) return <div className="empty-state"><FileText size={26}/><b>No reports to show</b><span>{allCount === 0 ? 'No community reports yet. Be the first to report an issue.' : 'Try another search, status filter, or section.'}</span></div>
  return <div className="report-list">{issues.map(issue => <article className="report-item" key={issue.id}><div className={`report-symbol ${statusTone(issue.status)}`}>{categoryIcon(issue.category)}</div><div className="report-main"><div className="report-title-line"><h4>{issue.title}</h4><span className={`status status-${statusLabel(issue.status).toLowerCase().replace(/\s+/g, '-')}`}><i/>{statusLabel(issue.status)}</span></div><div className="report-meta"><span title={issue.area}><MapPin size={13}/>{issue.area}</span><span title={formatDate(issue.createdAt)}><Clock3 size={13}/>{relativeDate(issue.createdAt)}</span><span className="report-id">{issue.code}</span></div><div className="report-bottom"><span className="category-tag">{issue.category}</span><span className={`severity-chip severity-${issue.suggestedSeverity}`}>{issue.suggestedSeverity} priority</span>{supportEnabled && <button className={`vote-btn ${issue.supportedByMe ? 'voted' : ''}`} disabled={issue.supportedByMe || issue.visibility !== 'public'} onClick={() => onSupport(issue)} title={issue.supportedByMe ? 'Already supported' : issue.visibility !== 'public' ? 'Private report' : 'Support this report'}><ThumbsUp size={14}/>{issue.votes == null ? '—' : issue.votes} <span>{issue.supportedByMe ? 'supported' : 'support'}</span></button>}</div></div><div className="report-item-actions"><button className="row-more" onClick={() => onOpen(issue)} aria-label={`View details for ${issue.code}`} title="View report details"><Eye size={16}/></button><button className="row-more" onClick={() => onMap(issue)} aria-label={`View map for ${issue.code}`} title="View map"><MapPin size={16}/></button></div></article>)}</div>
}
function categoryIcon(category: string) {
  const lower = category.toLowerCase()
  if (lower.includes('light') || lower.includes('electric')) return <Zap size={18}/>
  if (lower.includes('waste') || lower.includes('sanitation')) return <Leaf size={18}/>
  if (lower.includes('water') || lower.includes('drain')) return <Activity size={18}/>
  if (lower.includes('road') || lower.includes('foot')) return <AlertTriangle size={18}/>
  if (lower.includes('park')) return <Leaf size={18}/>
  return <MapPin size={18}/>
}
function statusTone(status: DbStatus) { return status === 'resolved' ? 'mint' : status === 'rejected' ? 'amber' : status === 'verified' ? 'blue' : 'purple' }
function StatCard({ icon, label, value, hint, tone }: { icon: ReactNode; label: string; value: string; hint: string; tone: string }) {
  return <div className="stat-card"><div className={`stat-icon ${tone}`}>{icon}</div><div className="stat-label">{label}</div><div className="stat-value">{value}</div><div className="stat-foot"><span>{hint}</span></div></div>
}
function QuickActions({ onReport, onMap, onCommunity, reportingEnabled = true }: { onReport: () => void; onMap: () => void; onCommunity: () => void; reportingEnabled?: boolean }) {
  return <div className="panel quick-panel"><div className="panel-heading"><div><div className="section-kicker">GET INVOLVED</div><h3>Make an impact</h3></div><div className="mini-icon"><Zap size={17}/></div></div><p className="panel-desc">Choose a real action in LokPravaah.</p>{reportingEnabled && <button className="quick-action" onClick={onReport}><div className="quick-icon mint"><Camera size={17}/></div><div><b>Report an issue</b><small>Submit a civic report</small></div><ArrowRight size={16}/></button>}<button className="quick-action" onClick={onMap}><div className="quick-icon blue"><MapPin size={17}/></div><div><b>Explore your area</b><small>Inspect reports with real coordinates</small></div><ArrowRight size={16}/></button><button className="quick-action" onClick={onCommunity}><div className="quick-icon purple"><MessageSquareText size={17}/></div><div><b>Community reports</b><small>Search and support public reports</small></div><ArrowRight size={16}/></button></div>
}
function ReportingTipsPanel() {
  return <div className="panel reporting-tips"><div className="trust-heading"><div className="trust-icon"><ClipboardCheck size={18}/></div><div><h3>Make your report useful</h3><p>A clear report is easier to review.</p></div></div><div className="tip-row"><span>01</span><div><b>Pinpoint the place</b><small>Use a street, landmark, ward, or optional GPS location.</small></div></div><div className="tip-row"><span>02</span><div><b>Describe the impact</b><small>Say what is wrong, when you noticed it, and who is affected.</small></div></div><div className="tip-row"><span>03</span><div><b>Share evidence safely</b><small>Only attach material you have permission to share. Avoid faces and private details when possible.</small></div></div><div className="reporting-disclaimer">LokPravaah records information; it does not automatically file an official government complaint or provide emergency response.</div></div>
}
function ProfilePage({ name, email, emailVerified, profile, accountType, preferredService, stats, platformRole, onRefreshRole, onEdit, onSettings, onExport }: { name: string; email: string; emailVerified: boolean; profile: Profile | null; accountType: AccountType; preferredService: string; stats: Stats; platformRole: string; onRefreshRole: () => void; onEdit: () => void; onSettings: () => void; onExport: () => void }) {
  const [detailsOpen, setDetailsOpen] = useState(true)
  const roleLabel = platformRole === 'super_admin' ? 'Super admin' : platformRole === 'admin' ? 'Admin' : platformRole === 'moderator' ? 'Moderator' : platformRole === 'worker' ? 'Approved worker' : 'Member'
  const hasPlatformRole = ['super_admin', 'admin', 'moderator', 'worker'].includes(platformRole)
  return <div className="profile-page"><section className="standalone-heading"><div><div className="eyebrow"><span className="eyebrow-line"/>YOUR ACCOUNT</div><h1>My profile<span className="profile-title-dot">.</span></h1><p>Manage your local-area details and see your real contribution history. Your platform role is shown separately from your participation type.</p></div><div className="standalone-actions"><button className="btn btn-secondary" onClick={onSettings}><Settings size={15}/> Settings</button><button className="btn btn-primary" onClick={onEdit}><Users size={15}/> Edit profile</button></div></section><div className="profile-grid"><section className="panel profile-identity"><div className="profile-large-avatar">{name.slice(0, 1).toUpperCase()}</div><div className="profile-name-block"><h2>{name}</h2><p>{email}</p><span className={`verification-pill ${emailVerified ? 'verified' : 'unverified'}`}><span className="verification-dot"/>{emailVerified ? 'Email verified' : 'Email verification pending'}</span></div><div className={`profile-role-tag ${hasPlatformRole ? 'profile-role-privileged' : ''}`}>Platform role · {roleLabel}</div><p className="profile-role-note">{platformRole === 'worker' ? 'Approved worker permissions let you receive assignments, submit evidence and track assigned work. This does not grant administrator access.' : hasPlatformRole ? 'This role controls platform permissions and is verified by the server.' : `${accountType === 'organisation' ? 'Organisation representative' : accountType === 'volunteer' ? 'Community volunteer' : 'Citizen'} is your participation type. It does not grant administrator permissions.`}</p><button type="button" className="btn btn-secondary profile-role-refresh" onClick={onRefreshRole}><RefreshCw size={14}/> Refresh platform role</button></section><section className="panel profile-summary"><div className="profile-section-heading"><div><div className="section-kicker">RECORDED ACTIVITY</div><h3>Your contribution</h3></div><FileText size={19}/></div><div className="profile-stats"><div><span>Reports submitted</span><b>{displayCount(stats.mine)}</b></div><div><span>Public reports</span><b>{displayCount(stats.total)}</b></div><div><span>Resolved reports</span><b>{displayCount(stats.resolved)}</b></div></div><p className="profile-muted">Your activity summary reflects the information currently available in your account.</p><button className="btn btn-secondary profile-export" onClick={onExport}><FileDown size={16}/> Export my report data</button></section><section className="panel profile-details"><div className="profile-section-heading"><div><div className="section-kicker">LOCAL PROFILE</div><h3>Details and preferences</h3></div><button className="icon-btn" onClick={() => setDetailsOpen(v => !v)} aria-label={detailsOpen ? 'Collapse profile details' : 'Expand profile details'}>{detailsOpen ? <ChevronDown size={18}/> : <ArrowRight size={18}/>}</button></div>{detailsOpen && <div className="profile-fields"><div><span>City / town</span><b>{profile?.city || 'Not added yet'}</b></div><div><span>Ward / local area</span><b>{profile?.ward || 'Not added yet'}</b></div><div><span>Phone</span><b>{profile?.phone || 'Not provided'}</b></div><div><span>Participation type</span><b>{accountType === 'organisation' ? 'Organisation representative' : accountType === 'volunteer' ? 'Community volunteer' : 'Citizen'}</b></div><div><span>Preferred civic service</span><b>{profile?.preferred_service || preferredService || 'Not selected'}</b></div><div><span>Language preference</span><b>{profile?.preferred_language === 'hi' ? 'Hindi' : profile?.preferred_language === 'en' ? 'English' : 'Browser / session preference'}</b></div></div>}<div className="profile-details-footer"><span>Update these details if your local area or preferences change.</span><button className="text-link" onClick={onEdit}>Edit details <ArrowRight size={14}/></button></div></section></div></div>
}
function PageHeader({ eyebrow, title, subtitle, children, onReport }: { eyebrow: string; title: string; subtitle: string; children?: ReactNode; onReport: () => void }) {
  return <section className="standalone-heading"><div><div className="eyebrow"><span className="eyebrow-line"/>{eyebrow}</div><h1>{title}</h1><p>{subtitle}</p></div><div className="standalone-actions">{children}<button className="btn btn-primary" onClick={onReport}><Plus size={17}/> Report an issue</button></div></section>
}
function MapPage({ issues, focus, addressQuery, onFocus, onAddressQuery, onOpen, onReport }: { issues: Issue[]; focus: Coordinates | null; addressQuery: string; onFocus: (c: Coordinates | null) => void; onAddressQuery: (query: string) => void; onOpen: (i: Issue) => void; onReport: () => void }) {
  const locatedIssues = issues.filter(i => i.latitude != null && i.longitude != null)
  const center = focus ?? (!addressQuery ? (locatedIssues[0] ? { lat: locatedIssues[0].latitude!, lon: locatedIssues[0].longitude!, label: locatedIssues[0].code } : null) : null)
  const mapUrl = center ? `https://www.openstreetmap.org/export/embed.html?bbox=${center.lon - 0.025}%2C${center.lat - 0.018}%2C${center.lon + 0.025}%2C${center.lat + 0.018}&layer=mapnik&marker=${center.lat}%2C${center.lon}` : ''
  return <div className="map-layout"><section className="panel map-panel"><div className="panel-heading"><div><div className="section-kicker">OPENSTREETMAP</div><h3>Location view</h3></div><span className="map-count"><MapIcon size={14}/>{locatedIssues.length} located</span></div>{center ? <><iframe title="OpenStreetMap location view" className="map-iframe" src={mapUrl} loading="lazy" referrerPolicy="no-referrer"/><div className="map-caption"><span><MapPin size={14}/>{center.label}</span><a href={`https://www.openstreetmap.org/?mlat=${center.lat}&mlon=${center.lon}#map=16/${center.lat}/${center.lon}`} target="_blank" rel="noreferrer">Open full map <ExternalLink size={13}/></a><button onClick={() => { onFocus(null); onAddressQuery('') }}>Reset focus</button></div></> : <div className="map-no-data"><div className="map-no-data-icon"><MapIcon size={30}/></div><h3>{addressQuery ? 'This report has no saved coordinates' : 'No coordinates available yet'}</h3><p>{addressQuery ? `The saved location is text-only: ${addressQuery}. Search this address on OpenStreetMap instead of showing a fabricated map pin.` : 'The map only shows real coordinates saved with a report. Existing reports with address text but no latitude/longitude cannot be plotted accurately.'}</p>{addressQuery && <a className="btn btn-secondary" href={`https://www.openstreetmap.org/search?query=${encodeURIComponent(addressQuery)}`} target="_blank" rel="noreferrer"><MapPin size={15}/> Search this address <ExternalLink size={14}/></a>}<button className="btn btn-primary" onClick={onReport}><Plus size={16}/> Create a located report</button></div>}</section><section className="panel located-panel"><div className="panel-heading"><div><div className="section-kicker">REPORT LOCATIONS</div><h3>Reports in this view <span className="count-bubble">{issues.length}</span></h3></div></div>{issues.length ? <div className="located-list">{issues.map(issue => <div className="located-row" key={issue.id}><span className={`located-icon ${issue.latitude != null && issue.longitude != null ? 'has-location' : ''}`}><MapPin size={16}/></span><div className="located-copy"><b>{issue.title}</b><small>{issue.area} · {issue.code}</small><span className={`status status-${statusLabel(issue.status).toLowerCase().replace(/\s+/g, '-')}`}><i/>{statusLabel(issue.status)}</span></div>{issue.latitude != null && issue.longitude != null ? <button className="icon-btn" title="Focus map" onClick={() => onFocus({ lat: issue.latitude!, lon: issue.longitude!, label: issue.code })}><LocateFixed size={17}/></button> : <a className="icon-btn map-search-link" title="Search address on OpenStreetMap" target="_blank" rel="noreferrer" href={`https://www.openstreetmap.org/search?query=${encodeURIComponent(issue.area)}`}><ExternalLink size={16}/></a>}<button className="icon-btn" title="Report details" onClick={() => onOpen(issue)}><Eye size={17}/></button></div>)}</div> : <div className="empty-state"><MapPin size={24}/><b>No report locations yet</b><span>Create a report to start the map view.</span></div>}</section></div>
}
function ReportModal({ evidenceEnabled, title, setTitle, category, setCategory, details, setDetails, area, setArea, coordinates, file, setFile, saving, locating, onLocate, onClose, onSubmit }: { evidenceEnabled: boolean; title: string; setTitle: (v: string) => void; category: string; setCategory: (v: string) => void; details: string; setDetails: (v: string) => void; area: string; setArea: (v: string) => void; coordinates: { latitude: number; longitude: number } | null; file: File | null; setFile: (v: File | null) => void; saving: boolean; locating: boolean; onLocate: () => void; onClose: () => void; onSubmit: (e: FormEvent<HTMLFormElement>) => void }) {
  const severity = assessSeverity(category, title, details)
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !saving) onClose() }}><section className="report-modal" role="dialog" aria-modal="true" aria-labelledby="report-modal-title"><div className="modal-top"><div><div className="section-kicker">COMMUNITY REPORT</div><h2 id="report-modal-title">Let's make it better.</h2><p>Submit the details you know. You will receive a reference number after your report is submitted.</p></div><button className="icon-btn" onClick={onClose} aria-label="Close report modal" disabled={saving}><X size={19}/></button></div><form onSubmit={onSubmit}><label>What's the issue? <span>*</span><input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Broken streetlight near the park" required minLength={6} maxLength={160}/></label><label>Category<select value={category} onChange={e => setCategory(e.target.value)}>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></label><label>Where is it? <span>*</span><div className="input-with-icon"><MapPin size={16}/><input value={area} onChange={e => setArea(e.target.value)} placeholder="Area, street or landmark" required minLength={3} maxLength={180}/></div></label><div className="severity-guidance"><span className={`severity-chip severity-${severity}`}>{severity} priority suggestion</span><span>Priority is only a suggestion. It is not an emergency assessment or an official risk rating.</span></div><div className="location-capture"><button type="button" className="btn btn-secondary" onClick={onLocate} disabled={locating}><LocateFixed size={15}/>{locating ? 'Getting location…' : 'Use current location'}</button><span>{coordinates ? `Coordinates captured: ${coordinates.latitude.toFixed(5)}, ${coordinates.longitude.toFixed(5)}` : 'Optional: grant browser location permission to place a real map pin.'}</span></div><label>Additional details<textarea value={details} onChange={e => setDetails(e.target.value)} placeholder="What happened? When did you notice it? Avoid including private personal information." rows={3} maxLength={5000}/></label>{evidenceEnabled && <label className="evidence-picker"><span className="evidence-picker-icon"><ImageIcon size={18}/></span><span><b>Photo or video evidence (optional)</b><small>JPG, PNG, WEBP, MP4 or WEBM · 50 MB max · saved to private storage</small><input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" onChange={e => setFile(e.target.files?.[0] ?? null)}/>{file && <small className="evidence-selected">Selected: {file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB)</small>}</span>{file ? <button type="button" className="icon-btn" title="Remove evidence" onClick={() => setFile(null)}><X size={15}/></button> : <Camera size={18}/>}</label>}<div className="form-disclaimer"><ShieldCheck size={16}/><span>This sends your report to LokPravaah, not directly to a government department. For emergencies, contact local emergency services.</span></div><div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" disabled={saving} className="btn btn-primary"><Send size={16}/>{saving ? 'Submitting report…' : 'Submit report'}<ArrowRight size={15}/></button></div></form></section></div>
}
function downloadComplaintDraft(issue: Issue, reporterName: string, city: string, ward: string) {
  const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })
  const body = [
    'DRAFT CIVIC ISSUE REPRESENTATION',
    `Date: ${today}`,
    '',
    'To,',
    'The Concerned Civic Authority / Department',
    city ? `${city}` : '[City / Municipality]',
    '',
    `Subject: Request for review and appropriate action regarding ${issue.title}`,
    '',
    'Respected Sir / Madam,',
    '',
    `I am ${reporterName || '[Your name]'}` + (ward ? `, residing in ${ward}${city ? `, ${city}` : ''}.` : (city ? `, from ${city}.` : '.')),
    `I wish to bring to your attention the following civic issue: ${issue.title}.`,
    '',
    `Location: ${issue.area}`,
    `Category: ${issue.category}`,
    `LokPravaah reference (for your own records): ${issue.code}`,
    `Current LokPravaah status: ${statusLabel(issue.status)}`,
    '',
    issue.description ? `Details provided: ${issue.description}` : 'Additional details: [Please add relevant dates, impact, and observations.]',
    '',
    'I request that the concern be reviewed by the appropriate authority and that any action taken or further information required be communicated through the relevant official process.',
    '',
    'Thank you for your time and consideration.',
    '',
    'Yours faithfully,',
    reporterName || '[Your name]',
    city || '[City]',
    '',
    'IMPORTANT: This is an editable draft generated from information stored in LokPravaah. It has NOT been submitted to a government authority. Verify the correct department, official address, facts, and submission channel before sending. The LokPravaah reference is not an official government complaint number.',
  ].join('\\n')
  const blob = new Blob([body], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `LokPravaah-complaint-draft-${issue.code}.txt`
  document.body.appendChild(anchor); anchor.click(); anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function IssueDetail({ issue, events, isOwner, isAdmin, evidenceUrl, onClose, onSupport, onMap, onDraft, onAdminStatus }: { issue: Issue; events: ReportEvent[]; isOwner: boolean; isAdmin: boolean; evidenceUrl: string; onClose: () => void; onSupport: () => void; onMap: () => void; onDraft: () => void; onAdminStatus: (s: DbStatus) => void }) {
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}><section className="report-modal detail-modal" role="dialog" aria-modal="true" aria-labelledby="detail-title"><div className="modal-top"><div><div className="section-kicker">REPORT DETAILS · {issue.code}</div><h2 id="detail-title">{issue.title}</h2><p>Created {formatDate(issue.createdAt)} · Updated {formatDate(issue.updatedAt)}</p></div><button className="icon-btn" onClick={onClose} aria-label="Close details"><X size={19}/></button></div><div className="detail-status-row"><span className={`status status-${statusLabel(issue.status).toLowerCase().replace(/\s+/g, '-')}`}><i/>{statusLabel(issue.status)}</span><span className="category-tag">{issue.category}</span><span className={`severity-chip severity-${issue.suggestedSeverity}`}>{issue.suggestedSeverity} priority suggestion</span></div>{isAdmin && <div className="detail-field"><span>SUBMITTED BY</span><p>{issue.reporterName?.trim() || 'Citizen profile name unavailable'}</p>{(issue.reporterCity || issue.reporterWard) && <small className="detail-note">{[issue.reporterCity, issue.reporterWard ? `Ward ${issue.reporterWard}` : ''].filter(Boolean).join(' · ')}</small>}<small className="detail-note">Account ID: {issue.reporterId}</small></div>}{isAdmin && <div className="detail-field"><span>VISIBILITY</span><p>{issue.visibility === 'private' ? 'Private report' : 'Public report'}</p></div>}<div className="detail-field"><span>LOCATION</span><b><MapPin size={15}/>{issue.area}</b></div><div className="detail-field"><span>DESCRIPTION</span><p>{issue.description.trim() || 'No additional description was supplied.'}</p></div>{issue.latitude != null && issue.longitude != null && <div className="detail-field"><span>COORDINATES</span><p>{issue.latitude}, {issue.longitude}</p></div>}{evidenceUrl && (isOwner || isAdmin) && <a className="evidence-open" href={evidenceUrl} target="_blank" rel="noreferrer"><ImageIcon size={16}/> Open private evidence (temporary link) <ExternalLink size={13}/></a>}{(isOwner || isAdmin) && issue.evidencePaths.length > 0 && !evidenceUrl && <p className="detail-note">Private evidence is attached. It could not be opened under the current storage policy.</p>}<div className="detail-actions"><button className="btn btn-secondary" onClick={onMap}><MapPin size={16}/> {issue.latitude != null ? 'Focus on map' : 'Search location'}</button><button className="btn btn-secondary" onClick={onDraft}><FileDown size={15}/> Prepare complaint draft</button>{issue.visibility === 'public' && <button className="btn btn-secondary" onClick={onSupport} disabled={issue.supportedByMe}><ThumbsUp size={15}/>{issue.supportedByMe ? 'Supported' : `Support · ${issue.votes == null ? '—' : issue.votes}`}</button>}</div><div className="report-history"><div className="section-kicker">STATUS HISTORY</div><h3>Recorded updates</h3>{events.length ? <div className="report-history-list">{events.map((event, index) => <div className="report-history-item" key={`${event.created_at}-${index}`}><span className="history-marker"><Activity size={12}/></span><div><b>{event.note || event.event_type.replace(/_/g, ' ')}</b><small>{formatDate(event.created_at)}</small></div></div>)}</div> : <p>No status history is available for this report yet. Future status changes appear here when recorded by an authorised reviewer.</p>}</div>{isAdmin && <div className="admin-status-control"><label>Administrator status update<select value={issue.status} onChange={e => onAdminStatus(e.target.value as DbStatus)}>{DB_STATUSES.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}</select></label><small>Only authorised administrators can change a report status.</small></div>}</section></div>
}
function SettingsModal({ name, email, isAdmin, consoleLabel, dark, language, onTheme, onLanguage, onAdmin, onSignOut, onClose }: { name: string; email: string; isAdmin: boolean; consoleLabel: string; dark: Theme; language: Language; onTheme: (t: Theme) => void; onLanguage: () => void; onAdmin: () => void; onSignOut: () => void; onClose: () => void }) {
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}><section className="report-modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title"><div className="modal-top"><div><div className="section-kicker">ACCOUNT PREFERENCES</div><h2 id="settings-title">Settings</h2><p>Personalise your workspace and manage your session.</p></div><button className="icon-btn" onClick={onClose} aria-label="Close settings"><X size={19}/></button></div><div className="settings-profile"><div className="settings-avatar">{name.slice(0, 1).toUpperCase()}</div><div><b>{name}</b><span>{email}</span><small>Your account</small></div></div><div className="setting-row"><div><b>Appearance</b><small>Choose a comfortable theme.</small></div><div className="setting-control"><button className={dark === 'dark' ? 'selected' : ''} onClick={() => onTheme('dark')}><Moon size={14}/>Dark</button><button className={dark === 'light' ? 'selected' : ''} onClick={() => onTheme('light')}><Sun size={14}/>Light</button></div></div><div className="setting-row"><div><b>Language</b><small>Switch the interface language preference. Some areas remain English.</small></div><button className="btn btn-secondary" onClick={onLanguage}><Globe2 size={15}/>{language === 'EN' ? 'English' : 'हिन्दी'} · Switch</button></div><div className="settings-actions">{isAdmin && <button className="btn btn-secondary" onClick={onAdmin}><ShieldCheck size={16}/> {consoleLabel}</button>}<button className="btn btn-danger" onClick={onSignOut}><LogOut size={16}/> Sign out</button></div></section></div>
}
function HelpModal({ onClose }: { onClose: () => void }) {
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}><section className="report-modal help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title"><div className="modal-top"><div><div className="section-kicker">LokPravaah GUIDE</div><h2 id="help-title">Help centre</h2><p>How to use reports, profile settings, and guided civic tools.</p></div><button className="icon-btn" onClick={onClose} aria-label="Close help"><X size={19}/></button></div><div className="help-list"><div><span>01</span><section><b>Sign in securely</b><p>Sign in with your email and password or Google. If you cannot sign in, try resetting your password or contact support.</p></section></div><div><span>02</span><section><b>Create a civic report</b><p>Add a clear title and place. You can optionally capture browser coordinates and attach a private evidence file.</p></section></div><div><span>03</span><section><b>Track the real status</b><p>Refresh the page to check for updates. If a report still does not appear, contact support.</p></section></div><div><span>04</span><section><b>Use Civic toolkit</b><p>Prepare editable complaint and RTI drafts, organise public-project evidence, and open official grievance portals. Toolkit drafts are not submitted automatically.</p></section></div><div><span>05</span><section><b>Open LokPravaah AI</b><p>Use the dedicated sidebar section for General AI, Legal & Rights, Civic Assistant, and Document AI. You can ask follow-up questions in each mode and start a new chat whenever needed.</p></section></div><div><span>06</span><section><b>Know the limits</b><p>LokPravaah helps organise civic reports and draft documents. Reports are not automatically sent to public authorities, and AI-generated or user-submitted information should be checked before you rely on it.</p></section></div></div><button className="btn btn-primary help-done" onClick={onClose}>Got it <Check size={16}/></button></section></div>
}
function AdminPanel({ issues, role, userId, updatingId, reportsLoading, reportsError, onRefreshReports, onExit, onUpdate, onOpenReport, onPlatformChanged, notify }: { issues: Issue[]; role: string; userId: string; updatingId: string; reportsLoading: boolean; reportsError: string; onRefreshReports: () => void; onExit: () => void; onUpdate: (i: Issue, status: DbStatus) => void; onOpenReport: (issue: Issue) => void; onPlatformChanged: () => void; notify: (message: string) => void }) {
  const [tab, setTab] = useState<'Overview' | 'Reports' | 'Platform controls'>(role === 'moderator' ? 'Platform controls' : 'Overview')
  const pending = issues.filter(i => ['submitted', 'under_review'].includes(i.status)).length
  const resolved = issues.filter(i => i.status === 'resolved').length
  return <div className="admin-page"><div className="admin-header"><div><div className="eyebrow"><span className="eyebrow-line"/> CONTROL CENTRE · {role.replace('_', ' ').toUpperCase()}</div><h1>{role === 'moderator' ? 'Moderation' : 'Admin'} <span>console.</span></h1><p>{role === 'moderator' ? 'Review flagged community messages and moderate public chat. This role cannot change platform settings, rewards or user permissions.' : 'Manage reports, announcements, community moderation, rewards, user roles and publishing from one place.'}</p></div><button className="btn btn-secondary" onClick={onExit}><ArrowRight size={15}/> Back to citizen view</button></div><div className="admin-warning"><ShieldCheck size={18}/><div><b>Privileged access</b><p>Changes may affect everyone using LokPravaah. Review them carefully before saving. Withdrawal requests must be reviewed and paid by an authorised administrator.</p></div></div><div className="admin-tabs">{(role === 'moderator' ? ['Platform controls'] as const : ['Overview', 'Reports', 'Platform controls'] as const).map(value => <button key={value} className={tab === value ? 'selected' : ''} onClick={() => setTab(value)}>{role === 'moderator' ? 'Moderation' : value}</button>)}</div>{tab === 'Overview' ? <><div className="admin-stats"><div><span>Reports in view</span><b>{issues.length}</b><small>Available in this workspace</small></div><div><span>Awaiting review</span><b>{pending}</b><small>Awaiting review</small></div><div><span>Resolved</span><b>{resolved}</b><small>Marked as resolved</small></div></div><div className="panel admin-table-panel"><div className="panel-heading"><div><div className="section-kicker">LATEST ACTIVITY</div><h3>Latest reports</h3></div><button className="text-link" onClick={() => setTab('Reports')}>Manage statuses <ArrowRight size={15}/></button></div><AdminReportTable issues={issues.slice(0, 8)} updatingId={updatingId} loading={reportsLoading} error={reportsError} onRefresh={onRefreshReports} onUpdate={onUpdate} onOpen={onOpenReport}/></div></> : tab === 'Reports' ? <div className="panel admin-table-panel"><div className="panel-heading"><div><div className="section-kicker">REPORT MODERATION</div><h3>Report queue</h3><p>Open any report to read the full description, timeline and available evidence.</p></div><button className="btn btn-secondary" type="button" onClick={onRefreshReports} disabled={reportsLoading}><RefreshCw size={14} className={reportsLoading ? 'spin' : ''}/> Refresh reports</button></div>{reportsError && issues.length > 0 && <div className="data-warning admin-report-warning"><CircleAlert size={17}/><div><b>Reports could not be loaded</b><span>Check report access and database setup, then retry.</span></div><button className="btn btn-secondary" onClick={onRefreshReports} disabled={reportsLoading}>Retry</button></div>}<AdminReportTable issues={issues} updatingId={updatingId} loading={reportsLoading} error={reportsError} onRefresh={onRefreshReports} onUpdate={onUpdate} onOpen={onOpenReport}/></div> : <AdminOperations userId={userId} role={role} onChanged={onPlatformChanged} notify={notify}/>}<div className="admin-footer"><ShieldCheck size={15}/> Changes are available according to your assigned role and permissions.</div></div>
}
function AdminReportTable({ issues, updatingId, loading, error, onRefresh, onUpdate, onOpen }: { issues: Issue[]; updatingId: string; loading: boolean; error: string; onRefresh: () => void; onUpdate: (i: Issue, status: DbStatus) => void; onOpen: (issue: Issue) => void }) {
  if (!issues.length && loading) return <div className="empty-state"><LoaderCircle size={24} className="spin"/><b>Loading reports</b><span>Fetching reports available to this administrator.</span></div>
  if (!issues.length && error) return <div className="empty-state"><CircleAlert size={24}/><b>Reports could not be loaded</b><span>Check your connection and report permissions, then retry.</span><button className="btn btn-secondary" onClick={onRefresh}>Retry loading reports</button></div>
  if (!issues.length) return <div className="empty-state"><FileText size={24}/><b>No reports to review</b><span>New reports will appear here when they are available for review.</span></div>
  return <div className="admin-table"><div className="table-head"><span>REPORT</span><span>LOCATION</span><span>STATUS</span><span>ACTIONS</span></div>{issues.map(issue => <div className="table-row" key={issue.id}><div><b>{issue.title}</b><small>{issue.code} · {issue.category} · {issue.suggestedSeverity} priority</small></div><span>{issue.area || 'Location not provided'}</span><span className={`status status-${statusLabel(issue.status).toLowerCase().replace(/\s+/g, '-')}`}><i/>{statusLabel(issue.status)}</span><div className="admin-report-actions"><button className="table-action" type="button" onClick={() => onOpen(issue)}><Eye size={14}/> View details</button><label className="admin-status-select"><span className="sr-only">Update status for {issue.code}</span><select value={issue.status} disabled={updatingId === issue.id} onChange={e => onUpdate(issue, e.target.value as DbStatus)}>{DB_STATUSES.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}</select></label></div></div>)}</div>
}
function translateView(label: ViewName): string {
  const dict: Record<ViewName, string> = { Overview: 'अवलोकन', 'Explore map': 'नक्शा देखें', 'My reports': 'मेरी रिपोर्ट', Community: 'सामुदायिक रिपोर्ट', 'Public chat': 'सार्वजनिक चैट', Rewards: 'रिवॉर्ड्स', 'Civic toolkit': 'नागरिक सहायता टूलकिट', 'LokPravaah AI': 'लोकप्रवाह AI', 'Worker Hub': 'वर्कर हब', 'Refer & Earn': 'रेफर करें', Donate: 'दान करें', 'My profile': 'मेरी प्रोफ़ाइल' }
  return dict[label]
}
