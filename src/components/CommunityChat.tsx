import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { AlertTriangle, Check, LoaderCircle, MessageCircle, RefreshCw, Send, ShieldCheck, Trash2, Flag, X } from 'lucide-react'
import { supabase } from '../lib/supabase'

type ChatMessage = { id: string; user_id: string; author_name: string; author_role?: string; body: string; is_hidden: boolean; created_at: string }

function formatTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export default function CommunityChat({ userId, displayName, currentRole = '', isAdmin, enabled, notify }: {
  userId: string
  displayName: string
  currentRole?: string
  isAdmin: boolean
  enabled: boolean
  notify: (message: string) => void
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [body, setBody] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [flagTarget, setFlagTarget] = useState<string | null>(null)
  const [flagReason, setFlagReason] = useState('Spam or repeated promotion')
  const [flagBusy, setFlagBusy] = useState(false)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  const loadMessages = useCallback(async (quiet = false) => {
    if (!supabase) { setError('Community chat is temporarily unavailable. Please try again later.'); setLoading(false); return }
    if (!quiet) setLoading(true)
    setError('')
    let { data, error: queryError } = await supabase
      .from('community_messages')
      .select('id,user_id,author_name,author_role,body,is_hidden,created_at')
      .order('created_at', { ascending: false })
      .limit(150)
    if (queryError && /author_role|column/i.test(queryError.message)) {
      const fallback = await supabase.from('community_messages').select('id,user_id,author_name,body,is_hidden,created_at').order('created_at', { ascending: false }).limit(150)
      data = fallback.data as any
      queryError = fallback.error
    }
    if (queryError) setError('Messages could not be loaded. Please refresh and try again.')
    else {
      const ownRole = ['moderator', 'admin', 'super_admin'].includes(currentRole) ? currentRole : ''
      setMessages(((data ?? []) as ChatMessage[]).map(item => ({
        ...item,
        // The currently signed-in user's badge can use the freshly verified role. This
        // is presentation only; database policies still control all privileged actions.
        author_role: item.user_id === userId && ownRole ? ownRole : ((item as ChatMessage).author_role || 'member'),
      })).reverse())
    }
    setLoading(false)
  }, [currentRole, userId])

  useEffect(() => {
    if (!enabled) return
    void loadMessages()
    if (!supabase) return
    const channel = supabase.channel('janwatch-community-chat')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'community_messages' }, () => { void loadMessages(true) })
      .subscribe()
    return () => { void supabase?.removeChannel(channel) }
  }, [enabled, loadMessages])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages.length])

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = body.trim()
    if (!supabase || !trimmed || sending) return
    if (trimmed.length > 2000) { setError('Messages are limited to 2,000 characters.'); return }
    setSending(true); setError('')
    try {
      const { error: insertError } = await supabase.from('community_messages').insert({ user_id: userId, body: trimmed })
      if (insertError) { setError('Your message could not be sent. Please try again.'); return }
      setBody('')
      await loadMessages(true)
    } catch (sendError) {
      setError('Your message could not be sent. Check your connection and try again.')
    } finally {
      setSending(false)
    }
  }

  async function flagMessage(messageId: string) {
    if (!supabase) return
    setFlagBusy(true)
    const { error: flagError } = await supabase.from('community_message_flags').insert({ message_id: messageId, reporter_id: userId, reason: flagReason.trim() || 'Other concern' })
    setFlagBusy(false)
    if (flagError) notify(flagError.code === '23505' ? 'You already flagged this message.' : 'Your report could not be saved. Please try again.')
    else notify('Message flagged for moderator review.')
    setFlagTarget(null)
  }

  async function setHidden(message: ChatMessage, next: boolean) {
    if (!supabase || !isAdmin) return
    const { error: updateError } = await supabase.from('community_messages').update({ is_hidden: next, updated_at: new Date().toISOString() }).eq('id', message.id)
    if (updateError) notify('This moderation action could not be completed. Please try again.')
    else { notify(next ? 'Message hidden from the community.' : 'Message restored.'); await loadMessages(true) }
  }

  async function removeOwnMessage(message: ChatMessage) {
    if (!supabase || message.user_id !== userId) return
    if (!window.confirm('Delete your message? This cannot be undone.')) return
    const { error: deleteError } = await supabase.from('community_messages').delete().eq('id', message.id)
    if (deleteError) notify('The message could not be deleted. Please try again.')
    else { setMessages(current => current.filter(item => item.id !== message.id)); notify('Your message was deleted.') }
  }

  if (!enabled) return <section className="panel community-disabled"><ShieldCheck size={25}/><h2>Community chat is paused</h2><p>An administrator has temporarily disabled public chat. You can still view and manage your civic reports.</p></section>

  return <div className="community-chat-page">
    <section className="chat-heading"><div><div className="section-kicker">PUBLIC COMMUNITY SPACE</div><h1>Talk with your community<span>.</span></h1><p>Share constructive local updates, ask for clarification and coordinate around public civic issues. Do not post phone numbers, addresses of private people, passwords or sensitive documents.</p></div><button className="btn btn-secondary" onClick={() => void loadMessages()} disabled={loading}><RefreshCw size={15}/> Refresh</button></section>
    <div className="chat-safety"><ShieldCheck size={17}/><div><b>Community guidelines</b><span>Be respectful, stick to the issue, avoid personal data and unverified accusations. Messages can be reported and moderated. Chat is not an emergency service.</span></div></div>
    {error && <div className="data-warning"><AlertTriangle size={17}/><div><b>Could not load or send community messages</b><span>{error}</span></div><button className="icon-btn" aria-label="Dismiss error" onClick={() => setError('')}><X size={16}/></button></div>}
    <section className="panel chat-panel">
      <div className="chat-panel-heading"><div className="chat-live-icon"><MessageCircle size={18}/></div><div><b>Neighbourhood conversation</b><small>{messages.filter(m => !m.is_hidden).length} visible messages · updates live when realtime is enabled</small></div><span className="chat-safety-pill"><span className="live-dot"/> Moderated</span></div>
      <div className="chat-messages" aria-live="polite">
        {loading && !messages.length ? <div className="chat-empty"><LoaderCircle size={22} className="spin"/><span>Loading community messages…</span></div> : messages.length === 0 ? <div className="chat-empty"><MessageCircle size={27}/><b>Start a constructive conversation</b><span>No messages yet. Share a useful update or ask a question about local civic issues.</span></div> : messages.map(message => <article className={`chat-message ${message.user_id === userId ? 'own-message' : ''} ${message.is_hidden ? 'hidden-message' : ''}`} key={message.id}>
          <div className="chat-avatar">{(message.author_name || 'C').slice(0, 1).toUpperCase()}</div>
          <div className="chat-message-main"><div className="chat-message-meta"><b>{message.author_name || 'Citizen'}</b><span className={`chat-role-tag role-${String(message.author_role || 'member').toLowerCase().replace(/[^a-z_]/g, '')}`}>{({ super_admin: 'Super admin', admin: 'Admin', moderator: 'Moderator', member: 'Member' } as Record<string, string>)[message.author_role || 'member'] || 'Member'}</span>{message.user_id === userId && <span className="chat-you-tag">You</span>}{message.is_hidden && <span className="chat-hidden-label">Hidden</span>}<time>{formatTime(message.created_at)}</time></div><p>{message.body}</p>{flagTarget === message.id && <form className="chat-flag-form" onSubmit={event => { event.preventDefault(); void flagMessage(message.id) }}><label>Why are you flagging this?<select value={flagReason} onChange={e => setFlagReason(e.target.value)}><option>Spam or repeated promotion</option><option>Harassment or hate</option><option>Personal or sensitive information</option><option>Potentially false or harmful claim</option><option>Other concern</option></select></label><button className="btn btn-primary" type="submit" disabled={flagBusy}>{flagBusy ? 'Sending…' : 'Submit flag'}</button><button className="btn btn-secondary" type="button" onClick={() => setFlagTarget(null)}>Cancel</button></form>}<div className="chat-message-actions">{message.user_id === userId && !message.is_hidden && <button onClick={() => void removeOwnMessage(message)}><Trash2 size={13}/> Delete</button>}{message.user_id !== userId && !message.is_hidden && <button onClick={() => { setFlagTarget(current => current === message.id ? null : message.id); setFlagReason('Spam or repeated promotion') }}><Flag size={13}/> Report message</button>}{isAdmin && <button onClick={() => void setHidden(message, !message.is_hidden)}>{message.is_hidden ? <Check size={13}/> : <X size={13}/>} {message.is_hidden ? 'Restore' : 'Hide message'}</button>}</div></div>
        </article>)}<div ref={bottomRef}/>
      </div>
      <form className="chat-composer" onSubmit={sendMessage}><div className="chat-composer-user"><span className="chat-avatar small">{displayName.slice(0, 1).toUpperCase()}</span><div><b>{displayName}</b><small>Posting publicly</small></div></div><div className="chat-compose-box"><textarea value={body} onChange={e => setBody(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.form?.requestSubmit() } }} placeholder="Write a helpful, respectful message… (Enter to send, Shift+Enter for new line)" maxLength={2000} rows={3} aria-label="Community message" required/><div className="chat-compose-footer"><small>{body.length}/2000 · Keep it constructive</small><button className="btn btn-primary" type="submit" disabled={sending || !body.trim()}>{sending ? <LoaderCircle size={15} className="spin"/> : <Send size={15}/>} Send message</button></div></div></form>
    </section>
  </div>
}
