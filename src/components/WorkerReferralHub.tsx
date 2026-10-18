import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  Activity, ArrowDownRight, ArrowRight, BadgeCheck, CalendarClock, Check, CheckCircle2,
  ChevronRight, CircleAlert, ClipboardCheck, Clock3, Copy, ExternalLink, Gift,
  HandHeart, Info, LoaderCircle, MapPin, RefreshCw, Send, ShieldCheck, Sparkles,
  UserCheck, Users, UsersRound, Wallet, XCircle, Zap
} from 'lucide-react'
import { supabase } from '../lib/supabase'

type Notice = (message: string) => void
type HubProps = {
  userId: string
  displayName: string
  isAdmin: boolean
  city?: string | null
  ward?: string | null
  notify: Notice
}

type WorkerProfile = {
  user_id: string
  status: 'pending' | 'active' | 'rejected' | 'suspended'
  city: string
  ward: string
  skills: string[]
  motivation: string
  max_active_tasks: number
  available: boolean
  admin_note?: string | null
  created_at: string
}
type WorkTask = {
  id: string
  report_id: string
  status: string
  due_at: string | null
  worker_note: string | null
  completion_note: string | null
  evidence_urls: string[]
  created_at: string
  report?: { id: string; public_code: string; title: string; description: string; category: string; address_label: string | null; status: string; created_at: string } | null
}
type WorkerOption = WorkerProfile & { profile?: { display_name?: string | null; city?: string | null; ward?: string | null } | null }
type PublicReport = { id: string; public_code: string; title: string; category: string; address_label: string | null; status: string; created_at: string }
type ProgrammeSetting = { enabled: boolean; points: number }
type ReferralSummary = {
  code: string
  total: number
  qualified: number
  pending: number
  bonus_points: number
  enabled: boolean
  history: { status: string; created_at: string; qualified_at: string | null; bonus_awarded: boolean }[]
}

const SKILLS = ['Roads & Footpaths', 'Waste & Sanitation', 'Streetlights', 'Water & Drainage', 'Public Safety', 'Parks & Public Spaces', 'Community outreach', 'Evidence collection', 'Translation & writing', 'Digital support']
const ACTIVE_TASK_STATUSES = ['assigned', 'accepted', 'in_progress', 'submitted_for_review', 'changes_requested']
const emptyReferral: ReferralSummary = { code: '', total: 0, qualified: 0, pending: 0, bonus_points: 0, enabled: false, history: [] }

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message)
  return 'Something went wrong. Please try again.'
}
function prettyStatus(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase())
}
function formatDate(value?: string | null): string {
  if (!value) return 'Not set'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Not set' : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}
function readCapturedCode(userMetadata?: Record<string, unknown>): string {
  try {
    const params = new URLSearchParams(window.location.search)
    const fromUrl = params.get('ref')?.trim().toUpperCase() || ''
    if (/^[A-Z0-9]{8}$/.test(fromUrl)) return fromUrl
  } catch { /* location can be unavailable in unusual embedded contexts */ }
  try {
    const fromSession = String(sessionStorage.getItem('janwatch.pendingReferralCode') || '').trim().toUpperCase()
    if (/^[A-Z0-9]{8}$/.test(fromSession)) return fromSession
  } catch { /* optional session storage */ }
  const fromMetadata = String(userMetadata?.referral_code || '').trim().toUpperCase()
  return /^[A-Z0-9]{8}$/.test(fromMetadata) ? fromMetadata : ''
}

export default function WorkerReferralHub({ userId, displayName, isAdmin, city, ward, notify }: HubProps) {
  const client = supabase
  const [worker, setWorker] = useState<WorkerProfile | null>(null)
  const [tasks, setTasks] = useState<WorkTask[]>([])
  const [reviewTasks, setReviewTasks] = useState<WorkTask[]>([])
  const [workers, setWorkers] = useState<WorkerOption[]>([])
  const [workerLoads, setWorkerLoads] = useState<Record<string, number>>({})
  const [reports, setReports] = useState<PublicReport[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [pageError, setPageError] = useState('')
  const [activeTab, setActiveTab] = useState<'my-work' | 'manage'>('my-work')
  const [cityValue, setCityValue] = useState(city || '')
  const [wardValue, setWardValue] = useState(ward || '')
  const [skills, setSkills] = useState<string[]>([])
  const [motivation, setMotivation] = useState('')
  const [taskLimit, setTaskLimit] = useState('3')
  const [taskActionId, setTaskActionId] = useState('')
  const [completionNote, setCompletionNote] = useState<Record<string, string>>({})
  const [evidenceText, setEvidenceText] = useState<Record<string, string>>({})
  const [evidenceFiles, setEvidenceFiles] = useState<Record<string, File[]>>({})
  const [adminNote, setAdminNote] = useState<Record<string, string>>({})
  const [assignReportId, setAssignReportId] = useState('')
  const [assignWorkerId, setAssignWorkerId] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [workerProgramme, setWorkerProgramme] = useState<ProgrammeSetting>({ enabled: true, points: 25 })
  const [referralProgramme, setReferralProgramme] = useState<ProgrammeSetting>({ enabled: true, points: 50 })
  const [settingsAction, setSettingsAction] = useState('')

  const load = useCallback(async () => {
    if (!client) { setPageError('Supabase is not configured. Add the project URL and anon key before using live worker features.'); setLoading(false); return }
    setLoading(true); setPageError('')
    try {
      const workerQuery = client.from('worker_profiles').select('user_id,status,city,ward,skills,motivation,max_active_tasks,available,admin_note,created_at').eq('user_id', userId).maybeSingle()
      const tasksQuery = client.from('work_assignments').select('id,report_id,status,due_at,worker_note,completion_note,evidence_urls,created_at,report:reports(id,public_code,title,description,category,address_label,status,created_at)').eq('worker_id', userId).order('created_at', { ascending: false }).limit(100)
      const [workerResult, taskResult] = await Promise.all([workerQuery, tasksQuery])
      if (workerResult.error) throw workerResult.error
      if (taskResult.error) throw taskResult.error
      if (!workerResult.error) {
        const data = workerResult.data as WorkerProfile | null
        setWorker(data)
        if (data) { setCityValue(data.city); setWardValue(data.ward); setSkills(data.skills || []); setMotivation(data.motivation || ''); setTaskLimit(String(data.max_active_tasks || 3)) }
      }
      const hydrateEvidence = async (rows: WorkTask[]) => Promise.all(rows.map(async task => {
        const urls = await Promise.all((task.evidence_urls || []).map(async value => {
          if (!value.startsWith('storage://citizen-evidence/')) return value
          const objectPath = value.slice('storage://citizen-evidence/'.length)
          const { data } = await client.storage.from('citizen-evidence').createSignedUrl(objectPath, 60 * 60 * 24 * 7)
          return data?.signedUrl || ''
        }))
        return { ...task, evidence_urls: urls.filter(Boolean), report: Array.isArray(task.report) ? task.report[0] : task.report }
      }))
      if (!taskResult.error) setTasks(await hydrateEvidence((taskResult.data || []) as unknown as WorkTask[]))
      if (isAdmin) {
        const [workersResult, reportsResult, assignmentsResult, reviewTasksResult, workerSettingsResult, referralSettingsResult] = await Promise.all([
          client.from('worker_profiles').select('user_id,status,city,ward,skills,motivation,max_active_tasks,available,admin_note,created_at,profile:profiles!worker_profiles_user_id_fkey(display_name,city,ward)').order('created_at', { ascending: false }).limit(200),
          client.from('reports').select('id,public_code,title,category,address_label,status,created_at').eq('visibility', 'public').not('status', 'in', '(resolved,rejected)').order('created_at', { ascending: false }).limit(100),
          client.from('work_assignments').select('report_id,worker_id,status').not('status', 'in', '(completed,cancelled)').limit(1000),
          client.from('work_assignments').select('id,report_id,status,due_at,worker_note,completion_note,evidence_urls,created_at,report:reports(id,public_code,title,description,category,address_label,status,created_at)').eq('status','submitted_for_review').order('updated_at', { ascending: false }).limit(100),
          client.from('worker_settings').select('enabled,points_per_approved_task').eq('id', true).maybeSingle(),
          client.from('referral_settings').select('enabled,bonus_points').eq('id', true).maybeSingle(),
        ])
        if (workersResult.error) throw workersResult.error
        setWorkers(((workersResult.data || []) as unknown as WorkerOption[]).map(option => ({ ...option, profile: Array.isArray(option.profile) ? option.profile[0] : option.profile })))
        if (assignmentsResult.error) throw assignmentsResult.error
        const activeAssignments = (assignmentsResult.data || []) as unknown as { report_id: string; worker_id: string }[]
        const loadByWorker: Record<string, number> = {}
        activeAssignments.forEach(item => { loadByWorker[item.worker_id] = (loadByWorker[item.worker_id] || 0) + 1 })
        setWorkerLoads(loadByWorker)
        if (reviewTasksResult.error) throw reviewTasksResult.error
        if (workerSettingsResult.error) throw workerSettingsResult.error
        if (referralSettingsResult.error) throw referralSettingsResult.error
        if (workerSettingsResult.data) setWorkerProgramme({ enabled: Boolean(workerSettingsResult.data.enabled), points: Number(workerSettingsResult.data.points_per_approved_task || 0) })
        if (referralSettingsResult.data) setReferralProgramme({ enabled: Boolean(referralSettingsResult.data.enabled), points: Number(referralSettingsResult.data.bonus_points || 0) })
        setReviewTasks(await hydrateEvidence((reviewTasksResult.data || []) as unknown as WorkTask[]))
        if (!reportsResult.error) {
          const busyReportIds = new Set(activeAssignments.map(item => item.report_id))
          setReports(((reportsResult.data || []) as PublicReport[]).filter(report => !busyReportIds.has(report.id)))
          const availableReports = ((reportsResult.data || []) as PublicReport[]).filter(report => !busyReportIds.has(report.id))
          setAssignReportId(current => current && availableReports.some(report => report.id === current) ? current : (availableReports[0]?.id || ''))
        } else throw reportsResult.error
      }
    } catch (error) {
      setPageError(errorMessage(error))
    } finally { setLoading(false) }
  }, [client, userId, isAdmin])

  useEffect(() => { void load() }, [load])
  const activeTasks = useMemo(() => tasks.filter(task => ACTIVE_TASK_STATUSES.includes(task.status)), [tasks])
  const completedTasks = useMemo(() => tasks.filter(task => task.status === 'completed'), [tasks])
  const eligibleWorkers = useMemo(() => workers.filter(item => item.status === 'active' && item.available && (workerLoads[item.user_id] || 0) < item.max_active_tasks), [workers, workerLoads])
  const workerName = (option: WorkerOption) => option.profile?.display_name || `Volunteer ${option.user_id.slice(0, 6)}`

  async function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!client) return
    if (skills.length === 0) { notify('Choose at least one skill or contribution area.'); return }
    setSaving(true)
    try {
      const { data, error } = await client.rpc('janwatch_worker_apply', { p_city: cityValue.trim(), p_ward: wardValue.trim(), p_skills: skills, p_motivation: motivation.trim(), p_max_active_tasks: Number(taskLimit) })
      if (error) throw error
      notify(data === 'active' ? 'Your approved worker profile has been updated.' : 'Worker application submitted. It will be reviewed by the operations team.')
      await load()
    } catch (error) { notify(`Could not submit worker application: ${errorMessage(error)}`) }
    finally { setSaving(false) }
  }

  async function updateTask(task: WorkTask, action: string) {
    if (!client) return
    const note = (completionNote[task.id] || '').trim()
    const urls = (evidenceText[task.id] || '').split(/\n|,/).map(value => value.trim()).filter(Boolean)
    const files = action === 'submit' ? (evidenceFiles[task.id] || []) : []
    setTaskActionId(task.id)
    const uploadedPaths: string[] = []
    try {
      if (files.some(file => !['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime'].includes(file.type))) throw new Error('Use JPG, PNG, WebP, MP4, WebM or MOV files only.')
      if (files.some(file => file.size > 50 * 1024 * 1024)) throw new Error('Each photo/video must be 50 MB or smaller.')
      if (urls.length + files.length > 5) throw new Error('Attach no more than five links and files combined.')
      for (const file of files) {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100) || 'evidence'
        const objectPath = `${userId}/worker-work/${task.id}/${crypto.randomUUID()}-${safeName}`
        const { error: uploadError } = await client.storage.from('citizen-evidence').upload(objectPath, file, { contentType: file.type, upsert: false })
        if (uploadError) throw uploadError
        uploadedPaths.push(`storage://citizen-evidence/${objectPath}`)
      }
      const { error } = await client.rpc('janwatch_worker_update_assignment', { p_assignment_id: task.id, p_action: action, p_note: note || null, p_evidence_urls: action === 'submit' ? [...urls, ...uploadedPaths] : [] })
      if (error) throw error
      notify(action === 'submit' ? 'Work submitted for operations review.' : action === 'accept' ? 'Task accepted.' : 'Task moved to in progress.')
      setCompletionNote(current => ({ ...current, [task.id]: '' })); setEvidenceText(current => ({ ...current, [task.id]: '' })); setEvidenceFiles(current => ({ ...current, [task.id]: [] }))
      await load()
    } catch (error) {
      const uploadedObjects = uploadedPaths.map(value => value.slice('storage://citizen-evidence/'.length))
      if (uploadedObjects.length) await client.storage.from('citizen-evidence').remove(uploadedObjects)
      notify(`Task update failed: ${errorMessage(error)}`)
    } finally { setTaskActionId('') }
  }

  async function setAvailability(next: boolean) {
    if (!client) return
    setSaving(true)
    try {
      const { error } = await client.rpc('janwatch_worker_set_availability', { p_available: next })
      if (error) throw error
      notify(next ? 'You are now available for new assignments.' : 'You are marked unavailable for new assignments. Existing tasks remain in your workspace.')
      await load()
    } catch (error) { notify(`Could not update availability: ${errorMessage(error)}`) }
    finally { setSaving(false) }
  }

  async function reviewWorker(option: WorkerOption, action: string) {
    if (!client) return
    setTaskActionId(option.user_id)
    try {
      const { error } = await client.rpc('janwatch_admin_review_worker', { p_worker_id: option.user_id, p_action: action, p_note: adminNote[option.user_id] || null })
      if (error) throw error
      notify(`Worker status updated: ${prettyStatus(action)}.`)
      await load()
    } catch (error) { notify(`Could not update worker: ${errorMessage(error)}`) }
    finally { setTaskActionId('') }
  }

  async function assignWork(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!client || !assignReportId || !assignWorkerId) { notify('Choose a report and an approved worker first.'); return }
    setSaving(true)
    try {
      const { error } = await client.rpc('janwatch_admin_assign_work', { p_report_id: assignReportId, p_worker_id: assignWorkerId, p_due_at: dueDate ? new Date(dueDate).toISOString() : null })
      if (error) throw error
      notify('Work assigned successfully. The worker can now see it in their workspace.')
      setDueDate(''); await load()
    } catch (error) { notify(`Assignment failed: ${errorMessage(error)}`) }
    finally { setSaving(false) }
  }

  async function reviewTask(task: WorkTask, action: string) {
    if (!client) return
    setTaskActionId(task.id)
    try {
      const { error } = await client.rpc('janwatch_admin_review_assignment', { p_assignment_id: task.id, p_action: action, p_note: adminNote[task.id] || null })
      if (error) throw error
      notify(action === 'approve' ? 'Work approved. Eligible contribution points are recorded in the rewards ledger.' : action === 'request_changes' ? 'Changes requested from the worker.' : 'Work assignment cancelled.')
      await load()
    } catch (error) { notify(`Review failed: ${errorMessage(error)}`) }
    finally { setTaskActionId('') }
  }

  async function saveWorkerProgramme() {
    if (!client) return
    setSettingsAction('worker')
    try {
      const points = Math.max(0, Math.min(100000, Math.trunc(Number(workerProgramme.points) || 0)))
      const { error } = await client.from('worker_settings').update({ enabled: workerProgramme.enabled, points_per_approved_task: points, updated_by: userId, updated_at: new Date().toISOString() }).eq('id', true)
      if (error) throw error
      setWorkerProgramme(current => ({ ...current, points }))
      notify('Worker programme rules saved.')
      await load()
    } catch (error) { notify(`Could not save worker rules: ${errorMessage(error)}`) }
    finally { setSettingsAction('') }
  }

  async function awardPendingWorkerPoints() {
    if (!client) return
    setSettingsAction('worker-reconcile')
    try {
      const { data, error } = await client.rpc('janwatch_admin_award_pending_worker_task_rewards')
      if (error) throw error
      notify(`${Number(data || 0)} previously approved task reward${Number(data || 0) === 1 ? '' : 's'} credited.`)
      await load()
    } catch (error) { notify(`Could not reconcile worker rewards: ${errorMessage(error)}`) }
    finally { setSettingsAction('') }
  }

  async function saveReferralProgramme() {
    if (!client) return
    setSettingsAction('referral')
    try {
      const points = Math.max(0, Math.min(100000, Math.trunc(Number(referralProgramme.points) || 0)))
      const { error } = await client.from('referral_settings').update({ enabled: referralProgramme.enabled, bonus_points: points, updated_by: userId, updated_at: new Date().toISOString() }).eq('id', true)
      if (error) throw error
      setReferralProgramme(current => ({ ...current, points }))
      notify('Referral programme rules saved.')
      await load()
    } catch (error) { notify(`Could not save referral rules: ${errorMessage(error)}`) }
    finally { setSettingsAction('') }
  }

  async function awardPendingReferralBonuses() {
    if (!client) return
    setSettingsAction('reconcile')
    try {
      const { data, error } = await client.rpc('janwatch_admin_award_pending_referral_bonuses')
      if (error) throw error
      notify(`${Number(data || 0)} pending qualified referral bonus${Number(data || 0) === 1 ? '' : 'es'} awarded.`)
      await load()
    } catch (error) { notify(`Could not reconcile referral bonuses: ${errorMessage(error)}`) }
    finally { setSettingsAction('') }
  }

  const statusText = worker?.status === 'active' ? 'Approved volunteer' : worker?.status === 'pending' ? 'Application under review' : worker?.status === 'suspended' ? 'Access suspended' : 'Volunteer application'

  return <div className="wr-hub page-enter">
    <section className="wr-hero">
      <div className="wr-hero-glow" aria-hidden="true" />
      <div className="wr-hero-copy"><div className="section-kicker"><HandHeart size={14}/> CITIZEN-POWERED ACTION</div><h1>Make change <span>happen.</span></h1><p>Good to have you here, {displayName || 'volunteer'}. Coordinate real community work, keep every hand-off visible, and recognise meaningful contributions.</p><div className="wr-hero-tags"><span><ShieldCheck size={14}/> Reviewed access</span><span><Activity size={14}/> Trackable tasks</span><span><Gift size={14}/> Contribution points</span></div></div>
      <div className="wr-hero-art" aria-hidden="true"><div className="wr-orbit wr-orbit-one"/><div className="wr-orbit wr-orbit-two"/><div className="wr-hero-core"><UsersRound size={34}/></div><span className="wr-float wr-float-a"><CheckCircle2 size={14}/> Assign</span><span className="wr-float wr-float-b"><Sparkles size={14}/> Contribute</span></div>
    </section>

    <div className="wr-stats-grid">
      <article className="wr-stat"><span className="wr-stat-icon"><ClipboardCheck size={18}/></span><small>Active tasks</small><strong>{loading ? '—' : activeTasks.length}</strong><span className="wr-stat-foot">Assigned to you</span></article>
      <article className="wr-stat"><span className="wr-stat-icon"><BadgeCheck size={18}/></span><small>Approved work</small><strong>{loading ? '—' : completedTasks.length}</strong><span className="wr-stat-foot">Reviewed by operations</span></article>
      <article className="wr-stat"><span className="wr-stat-icon"><MapPin size={18}/></span><small>Your work area</small><strong className="wr-stat-location">{worker?.city || city || 'Set area'}</strong><span className="wr-stat-foot">{worker?.ward || ward || 'City & ward'}</span></article>
    </div>

    <div className="wr-section-head"><div><div className="section-kicker">VOLUNTEER WORKSPACE</div><h2>Contribute with purpose.</h2><p>Apply to help, complete assigned tasks, and send evidence back for review.</p></div><button className="btn btn-secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={15} className={loading ? 'wr-spin' : ''}/> Refresh</button></div>
    {pageError && <div className="wr-error"><CircleAlert size={17}/><span>{pageError}</span><button className="btn btn-secondary" onClick={() => void load()}>Retry</button></div>}
    <div className="wr-layout">
      <section className="wr-main-column">
        {!worker || worker.status === 'rejected' ? <div className="wr-panel wr-apply-panel">
          <div className="wr-card-heading"><div className="wr-heading-icon"><HandHeart size={20}/></div><div><h3>{worker?.status === 'rejected' ? 'Update and reapply' : 'Become a LokPravaah volunteer'}</h3><p>Tell the operations team where and how you can help. Approval is required before assignments appear.</p></div></div>
          <form className="wr-form" onSubmit={apply}>
            <div className="wr-two-fields"><label>City / town<input value={cityValue} onChange={e => setCityValue(e.target.value)} maxLength={80} placeholder="e.g. Bilaspur" required minLength={2}/></label><label>Ward / local area<input value={wardValue} onChange={e => setWardValue(e.target.value)} maxLength={80} placeholder="e.g. Tikrapara" required minLength={1}/></label></div>
            <fieldset className="wr-skills-field"><legend>Skills and contribution areas <span>Choose all that apply</span></legend><div className="wr-skill-grid">{SKILLS.map(skill => <label key={skill} className={`wr-skill-chip ${skills.includes(skill) ? 'selected' : ''}`}><input type="checkbox" checked={skills.includes(skill)} onChange={e => setSkills(current => e.target.checked ? [...current, skill] : current.filter(item => item !== skill))}/><span>{skills.includes(skill) ? <Check size={13}/> : <span className="wr-chip-empty"/>}</span>{skill}</label>)}</div></fieldset>
            <label>Why would you like to contribute? <textarea value={motivation} onChange={e => setMotivation(e.target.value)} maxLength={1000} rows={3} placeholder="Share a little about your experience, time, or motivation. (Optional)"/></label>
            <label>Maximum active tasks at one time<select value={taskLimit} onChange={e => setTaskLimit(e.target.value)}>{[1,2,3,4,5,6,7,8,9,10].map(n => <option key={n} value={n}>{n} task{n > 1 ? 's' : ''}</option>)}</select><small>Helps the team avoid assigning more work than you can manage.</small></label>
            <div className="wr-privacy-note"><ShieldCheck size={16}/><span>Your worker profile is visible to authorised operations admins for review and task matching. Applying does not grant admin rights or guarantee paid work.</span></div>
            <button type="submit" className="btn btn-primary" disabled={saving || loading}>{saving ? <LoaderCircle size={16} className="wr-spin"/> : <Send size={16}/>} Submit volunteer application <ArrowRight size={16}/></button>
          </form>
        </div> : <div className={`wr-status-card wr-status-${worker.status}`}>
          <div className="wr-status-icon">{worker.status === 'active' ? <UserCheck size={23}/> : worker.status === 'pending' ? <Clock3 size={23}/> : <XCircle size={23}/>}</div><div className="wr-status-copy"><small>YOUR VOLUNTEER PROFILE</small><h3>{statusText}</h3><p>{worker.status === 'active' ? `You are approved for ${worker.city}, ${worker.ward}. Accept a task to start and submit your work for review when complete.` : worker.status === 'pending' ? 'Your application is in the review queue. You can refresh this page to check its status.' : 'Contact the operations team if you believe this is a mistake.'}</p>{worker.admin_note && <div className="wr-admin-note"><b>Operations note:</b> {worker.admin_note}</div>}</div>{worker.status === 'active' && <div className="wr-worker-availability"><span className={`wr-approval-pill ${worker.available ? '' : 'wr-unavailable-pill'}`}><CheckCircle2 size={13}/>{worker.available ? 'Available' : 'Unavailable'}</span><button className="btn btn-secondary" disabled={saving} onClick={() => void setAvailability(!worker.available)}>{worker.available ? 'Pause assignments' : 'Available again'}</button></div>}</div>}

        {worker?.status === 'active' && <>
          <div className="wr-task-section-head"><div><h3>Your assigned work</h3><p>Task completion is reviewed by LokPravaah operations. It does not automatically resolve the public report.</p></div><span className="wr-count-pill">{activeTasks.length} active</span></div>
          {tasks.length === 0 && !loading ? <div className="wr-empty"><div className="wr-empty-icon"><ClipboardCheck size={22}/></div><h3>You're ready for your first task</h3><p>Nothing has been assigned to you yet. The operations team can match public reports to your skills and area.</p></div> : <div className="wr-task-list">{tasks.map(task => <article key={task.id} className="wr-task-card">
            <div className="wr-task-top"><span className={`wr-status-pill wr-pill-${task.status}`}>{prettyStatus(task.status)}</span><small>{task.report?.public_code || 'Civic report'} · {formatDate(task.created_at)}</small></div>
            <h3>{task.report?.title || 'Report details unavailable'}</h3><p>{task.report?.description || 'No additional description was provided.'}</p>
            <div className="wr-task-meta"><span><MapPin size={14}/>{task.report?.address_label || 'Location not specified'}</span><span><ClipboardCheck size={14}/>{task.report?.category || 'Community task'}</span><span><CalendarClock size={14}/>Due: {formatDate(task.due_at)}</span></div>
            {task.report?.address_label && <a className="btn btn-secondary wr-route-link" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(task.report.address_label)}`} target="_blank" rel="noopener noreferrer"><MapPin size={15}/> Open route in Google Maps <ExternalLink size={13}/></a>}
            {task.completion_note && <div className="wr-completion-note"><b>Previous submission</b><p>{task.completion_note}</p></div>}
            {task.evidence_urls?.length > 0 && <div className="wr-evidence-links">{task.evidence_urls.map((url, index) => <a href={url} target="_blank" rel="noreferrer" key={`${url}-${index}`}><ExternalLink size={13}/> Evidence link {index + 1}</a>)}</div>}
            {task.status === 'assigned' && <div className="wr-task-actions"><button className="btn btn-primary" disabled={taskActionId === task.id} onClick={() => void updateTask(task, 'accept')}>{taskActionId === task.id ? <LoaderCircle size={15} className="wr-spin"/> : <CheckCircle2 size={15}/>} Accept task</button></div>}
            {(task.status === 'accepted' || task.status === 'changes_requested') && <div className="wr-task-actions"><button className="btn btn-primary" disabled={taskActionId === task.id} onClick={() => void updateTask(task, 'start')}><Zap size={15}/> Start work</button></div>}
            {task.status === 'in_progress' && <div className="wr-completion-form"><label>Completion note <textarea rows={3} maxLength={2000} value={completionNote[task.id] || ''} onChange={e => setCompletionNote(current => ({ ...current, [task.id]: e.target.value }))} placeholder="Describe what you did, when, and what changed."/></label><label>Evidence links (optional, HTTPS only; one per line)<textarea rows={2} value={evidenceText[task.id] || ''} onChange={e => setEvidenceText(current => ({ ...current, [task.id]: e.target.value }))} placeholder="https://…"/></label><label className="wr-evidence-upload"><span><b>Photos and videos</b><small>Up to 5 total links/files · 50 MB per file · images, MP4, WebM or MOV</small></span><input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime" multiple onChange={e => setEvidenceFiles(current => ({ ...current, [task.id]: Array.from(e.target.files || []).slice(0, 5) }))}/>{(evidenceFiles[task.id] || []).length > 0 && <small>{evidenceFiles[task.id].map(file => file.name).join(', ')}</small>}</label><button className="btn btn-primary" disabled={taskActionId === task.id} onClick={() => void updateTask(task, 'submit')}>{taskActionId === task.id ? <LoaderCircle size={15} className="wr-spin"/> : <Send size={15}/>} Submit evidence for review <ArrowRight size={15}/></button></div>}
            {task.status === 'submitted_for_review' && <div className="wr-review-wait"><Clock3 size={16}/><span>Submitted for review. Your work will be approved or returned with feedback.</span></div>}
            {task.status === 'completed' && <div className="wr-task-approved"><CheckCircle2 size={16}/><span>Task approved by operations. Eligible contribution points are recorded under Rewards.</span></div>}
          </article>)}</div>}
        </>}
      </section>

      <aside className="wr-side-column">
        <section className="wr-panel wr-how-card"><div className="wr-card-heading"><div className="wr-heading-icon"><ShieldCheck size={19}/></div><div><h3>How work is verified</h3><p>Clear steps from assignment to review.</p></div></div><div className="wr-step-list"><div><span>01</span><section><b>Assigned</b><small>Operations matches a public report to an approved worker.</small></section></div><div><span>02</span><section><b>Accept & work</b><small>The worker records progress and gathers relevant evidence.</small></section></div><div><span>03</span><section><b>Submit for review</b><small>Completion notes and optional HTTPS evidence links go to operations.</small></section></div><div><span>04</span><section><b>Approved or returned</b><small>Only an authorised reviewer closes the task and enables eligible points.</small></section></div></div></section>
        <section className="wr-panel wr-integrity-card"><div className="wr-integrity-icon"><Info size={17}/></div><div><b>Transparent by design</b><p>Workers cannot assign themselves tasks, approve their own work, or change their platform role. Public report status remains separate from volunteer task status.</p></div></section>
      </aside>
    </div>

    {isAdmin && <section className="wr-admin-zone">
      <div className="wr-section-head"><div><div className="section-kicker">OPERATIONS CONSOLE</div><h2>Manage community work.</h2><p>Review volunteer applications and assign eligible public reports. Admin actions are audited.</p></div><span className="wr-admin-label"><ShieldCheck size={14}/> Admin tools</span></div>
      <div className="wr-tabs"><button className={activeTab === 'my-work' ? 'active' : ''} onClick={() => setActiveTab('my-work')}><Users size={15}/> Worker applications <span>{workers.filter(item => item.status === 'pending').length}</span></button><button className={activeTab === 'manage' ? 'active' : ''} onClick={() => setActiveTab('manage')}><ClipboardCheck size={15}/> Assign & review work</button></div>
      {activeTab === 'my-work' ? <div className="wr-worker-admin-list">{workers.length === 0 && !loading ? <div className="wr-empty"><h3>No volunteer applications yet</h3><p>New applications will appear here once citizens apply.</p></div> : workers.map(option => <article key={option.user_id} className="wr-worker-admin-card">
        <div className="wr-worker-avatar">{(option.profile?.display_name || 'V').slice(0,1).toUpperCase()}</div><div className="wr-worker-admin-copy"><div className="wr-worker-name-row"><b>{workerName(option)}</b><span className={`wr-status-pill wr-pill-${option.status}`}>{prettyStatus(option.status)}</span></div><small><MapPin size={13}/>{option.city}, {option.ward} · {workerLoads[option.user_id] || 0}/{option.max_active_tasks} active tasks</small><div className="wr-worker-skills">{(option.skills || []).map(skill => <span key={skill}>{skill}</span>)}</div>{option.motivation && <p>{option.motivation}</p>}{option.admin_note && <small className="wr-note-muted">Last admin note: {option.admin_note}</small>}</div><div className="wr-worker-admin-actions">{option.status !== 'active' && option.status !== 'suspended' && <button className="btn btn-primary" disabled={taskActionId === option.user_id} onClick={() => void reviewWorker(option, 'approve')}><Check size={14}/> Approve</button>}{option.status === 'pending' && <button className="btn btn-secondary" disabled={taskActionId === option.user_id} onClick={() => void reviewWorker(option, 'reject')}>Reject</button>}{option.status === 'active' && <button className="btn btn-secondary" disabled={taskActionId === option.user_id} onClick={() => void reviewWorker(option, 'suspend')}>Suspend</button>}{option.status === 'suspended' && <button className="btn btn-primary" disabled={taskActionId === option.user_id} onClick={() => void reviewWorker(option, 'reactivate')}>Reactivate</button>}<input aria-label={`Optional note for ${workerName(option)}`} value={adminNote[option.user_id] || ''} onChange={e => setAdminNote(current => ({ ...current, [option.user_id]: e.target.value }))} placeholder="Optional admin note" maxLength={500}/></div>
      </article>)}</div> : <div className="wr-manage-grid"><section className="wr-panel wr-assign-card"><div className="wr-card-heading"><div className="wr-heading-icon"><ArrowDownRight size={19}/></div><div><h3>Assign a report</h3><p>Only approved, available workers with open capacity can be assigned to public unresolved reports.</p></div></div><form className="wr-form" onSubmit={assignWork}><label>Public report<select value={assignReportId} onChange={e => setAssignReportId(e.target.value)} required><option value="">Choose report…</option>{reports.map(report => <option key={report.id} value={report.id}>{report.public_code} · {report.title} ({report.category})</option>)}</select></label><label>Approved worker<select value={assignWorkerId} onChange={e => setAssignWorkerId(e.target.value)} required><option value="">Choose worker…</option>{eligibleWorkers.map(option => <option key={option.user_id} value={option.user_id}>{workerName(option)} · {option.city}/{option.ward} · {workerLoads[option.user_id] || 0}/{option.max_active_tasks} tasks</option>)}</select></label><label>Optional due date<input type="datetime-local" value={dueDate} min={new Date(Date.now() - new Date().getTimezoneOffset() * 60000 + 60000).toISOString().slice(0,16)} onChange={e => setDueDate(e.target.value)}/></label><button type="submit" className="btn btn-primary" disabled={saving || !reports.length || !eligibleWorkers.length}>{saving ? <LoaderCircle size={15} className="wr-spin"/> : <Send size={15}/>} Assign task</button><p className="wr-form-footnote">Capacity and duplicate-assignment checks run again on the database before saving.</p></form>{reports.length === 0 && <p className="wr-note-muted">No unassigned public reports are available right now.</p>}</section>
        <section className="wr-panel wr-review-card"><div className="wr-card-heading"><div className="wr-heading-icon"><ClipboardCheck size={19}/></div><div><h3>Submitted work to review</h3><p>Approval closes the task and may award contribution points.</p></div></div>{reviewTasks.length === 0 ? <div className="wr-empty wr-empty-compact"><p>No submitted volunteer tasks are waiting for operations review. Refresh after a worker submits one.</p></div> : reviewTasks.map(task => <article className="wr-review-item" key={task.id}><b>{task.report?.title || task.report?.public_code || 'Submitted task'}</b><small>{task.report?.public_code} · Submitted {formatDate(task.created_at)}</small><p>{task.completion_note || 'No completion note.'}</p>{task.evidence_urls?.map((url,index) => <a href={url} target="_blank" rel="noreferrer" key={`${url}-${index}`}><ExternalLink size={12}/> Evidence {index+1}</a>)}<label>Review note<input value={adminNote[task.id] || ''} onChange={e => setAdminNote(current => ({...current,[task.id]:e.target.value}))} placeholder="Feedback for worker" maxLength={500}/></label><div className="wr-review-buttons"><button className="btn btn-primary" disabled={taskActionId===task.id} onClick={() => void reviewTask(task,'approve')}><Check size={14}/> Approve</button><button className="btn btn-secondary" disabled={taskActionId===task.id} onClick={() => void reviewTask(task,'request_changes')}>Request changes</button><button className="btn btn-secondary" disabled={taskActionId===task.id} onClick={() => void reviewTask(task,'cancel')}>Cancel</button></div></article>)}</section></div>}
      <section className="wr-programme-settings">
        <div className="wr-section-head"><div><div className="section-kicker">REWARD CONTROLS</div><h2>Programme settings.</h2><p>These limits are enforced by database rules, not just the interface.</p></div><span className="wr-admin-label"><ShieldCheck size={14}/> Admin only</span></div>
        <div className="wr-settings-grid">
          <article className="wr-panel wr-settings-card">
            <div className="wr-card-heading"><div className="wr-heading-icon"><HandHeart size={19}/></div><div><h3>Volunteer contribution points</h3><p>Points are credited only after an admin approves submitted work and all reward switches are enabled.</p></div></div>
            <label className="wr-setting-toggle"><input type="checkbox" checked={workerProgramme.enabled} onChange={e => setWorkerProgramme(current => ({...current, enabled:e.target.checked}))}/><span><b>Enable worker programme rewards</b><small>Workers can still complete tasks while point rewards are paused.</small></span></label>
            <label className="wr-setting-points">Points per approved task<input type="number" min="0" max="100000" step="1" value={workerProgramme.points} onChange={e => setWorkerProgramme(current => ({...current, points:Number(e.target.value)}))}/></label>
            <div className="wr-settings-actions"><button className="btn btn-primary" disabled={settingsAction !== '' || loading} onClick={() => void saveWorkerProgramme()}>{settingsAction === 'worker' ? <LoaderCircle size={15} className="wr-spin"/> : <Check size={15}/>} Save worker rules</button><button className="btn btn-secondary" disabled={settingsAction !== '' || loading || !workerProgramme.enabled} onClick={() => void awardPendingWorkerPoints()}>{settingsAction === 'worker-reconcile' ? <LoaderCircle size={15} className="wr-spin"/> : <RefreshCw size={15}/>} Award pending points</button></div>
          </article>
          <article className="wr-panel wr-settings-card">
            <div className="wr-card-heading"><div className="wr-heading-icon"><Gift size={19}/></div><div><h3>Referral bonus rules</h3><p>A referral must be new, email-verified, and have a completed city/ward profile before it qualifies for points.</p></div></div>
            <label className="wr-setting-toggle"><input type="checkbox" checked={referralProgramme.enabled} onChange={e => setReferralProgramme(current => ({...current, enabled:e.target.checked}))}/><span><b>Enable referral bonus rewards</b><small>Referral activity can still be recorded while bonus points are paused.</small></span></label>
            <label className="wr-setting-points">Points per qualified referral<input type="number" min="0" max="100000" step="1" value={referralProgramme.points} onChange={e => setReferralProgramme(current => ({...current, points:Number(e.target.value)}))}/></label>
            <div className="wr-settings-actions"><button className="btn btn-primary" disabled={settingsAction !== '' || loading} onClick={() => void saveReferralProgramme()}>{settingsAction === 'referral' ? <LoaderCircle size={15} className="wr-spin"/> : <Check size={15}/>} Save referral rules</button><button className="btn btn-secondary" disabled={settingsAction !== '' || loading || !referralProgramme.enabled} onClick={() => void awardPendingReferralBonuses()}>{settingsAction === 'reconcile' ? <LoaderCircle size={15} className="wr-spin"/> : <RefreshCw size={15}/>} Award pending bonuses</button></div>
            <p className="wr-settings-footnote">The reconcile action pays only qualified, not-yet-awarded referrals and enforces the configured per-referrer limit.</p>
          </article>
        </div>
      </section>
    </section>}
  </div>
}

export function ReferralStudio({ userMetadata, notify }: { userMetadata?: Record<string, unknown>; notify: Notice }) {
  const client = supabase
  const [summary, setSummary] = useState<ReferralSummary>(emptyReferral)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const inviteLink = useMemo(() => summary.code ? `${window.location.origin}/?ref=${encodeURIComponent(summary.code)}` : '', [summary.code])
  const load = useCallback(async () => {
    if (!client) { setError('Supabase is not configured. Set the project URL and anon key to enable referrals.'); setLoading(false); return }
    setLoading(true); setError('')
    try {
      const capturedCode = readCapturedCode(userMetadata)
      if (capturedCode) {
        const { error: captureError } = await client.rpc('janwatch_capture_referral', { p_referral_code: capturedCode })
        // Invalid/self/duplicate code is a harmless non-attribution, not a reason to block sign-in.
        if (captureError && !/already|self|invalid|not found/i.test(captureError.message)) throw captureError
        if (!captureError) { try { sessionStorage.removeItem('janwatch.pendingReferralCode') } catch { /* optional session storage */ } }
      }
      const { error: qualificationError } = await client.rpc('janwatch_qualify_my_referral')
      if (qualificationError) throw qualificationError
      const { data, error: summaryError } = await client.rpc('janwatch_my_referral_summary')
      if (summaryError) throw summaryError
      const raw = (data || {}) as Partial<ReferralSummary>
      setSummary({ code: String(raw.code || ''), total: Number(raw.total || 0), qualified: Number(raw.qualified || 0), pending: Number(raw.pending || 0), bonus_points: Number(raw.bonus_points || 0), enabled: Boolean(raw.enabled), history: Array.isArray(raw.history) ? raw.history : [] })
    } catch (loadError) { setError(errorMessage(loadError)) }
    finally { setLoading(false) }
  }, [client, userMetadata])
  useEffect(() => { void load() }, [load])

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(inviteLink)
      notify('Referral link copied. Share it with someone who may benefit from LokPravaah.')
    } catch {
      notify('Copy was blocked by the browser. Select and copy the referral link manually.')
    }
  }
  async function shareLink() {
    if (navigator.share) {
      try { await navigator.share({ title: 'Join LokPravaah', text: 'Join me on LokPravaah to report civic issues and contribute to community solutions.', url: inviteLink }) }
      catch (error) { if (!(error instanceof Error && error.name === 'AbortError')) notify('Sharing did not complete. You can copy the link instead.') }
    } else { await copyLink() }
  }

  return <div className="ref-studio page-enter">
    <section className="ref-hero"><div className="ref-hero-bg"/><div className="ref-hero-copy"><div className="section-kicker"><UsersRound size={14}/> GROW THE COMMUNITY</div><h1>Good things <span>travel.</span></h1><p>Invite people to report civic problems, follow progress, and take part in local action. Rewards are governed by the platform's published rules.</p><div className="ref-hero-note"><ShieldCheck size={15}/> No address book access. You choose who receives your link.</div></div><div className="ref-gift-art" aria-hidden="true"><div className="ref-gift-orbit"/><div className="ref-gift-core"><Gift size={35}/></div><span className="ref-gift-particle ref-particle-one">✦</span><span className="ref-gift-particle ref-particle-two">✳</span></div></section>
    {error && <div className="wr-error"><CircleAlert size={17}/><span>{error}</span><button className="btn btn-secondary" onClick={() => void load()}>Retry</button></div>}
    <div className="ref-content-grid"><section className="ref-main-card">
      <div className="ref-card-head"><div><div className="section-kicker">YOUR INVITE LINK</div><h2>Bring someone into the flow.</h2><p>Use your personal code. Referral attribution is created only after a new account signs in with the code.</p></div><span className="ref-code-icon"><Gift size={22}/></span></div>
      <div className="ref-code-box"><div><small>YOUR REFERRAL CODE</small><strong>{loading ? '••••••••' : summary.code || 'Unavailable'}</strong></div><button className="btn btn-secondary" onClick={() => void copyLink()} disabled={!inviteLink}><Copy size={15}/> Copy link</button></div>
      <div className="ref-link-field"><input aria-label="Referral link" readOnly value={inviteLink || (loading ? 'Preparing your personal link…' : 'Referral link unavailable')} onFocus={e => e.currentTarget.select()}/><button className="btn btn-primary" onClick={() => void shareLink()} disabled={!inviteLink}><Send size={15}/> Share invite <ArrowRight size={15}/></button></div>
      <div className="ref-steps"><div><span>1</span><section><b>Share your link</b><small>Send it to friends or community groups where sharing is welcome.</small></section></div><ChevronRight size={15}/><div><span>2</span><section><b>They join</b><small>Their account is attributed to your code if the code is captured at sign-up/sign-in.</small></section></div><ChevronRight size={15}/><div><span>3</span><section><b>They complete setup</b><small>Email verification plus a complete city/ward profile qualifies the referral.</small></section></div></div>
      <div className="ref-fairness-note"><Info size={16}/><p>Only one referrer can be attached to an account. Self-referrals are blocked. Repeated accounts, fake profiles, or misuse may be rejected by platform review. Referral points are not cash and depend on enabled reward rules.</p></div>
    </section><aside className="ref-side-column">
      <section className="ref-bonus-card"><div className="ref-bonus-top"><span><Wallet size={17}/></span><small>{summary.enabled ? 'CURRENT REFERRAL RULE' : 'REFERRAL BONUS STATUS'}</small></div><strong>{loading ? '—' : summary.enabled && summary.bonus_points > 0 ? `+${summary.bonus_points}` : '—'}</strong><p>{summary.enabled && summary.bonus_points > 0 ? 'points per qualified referral' : 'Referral bonuses are currently unavailable'}</p><span className="ref-bonus-foot"><ShieldCheck size={13}/> Recorded through the rewards ledger</span></section>
      <section className="ref-milestone-card"><div className="wr-card-heading"><div className="wr-heading-icon"><Sparkles size={19}/></div><div><h3>Your community impact</h3><p>Invite quality matters more than raw clicks.</p></div></div><div className="ref-progress-label"><span>Qualified invitations</span><b>{summary.qualified} / {Math.max(summary.total, 1)}</b></div><div className="ref-progress-track"><span style={{ width: `${summary.total ? Math.min(100, summary.qualified / summary.total * 100) : 0}%` }}/></div><div className="ref-mini-stats"><div><small>Total</small><b>{loading ? '—' : summary.total}</b></div><div><small>Qualified</small><b>{loading ? '—' : summary.qualified}</b></div><div><small>Pending</small><b>{loading ? '—' : summary.pending}</b></div></div><p className="ref-milestone-foot">An invitation is not qualified just because someone opens a link or creates an unverified account.</p></section>
    </aside></div>
    <section className="ref-history-card"><div className="wr-section-head"><div><div className="section-kicker">REFERRAL ACTIVITY</div><h2>Invite history.</h2><p>Only anonymous status is displayed here; your invitees' personal identity is not exposed.</p></div><button className="btn btn-secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={15} className={loading ? 'wr-spin' : ''}/> Refresh</button></div>{summary.history.length === 0 && !loading ? <div className="wr-empty wr-empty-compact"><Users size={22}/><h3>Your first invite starts here</h3><p>Share the referral link. Activity appears when someone is safely attributed to your code.</p></div> : <div className="ref-history-list">{summary.history.map((item,index) => <article key={`${item.created_at}-${index}`}><span className={`ref-history-status ${item.status === 'qualified' ? 'qualified' : item.status === 'rejected' ? 'rejected' : ''}`}>{item.status === 'qualified' ? <CheckCircle2 size={15}/> : item.status === 'rejected' ? <XCircle size={15}/> : <Clock3 size={15}/>}</span><div className="ref-history-copy"><b>{prettyStatus(item.status)} referral</b><small>Added {formatDate(item.created_at)}{item.qualified_at ? ` · Qualified ${formatDate(item.qualified_at)}` : ''}</small></div><div className="ref-history-bonus">{item.bonus_awarded ? <><BadgeCheck size={14}/> Bonus awarded</> : item.status === 'qualified' ? <span>Qualified</span> : <span>In progress</span>}</div></article>)}</div>}</section>
  </div>
}
