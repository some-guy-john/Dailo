import { useEffect, useRef, useState } from 'react'
import { mergeKeyboardState, MAX_GUESSES, WORD_LENGTH } from '../game/rules'
import type { TileState } from '../game/types'
import { concedeVersus, createVersus, getVersusState, joinVersus, submitVersusGuess, VersusServiceError } from './service'
import { loadVersusMatch, saveVersusMatch } from './storage'
import type { VersusRoute } from './routing'
import { versusHash } from './routing'
import type { VersusMatch } from './types'

const ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM']

function validName(name: string) {
  return /^[A-Za-z0-9][A-Za-z0-9 _-]{0,14}[A-Za-z0-9]$/.test(name.trim())
}

function Board({ match, guess }: { match: VersusMatch; guess: string }) {
  return <div className="versus-board" aria-label={`${match.attempts.length} of 6 guesses used`}>
    {Array.from({ length: MAX_GUESSES }, (_, row) => {
      const attempt = match.attempts[row]
      const letters = attempt?.guess ?? (row === match.attempts.length ? guess : '')
      return <div className="board-row" key={row}>{Array.from({ length: WORD_LENGTH }, (_, column) => (
        <div className="tile" data-state={attempt?.result[column] ?? undefined} key={column}>{letters[column] ?? ''}</div>
      ))}</div>
    })}
  </div>
}

function OpponentRows({ match }: { match: VersusMatch }) {
  return <div className="opponent-progress" aria-label={`${match.opponentName ?? 'Opponent'} progress`}>
    <strong>{match.opponentName ?? 'Waiting for opponent'}</strong>
    <div>{match.opponentRows.map((row, index) => <span className="opponent-row" key={index}>{row.map((state, tile) => <i data-state={state} key={tile} />)}</span>)}</div>
    <small>{match.opponentStatus ?? 'Not joined'}</small>
  </div>
}

export function VersusScreen({ route, onRoute }: { route: VersusRoute; onRoute: (route: VersusRoute) => void }) {
  const [name, setName] = useState('')
  const [match, setMatch] = useState<VersusMatch | null>(null)
  const [inviteToken, setInviteToken] = useState(route.kind === 'invite' ? route.inviteToken : '')
  const [guess, setGuess] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [copyLabel, setCopyLabel] = useState('Copy invite')
  const pendingIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (route.kind !== 'match') return
    const saved = loadVersusMatch(route.publicKey)
    if (!saved) {
      setNotice('This browser does not have a participant session for that match.')
      return
    }
    setMatch(saved)
    void getVersusState(saved.participantToken).then((nextState) => {
      const next = { ...nextState, inviteToken: saved.inviteToken }
      setMatch(next); setInviteToken(next.inviteToken ?? ''); saveVersusMatch(next)
    }).catch((error: unknown) => {
      setNotice(error instanceof VersusServiceError ? error.message : 'The match could not be restored.')
    })
  }, [route])

  useEffect(() => {
    if (!match || !['waiting', 'active'].includes(match.status)) return
    const refresh = () => void getVersusState(match.participantToken).then((nextState) => {
      const next = { ...nextState, inviteToken: match.inviteToken }
      setMatch(next); saveVersusMatch(next)
    }).catch(() => {})
    const interval = window.setInterval(refresh, 3000)
    window.addEventListener('focus', refresh)
    return () => { window.clearInterval(interval); window.removeEventListener('focus', refresh) }
  }, [match?.participantToken, match?.status])

  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (!match || match.status !== 'active' || match.playerStatus !== 'playing' || busy || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === 'Enter') void submit()
      else if (event.key === 'Backspace' || event.key === 'Delete') setGuess((value) => value.slice(0, -1))
      else if (/^[A-Za-z]$/.test(event.key)) setGuess((value) => value.length < WORD_LENGTH ? value + event.key.toUpperCase() : value)
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  })

  async function create() {
    if (!validName(name) || busy) { setNotice('Use 2–16 letters, numbers, spaces, hyphens, or underscores.'); return }
    setBusy(true); setNotice('')
    try {
      const created = await createVersus(name.trim())
      const next = { ...created.match, inviteToken: created.inviteToken }
      setMatch(next); setInviteToken(created.inviteToken); saveVersusMatch(next)
      onRoute({ kind: 'match', publicKey: created.match.publicKey })
    } catch (error) { setNotice(error instanceof VersusServiceError ? error.message : 'The match could not be created.') }
    finally { setBusy(false) }
  }

  async function join() {
    if (!validName(name) || busy) { setNotice('Use 2–16 letters, numbers, spaces, hyphens, or underscores.'); return }
    setBusy(true); setNotice('')
    try {
      const joined = await joinVersus(inviteToken, name.trim())
      setMatch(joined); saveVersusMatch(joined); onRoute({ kind: 'match', publicKey: joined.publicKey })
    } catch (error) { setNotice(error instanceof VersusServiceError ? error.message : 'The invitation could not be joined.') }
    finally { setBusy(false) }
  }

  async function copyInvite() {
    const url = `${window.location.href.split('#')[0]}${versusHash({ kind: 'invite', inviteToken })}`
    try { await navigator.clipboard.writeText(url); setCopyLabel('Copied') } catch { setCopyLabel('Copy unavailable') }
    window.setTimeout(() => setCopyLabel('Copy invite'), 1600)
  }

  async function submit() {
    if (!match || guess.length !== WORD_LENGTH || busy) { if (guess.length < WORD_LENGTH) setNotice('Not enough letters'); return }
    const submitted = guess
    const idempotencyKey = pendingIdRef.current ?? crypto.randomUUID()
    pendingIdRef.current = idempotencyKey
    setBusy(true); setNotice('')
    try {
      const next = await submitVersusGuess(match, submitted, idempotencyKey)
      pendingIdRef.current = null; setMatch(next); saveVersusMatch(next); setGuess('')
    } catch (error) { setNotice(error instanceof VersusServiceError ? error.message : 'The guess could not be submitted.') }
    finally { setBusy(false) }
  }

  async function concede() {
    if (!match || busy || !window.confirm('Concede this match?')) return
    setBusy(true)
    try { const next = await concedeVersus(match); setMatch(next); saveVersusMatch(next) }
    catch (error) { setNotice(error instanceof VersusServiceError ? error.message : 'The match could not be conceded.') }
    finally { setBusy(false) }
  }

  if (!match) return <section className="screen versus-screen" aria-label="Wordo Versus"><div className="versus-intro">
    <span>{route.kind === 'invite' ? 'Private invitation' : 'Private match'}</span>
    <h2>{route.kind === 'invite' ? 'You’ve been challenged' : route.kind === 'match' ? 'Match unavailable' : 'Wordo, head to head'}</h2>
    {route.kind !== 'match' && <><p>{route.kind === 'invite' ? 'Choose a display name, then explicitly claim the second seat.' : 'Create an untimed match and share one private invitation.'}</p>
      <label className="versus-name">Display name<input value={name} maxLength={16} onChange={(event) => setName(event.target.value)} autoComplete="nickname" /></label>
      <button className="primary-button" type="button" disabled={busy} onClick={() => void (route.kind === 'invite' ? join() : create())}>{route.kind === 'invite' ? 'Join match' : 'Create match'}</button></>}
    {notice && <p className="connections-feedback" role="alert">{notice}</p>}
  </div></section>

  const keyboard = match.attempts.reduce((current, attempt) => mergeKeyboardState(current, attempt.guess, attempt.result), {} as Record<string, TileState>)
  const playing = match.status === 'active' && match.playerStatus === 'playing'
  const terminal = ['completed', 'expired', 'cancelled'].includes(match.status)
  return <section className="screen versus-game-screen" aria-label="Wordo Versus match">
    <div className="versus-match-head"><div><span>{match.status === 'waiting' ? 'Waiting room' : terminal ? 'Final result' : 'Private match'}</span><h2>{terminal ? match.outcome === 'win' ? 'You won' : match.outcome === 'loss' ? 'Opponent won' : match.outcome === 'draw' ? 'Draw' : 'Match expired' : `${match.playerName} vs ${match.opponentName ?? '…'}`}</h2></div>
      {match.status === 'waiting' && <button className="primary-button" type="button" disabled={!inviteToken} onClick={() => void copyInvite()}>{copyLabel}</button>}
      {playing && <button className="secondary-button" type="button" onClick={() => void concede()}>Concede</button>}
    </div>
    <div className="versus-play-area"><div><Board match={match} guess={guess} />{notice && <p className="connections-feedback" role="status">{notice}</p>}</div><OpponentRows match={match} /></div>
    {terminal && <div className="versus-result"><b>{match.answer ? `The word was ${match.answer}.` : 'The match ended.'}</b><button className="primary-button" type="button" onClick={() => { setMatch(null); setInviteToken(''); setName(''); onRoute({ kind: 'create' }) }}>New match</button></div>}
    {playing && <div className="keyboard versus-keyboard" aria-label="On-screen keyboard">{ROWS.map((row, index) => <div className="keyboard-row" data-indent={index === 1} key={row}>{index === 2 && <button className="key key-wide" type="button" onClick={() => void submit()}>Enter</button>}{[...row].map((letter) => <button className="key" data-state={keyboard[letter]} type="button" key={letter} onClick={() => setGuess((value) => value.length < WORD_LENGTH ? value + letter : value)}>{letter}</button>)}{index === 2 && <button className="key key-wide" type="button" aria-label="Backspace" onClick={() => setGuess((value) => value.slice(0, -1))}>⌫</button>}</div>)}</div>}
  </section>
}
