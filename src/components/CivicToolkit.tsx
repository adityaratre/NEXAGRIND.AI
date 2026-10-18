import { useMemo, useState } from 'react'
import { ArrowDownToLine, ArrowUpRight, BookOpen, Check, CheckCircle2, ClipboardCheck, FileText, Landmark, Link2, ListChecks, ShieldAlert, Trash2 } from 'lucide-react'

type ToolkitTab = 'complaint' | 'rti' | 'project' | 'channels'
type ProfileDefaults = { city?: string | null; ward?: string | null; phone?: string | null }

const PROJECT_CHECKS = [
  { id: 'sanction', label: 'Administrative approval / sanction order', why: 'Confirms the project was approved and by whom.' },
  { id: 'cost', label: 'Sanctioned cost and itemised estimate', why: 'Provides a baseline for comparison; cost alone does not prove wrongdoing.' },
  { id: 'tender', label: 'Tender, work order and contractor details', why: 'Helps identify scope, responsible contractor and contractual dates.' },
  { id: 'timeline', label: 'Original completion date and approved extensions', why: 'Distinguishes a documented delay from an unsupported assumption.' },
  { id: 'site', label: 'Dated, location-specific site photos', why: 'Shows observed conditions at a particular time, not the entire project history.' },
  { id: 'quality', label: 'Quality inspection or completion certificate', why: 'Provides official findings that can be compared with observations.' },
  { id: 'payment', label: 'Measurement book, bills or payment records', why: 'May help compare recorded work with what is observable; access rules apply.' },
  { id: 'response', label: 'Written clarification from the responsible authority', why: 'Gives the authority an opportunity to explain missing or conflicting records.' },
]

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function clean(value: string, fallback = '[Please add details]') { return value.trim() || fallback }

export default function CivicToolkit({ userName, profile }: { userName: string; profile: ProfileDefaults | null }) {
  const [tab, setTab] = useState<ToolkitTab>('complaint')
  const [notice, setNotice] = useState('')
  const [busyCopy, setBusyCopy] = useState(false)
  const [complaint, setComplaint] = useState({ name: userName, city: profile?.city ?? '', ward: profile?.ward ?? '', authority: '', subject: '', location: '', details: '', desired: '' })
  const [rti, setRti] = useState({ name: userName, address: [profile?.ward, profile?.city].filter(Boolean).join(', '), authority: '', period: '', records: '', mode: 'paper' })
  const [project, setProject] = useState({ name: '', location: '', authority: '', observations: '', checks: [] as string[] })

  const complaintDraft = useMemo(() => [
    'DRAFT CIVIC GRIEVANCE / REPRESENTATION',
    `Prepared on: ${new Date().toLocaleDateString('en-IN')}`,
    '', 'To,', clean(complaint.authority, '[Name of the responsible department / public authority]'),
    clean(complaint.city, '[City / District]'), '',
    `Subject: ${clean(complaint.subject, '[Brief issue and location]')}`, '',
    'Respected Sir / Madam,', '',
    `I, ${clean(complaint.name)}, residing in ${clean(complaint.ward, '[Ward / locality]')}${complaint.city.trim() ? `, ${complaint.city.trim()}` : ''}, wish to bring the following civic concern to your attention.`, '',
    `Location of issue: ${clean(complaint.location)}`, '',
    'Facts and observations:', clean(complaint.details), '',
    `Relief / action requested: ${clean(complaint.desired, 'Please inspect the issue and inform me of the action proposed or taken.')}`, '',
    'I request an acknowledgement / reference number if the receiving authority provides one, and a written update through the appropriate official process.', '',
    'Yours faithfully,', clean(complaint.name), clean(complaint.ward, '[Address / locality]'), clean(complaint.city, '[City / District]'), '',
    'LokPravaah NOTE: This is an editable draft only. It has not been submitted to any authority. Verify the correct authority, facts, attachments and official submission route before sending. It is not legal advice and is not an official complaint reference.'
  ].join('\n'), [complaint])

  const rtiDraft = useMemo(() => [
    'DRAFT APPLICATION SEEKING INFORMATION UNDER THE RIGHT TO INFORMATION ACT, 2005',
    `Prepared on: ${new Date().toLocaleDateString('en-IN')}`,
    '', 'To,', 'The Public Information Officer (PIO)', clean(rti.authority, '[Exact public authority / office]'), '',
    'Subject: Request for access to specified records / information', '',
    'Sir / Madam,', '',
    `I, ${clean(rti.name)}, request access to the following existing records held by your public authority. This request seeks records / information rather than an explanation, opinion, or action on a grievance.`, '',
    `Relevant period / date range: ${clean(rti.period, '[Specify a reasonable date range, if applicable]')}`, '',
    'Records / information requested (number each item clearly):', clean(rti.records), '',
    `Preferred mode for receiving information: ${rti.mode === 'electronic' ? 'Electronic copies where available' : 'Paper / inspection as permitted by the authority'}.`, '',
    `Applicant name: ${clean(rti.name)}`, `Address: ${clean(rti.address)}`, '',
    'Please communicate the applicable fee, if any, and the next procedural step through the official process.', '',
    'Yours faithfully,', clean(rti.name), clean(rti.address), '',
    'IMPORTANT: This is a draft, not a filed RTI request and not legal advice. Confirm eligibility, fee, format, exemptions and the correct Public Information Officer. The central RTI Online portal (rtionline.gov.in) states it is for Central Government public authorities; do not use it for state-government authorities. Use the relevant State RTI process when applicable.'
  ].join('\n'), [rti])

  const projectReview = useMemo(() => {
    const selected = PROJECT_CHECKS.filter(item => project.checks.includes(item.id))
    return [
      'PUBLIC PROJECT EVIDENCE REVIEW — WORKING NOTE',
      `Prepared on: ${new Date().toLocaleDateString('en-IN')}`,
      '', `Project / work: ${clean(project.name)}`, `Location: ${clean(project.location)}`, `Responsible authority: ${clean(project.authority)}`, '',
      'Citizen observations (record facts, dates and sources; avoid conclusions not supported by evidence):', clean(project.observations), '',
      'Records / evidence located or still needed:',
      ...(selected.length ? selected.map((item, i) => `${i + 1}. [CHECKED] ${item.label} — ${item.why}`) : ['No evidence checklist items marked yet.']),
      ...PROJECT_CHECKS.filter(item => !project.checks.includes(item.id)).map(item => `- [NOT YET CHECKED] ${item.label}`), '',
      'Suggested cautious next steps:',
      '1. Preserve original files and note their dates, source and location.',
      '2. Separate direct observations from claims made by others.',
      '3. Request missing public records through the applicable official process.',
      '4. Ask the responsible authority for clarification before drawing conclusions.',
      '5. If publishing, redact personal information and label unresolved points as unverified.', '',
      'DISCLAIMER: This checklist does not verify a project, establish fraud, determine liability, or constitute an official inspection. A checked item means the user has marked it for review, not that LokPravaah independently verified the record.'
    ].join('\n')
  }, [project])

  function notify(message: string) { setNotice(message); window.setTimeout(() => setNotice(''), 4500) }
  async function copyText(value: string) {
    setBusyCopy(true)
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard permission is unavailable in this browser. Use Download draft instead.')
      await navigator.clipboard.writeText(value)
      notify('Draft copied to clipboard. Review it before sending.')
    } catch { notify('Could not copy the draft. Use Download draft instead.') }
    finally { setBusyCopy(false) }
  }

  const tabs: { id: ToolkitTab; label: string; subtitle: string; icon: typeof FileText }[] = [
    { id: 'complaint', label: 'Complaint draft', subtitle: 'Prepare a clear representation', icon: FileText },
    { id: 'rti', label: 'RTI request', subtitle: 'Ask for existing records', icon: BookOpen },
    { id: 'project', label: 'Project review', subtitle: 'Organise evidence carefully', icon: ListChecks },
    { id: 'channels', label: 'Official channels', subtitle: 'Continue on an official portal', icon: Landmark },
  ]

  return <div className="toolkit-page">
    <section className="standalone-heading"><div><div className="eyebrow"><span className="eyebrow-line"/> GUIDED CIVIC ACTION</div><h1>Civic toolkit<span className="profile-title-dot">.</span></h1><p>Turn a concern into a structured draft, a record request, or a careful evidence checklist. Nothing is submitted automatically.</p></div></section>
    <div className="toolkit-safety"><ShieldAlert size={19}/><div><b>Evidence first. Conclusions later.</b><p>These tools help organise information. They do not provide legal advice, verify allegations, or file with a public authority. Check current rules and the receiving authority before sending.</p></div></div>
    <div className="toolkit-tabs" role="tablist" aria-label="Civic toolkit modules">{tabs.map(({ id, label, subtitle, icon: Icon }) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'selected' : ''} onClick={() => setTab(id)}><Icon size={19}/><span><b>{label}</b><small>{subtitle}</small></span></button>)}</div>

    {tab === 'complaint' && <section className="panel toolkit-panel"><div className="toolkit-panel-heading"><div className="toolkit-icon"><FileText size={21}/></div><div><div className="section-kicker">DOCUMENT BUILDER</div><h2>Draft a civic complaint</h2><p>Describe observable facts and the action you are requesting.</p></div></div><div className="toolkit-form-grid"><label>Your name<input value={complaint.name} onChange={e => setComplaint(v => ({ ...v, name: e.target.value }))} required maxLength={100}/></label><label>City / district<input value={complaint.city} onChange={e => setComplaint(v => ({ ...v, city: e.target.value }))} maxLength={100} placeholder="City / district"/></label><label>Ward / locality<input value={complaint.ward} onChange={e => setComplaint(v => ({ ...v, ward: e.target.value }))} maxLength={160} placeholder="Ward / neighbourhood"/></label><label>Department / authority<input value={complaint.authority} onChange={e => setComplaint(v => ({ ...v, authority: e.target.value }))} maxLength={160} placeholder="e.g. Municipal Council"/></label><label className="toolkit-full">Subject<input value={complaint.subject} onChange={e => setComplaint(v => ({ ...v, subject: e.target.value }))} maxLength={180} placeholder="Brief issue and location"/></label><label className="toolkit-full">Exact location<input value={complaint.location} onChange={e => setComplaint(v => ({ ...v, location: e.target.value }))} maxLength={250} placeholder="Street, landmark, ward"/></label><label className="toolkit-full">Facts, dates and impact<textarea value={complaint.details} onChange={e => setComplaint(v => ({ ...v, details: e.target.value }))} rows={4} maxLength={6000} placeholder="What did you observe? Since when? Who or what is affected? Avoid assumptions about intent."/></label><label className="toolkit-full">Action requested<textarea value={complaint.desired} onChange={e => setComplaint(v => ({ ...v, desired: e.target.value }))} rows={2} maxLength={2000} placeholder="Inspection, repair, written status update, or other reasonable request"/></label></div><DraftActions onDownload={() => downloadText('LokPravaah-civic-complaint-draft.txt', complaintDraft)} onCopy={() => void copyText(complaintDraft)} busyCopy={busyCopy} onClear={() => { setComplaint({ name: userName, city: profile?.city ?? '', ward: profile?.ward ?? '', authority: '', subject: '', location: '', details: '', desired: '' }); notify('Complaint draft fields cleared.') }}/><div className="toolkit-preview"><b>Draft preview</b><pre>{complaintDraft}</pre></div></section>}

    {tab === 'rti' && <section className="panel toolkit-panel"><div className="toolkit-panel-heading"><div className="toolkit-icon"><BookOpen size={21}/></div><div><div className="section-kicker">INFORMATION REQUEST BUILDER</div><h2>Prepare an RTI request</h2><p>Focus on existing records, not on demanding an explanation or resolution.</p></div></div><div className="toolkit-guidance"><b>Better requests ask for specific records.</b><p>For example: a sanction order, work order, inspection report, measurement book, completion certificate or action-taken record for a stated period. Ask for records you need; keep questions numbered and narrow.</p></div><div className="toolkit-form-grid"><label>Applicant name<input value={rti.name} onChange={e => setRti(v => ({ ...v, name: e.target.value }))} maxLength={100}/></label><label>Full postal address<input value={rti.address} onChange={e => setRti(v => ({ ...v, address: e.target.value }))} maxLength={400} placeholder="Your postal address"/></label><label className="toolkit-full">Public authority / office<input value={rti.authority} onChange={e => setRti(v => ({ ...v, authority: e.target.value }))} maxLength={250} placeholder="Exact department / office and PIO, if known"/></label><label>Date range / period<input value={rti.period} onChange={e => setRti(v => ({ ...v, period: e.target.value }))} maxLength={160} placeholder="e.g. 1 April 2024 – 31 March 2025"/></label><label>Preferred copy format<select value={rti.mode} onChange={e => setRti(v => ({ ...v, mode: e.target.value }))}><option value="paper">Paper / inspection, as permitted</option><option value="electronic">Electronic copies, where available</option></select></label><label className="toolkit-full">Specific records requested<textarea value={rti.records} onChange={e => setRti(v => ({ ...v, records: e.target.value }))} rows={5} maxLength={6000} placeholder={'1. Copy of the sanction order for…\n2. Copy of the work order and approved estimate for…\n3. Copy of inspection / completion records for…'}/></label></div><DraftActions onDownload={() => downloadText('LokPravaah-RTI-request-draft.txt', rtiDraft)} onCopy={() => void copyText(rtiDraft)} busyCopy={busyCopy} onClear={() => { setRti({ name: userName, address: [profile?.ward, profile?.city].filter(Boolean).join(', '), authority: '', period: '', records: '', mode: 'paper' }); notify('RTI draft fields cleared.') }}/><div className="toolkit-preview"><b>Draft preview</b><pre>{rtiDraft}</pre></div><div className="toolkit-disclaimer">Jurisdiction matters: India's RTI Online portal is for Central Government authorities, not State Government authorities. Use the applicable state process when seeking state or local-body records.</div></section>}

    {tab === 'project' && <section className="panel toolkit-panel"><div className="toolkit-panel-heading"><div className="toolkit-icon"><ListChecks size={21}/></div><div><div className="section-kicker">PUBLIC INTEREST REVIEW</div><h2>Project evidence checklist</h2><p>Organise what you have and identify which official records are still missing.</p></div></div><div className="toolkit-form-grid"><label>Project / work name<input value={project.name} onChange={e => setProject(v => ({ ...v, name: e.target.value }))} maxLength={180} placeholder="Name shown on public board / tender"/></label><label>Location<input value={project.location} onChange={e => setProject(v => ({ ...v, location: e.target.value }))} maxLength={250} placeholder="Site, ward, city"/></label><label className="toolkit-full">Responsible authority (if known)<input value={project.authority} onChange={e => setProject(v => ({ ...v, authority: e.target.value }))} maxLength={250} placeholder="Department / local body"/></label><label className="toolkit-full">Your observations and source notes<textarea value={project.observations} onChange={e => setProject(v => ({ ...v, observations: e.target.value }))} maxLength={6000} rows={4} placeholder="Write dates, what you personally observed, source links, and what remains uncertain."/></label></div><div className="checklist-heading"><div><div className="section-kicker">RECORDS TO LOOK FOR</div><h3>Mark records you have located</h3></div><span>{project.checks.length} of {PROJECT_CHECKS.length}</span></div><div className="project-checklist">{PROJECT_CHECKS.map(item => <label key={item.id} className={project.checks.includes(item.id) ? 'checked' : ''}><input type="checkbox" checked={project.checks.includes(item.id)} onChange={e => setProject(v => ({ ...v, checks: e.target.checked ? [...v.checks, item.id] : v.checks.filter(id => id !== item.id) }))}/><span className="project-check-copy"><b>{item.label}</b><small>{item.why}</small></span><Check size={15}/></label>)}</div><DraftActions onDownload={() => downloadText('LokPravaah-project-evidence-review.txt', projectReview)} onCopy={() => void copyText(projectReview)} busyCopy={busyCopy} onClear={() => { setProject({ name: '', location: '', authority: '', observations: '', checks: [] }); notify('Project review fields cleared.') }}/><div className="toolkit-disclaimer">A checked box means you marked a record as located; LokPravaah has not independently verified it. Missing information or a discrepancy is not by itself proof of fraud or wrongdoing.</div><div className="toolkit-preview"><b>Review note preview</b><pre>{projectReview}</pre></div></section>}


    {tab === 'channels' && <section className="panel toolkit-panel"><div className="toolkit-panel-heading"><div className="toolkit-icon"><Landmark size={21}/></div><div><div className="section-kicker">OFFICIAL DESTINATIONS</div><h2>Choose the right next channel</h2><p>Open the authoritative portal in a separate tab. LokPravaah does not send data to these websites.</p></div></div><div className="channel-list"><OfficialChannel title="CPGRAMS — Public Grievance Portal" scope="Central / state public service grievances; check exclusions and the relevant department before filing." url="https://pgportal.gov.in/" label="Open CPGRAMS"/><OfficialChannel title="Chhattisgarh NIDAAN 1100" scope="Urban local-body grievance services in Chhattisgarh. Check that the issue and local body fall within the portal's service scope." url="https://nidaan.cg.gov.in/website/" label="Open NIDAAN"/><OfficialChannel title="Chhattisgarh CM Helpline" scope="State grievance registration and status information. Review current eligibility and instructions on the portal." url="https://cmhelpline.cg.gov.in/Home/" label="Open CM Helpline"/><OfficialChannel title="RTI Online — Central Government authorities" scope="For Central Government public authorities. The portal explicitly says not to use it for State Government authorities, including state departments and local bodies." url="https://rtionline.gov.in/" label="Open RTI Online"/></div><div className="toolkit-disclaimer">Portal availability, eligibility, department coverage, required documents and procedure can change. Check the official site itself. Keep LokPravaah report references separate from official portal registration numbers.</div></section>}

    {notice && <div className="toolkit-notice" role="status">{notice}</div>}
  </div>
}

function DraftActions({ onDownload, onCopy, busyCopy, onClear }: { onDownload: () => void; onCopy: () => void; busyCopy: boolean; onClear: () => void }) {
  return <div className="toolkit-actions"><button className="btn btn-primary" onClick={onDownload}><ArrowDownToLine size={16}/> Download editable .txt draft</button><button className="btn btn-secondary" onClick={onCopy} disabled={busyCopy}><Link2 size={16}/>{busyCopy ? 'Copying…' : 'Copy draft text'}</button><button className="btn btn-quiet" onClick={onClear}><Trash2 size={15}/> Clear fields</button></div>
}
function OfficialChannel({ title, scope, url, label }: { title: string; scope: string; url: string; label: string }) {
  return <article className="official-channel"><div className="official-channel-icon"><Landmark size={18}/></div><div className="official-channel-copy"><h3>{title}</h3><p>{scope}</p><a href={url} target="_blank" rel="noopener noreferrer">{label} <ArrowUpRight size={14}/></a></div></article>
}
