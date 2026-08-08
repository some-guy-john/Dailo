import { useEffect, useState } from 'react'
import { AdminError, createConnectionsDraft, loadAdminOverview, publishConnectionsDraft, type AdminOverview } from './service'

const template = JSON.stringify({ date: '2026-08-09', groups: [
  { key: 'group-one', label: 'Group one', difficulty: 1, words: ['WORD A', 'WORD B', 'WORD C', 'WORD D'] },
  { key: 'group-two', label: 'Group two', difficulty: 2, words: ['WORD E', 'WORD F', 'WORD G', 'WORD H'] },
  { key: 'group-three', label: 'Group three', difficulty: 3, words: ['WORD I', 'WORD J', 'WORD K', 'WORD L'] },
  { key: 'group-four', label: 'Group four', difficulty: 4, words: ['WORD M', 'WORD N', 'WORD O', 'WORD P'] },
] }, null, 2)

export function AdminScreen() {
  const [overview, setOverview] = useState<AdminOverview | null>(null)
  const [source, setSource] = useState(template)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  function refresh() {
    setNotice('')
    void loadAdminOverview().then(setOverview).catch((error: unknown) => setNotice(error instanceof AdminError ? error.message : 'Admin data could not be loaded.'))
  }
  useEffect(refresh, [])

  async function createDraft() {
    setBusy(true); setNotice('')
    try { await createConnectionsDraft(JSON.parse(source)); setNotice('Connections draft created. Review it before publishing.'); refresh() }
    catch (error) { setNotice(error instanceof SyntaxError ? 'The puzzle JSON is invalid.' : error instanceof AdminError ? error.message : 'The draft could not be created.') }
    finally { setBusy(false) }
  }

  async function publish(date: string) {
    if (!window.confirm(`Publish the reviewed Connections puzzle for ${date}?`)) return
    setBusy(true); setNotice('')
    try { await publishConnectionsDraft(date); setNotice(`Published ${date}.`); refresh() }
    catch (error) { setNotice(error instanceof AdminError ? error.message : 'The draft could not be published.') }
    finally { setBusy(false) }
  }

  return <section className="screen admin-screen" aria-label="Puzzle administration"><div className="admin-shell">
    <div className="admin-heading"><span>Puzzle operations</span><h2>Dailo Admin</h2><p>Environment: <b>{overview?.environment ?? 'checking…'}</b></p></div>
    {notice && <p className="account-message" role="status">{notice}</p>}
    {overview && <div className="admin-columns">
      <div><h3>Connections schedule</h3>{overview.connections.map((item) => <div className="admin-row" key={item.london_date}><span>{item.london_date}</span><b>{item.status}</b>{item.status === 'draft' && <button type="button" disabled={busy} onClick={() => void publish(item.london_date)}>Publish</button>}</div>)}</div>
      <div><h3>Wordo schedule</h3>{overview.wordo.map((item) => <div className="admin-row" key={item.london_date}><span>{item.london_date}</span><b>{item.status}</b></div>)}</div>
    </div>}
    <div className="admin-editor"><h3>Create Connections draft</h3><p>Validation runs again on the protected server. Existing dates and published content are never replaced.</p><textarea value={source} onChange={(event) => setSource(event.target.value)} spellCheck={false} /><button className="primary-button" type="button" disabled={busy} onClick={() => void createDraft()}>Validate and create draft</button></div>
    {overview && <div className="admin-audit"><h3>Recent audit</h3>{overview.audit.map((item) => <div key={`${item.created_at}:${item.entity_key}`}><span>{item.action} {item.entity_type} {item.entity_key}</span><time>{new Date(item.created_at).toLocaleString()}</time></div>)}</div>}
  </div></section>
}
