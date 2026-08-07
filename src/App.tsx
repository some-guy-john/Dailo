import { useEffect, useRef, useState } from 'react'
import { formatLondonDate, getLondonDate } from './game/date'
import { calculateCurrentStreak, calculateMaximumStreak, recordSession } from './game/stats'
import { loadStats, loadTheme, saveSession, saveStats, saveTheme } from './game/storage'
import { createEmptySession, GameServiceError, startGame, submitGuess as submitGuessToService } from './game/service'
import { mergeKeyboardState, MAX_GUESSES, WORD_LENGTH } from './game/rules'
import { createShareText } from './game/share'
import type { GameMode, GameSession, Stats, TileState } from './game/types'

const LETTERS = 'QWERTYUIOPASDFGHJKLZXCVBNM'.split('')
const EMPTY_KEYBOARD: Record<string, TileState> = {}

function App() {
  const [today] = useState(getLondonDate)
  const [mode, setMode] = useState<GameMode>('daily')
  const [stats, setStats] = useState<Stats>(() => loadStats())
  const [session, setSession] = useState<GameSession>(() => createEmptySession('daily', today))
  const [keyboard, setKeyboard] = useState<Record<string, TileState>>(EMPTY_KEYBOARD)
  const [currentGuess, setCurrentGuess] = useState('')
  const [notice, setNotice] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [theme, setTheme] = useState(loadTheme)
  const [showStats, setShowStats] = useState(false)
  const [showTheme, setShowTheme] = useState(false)
  const [showResult, setShowResult] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const startRequestRef = useRef<{ key: string; promise: Promise<GameSession> } | null>(null)
  const resultRef = useRef<HTMLElement>(null)

  const dailyResults = stats.dailyResults
  const currentStreak = calculateCurrentStreak(dailyResults, today)
  const maximumStreak = calculateMaximumStreak(dailyResults)
  const modeLabel = mode === 'daily' ? 'Daily' : 'Unlimited'
  const modeDescription = mode === 'daily'
    ? `${formatLondonDate(today)} · London`
    : 'Practice · no timer'

  useEffect(() => {
    if (!session.sessionToken) return
    saveSession(session)
  }, [session])

  useEffect(() => {
    saveStats(stats)
  }, [stats])

  useEffect(() => {
    document.documentElement.dataset.theme = theme === 'system' ? '' : theme
    saveTheme(theme)
  }, [theme])

  useEffect(() => {
    let cancelled = false
    const requestKey = `${mode}:${today}:${reloadKey}`
    setIsLoading(true)
    setKeyboard(EMPTY_KEYBOARD)
    setCurrentGuess('')
    setNotice('')
    setSession(createEmptySession(mode, today))
    setShowResult(false)

    const request = startRequestRef.current?.key === requestKey
      ? startRequestRef.current.promise
      : startGame(mode, stats, today)

    startRequestRef.current = { key: requestKey, promise: request }

    void request
      .then((nextSession) => {
        if (cancelled) return
        setSession(nextSession)
        setShowResult(nextSession.status !== 'active')
        setIsLoading(false)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        startRequestRef.current = null
        setIsLoading(false)
        setNotice(error instanceof GameServiceError ? error.message : 'The game could not be loaded.')
      })

    return () => { cancelled = true }
  }, [mode, today, reloadKey])

  useEffect(() => {
    if (!showResult) return
    resultRef.current?.focus()
  }, [showResult])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Enter') {
        submitGuess()
      } else if (event.key === 'Backspace' || event.key === 'Delete') {
        removeLetter()
      } else if (/^[a-zA-Z]$/.test(event.key)) {
        addLetter(event.key)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  })

  function addLetter(letter: string) {
    if (session.status !== 'active' || isLoading || !session.sessionToken || currentGuess.length >= WORD_LENGTH) return
    setCurrentGuess((value) => `${value}${letter.toUpperCase()}`)
  }

  function removeLetter() {
    if (session.status !== 'active' || isLoading || !session.sessionToken) return
    setCurrentGuess((value) => value.slice(0, -1))
  }

  async function submitGuess() {
    if (session.status !== 'active' || isSubmitting || isLoading) return
    setIsSubmitting(true)

    try {
      const nextSession = await submitGuessToService(session, currentGuess)
      const lastAttempt = nextSession.attempts[nextSession.attempts.length - 1]
      if (lastAttempt) setKeyboard((value) => mergeKeyboardState(value, lastAttempt.guess, lastAttempt.result))
      setSession(nextSession)
      saveSession(nextSession)
      setCurrentGuess('')

      if (nextSession.status === 'won' || nextSession.status === 'lost') {
        setShowResult(true)
        setStats((currentStats) => recordSession(currentStats, nextSession))
        setNotice(nextSession.status === 'won'
          ? `Solved in ${nextSession.attempts.length} ${nextSession.attempts.length === 1 ? 'guess' : 'guesses'}`
          : nextSession.answer ? `The answer was ${nextSession.answer}` : 'Better luck next time')
      } else {
        setNotice('')
      }
    } catch (error: unknown) {
      setNotice(error instanceof GameServiceError ? error.message : 'The guess could not be submitted.')
    } finally {
      setIsSubmitting(false)
    }
  }

  function startUnlimited() {
    if (mode !== 'unlimited') {
      setMode('unlimited')
      return
    }

    setIsLoading(true)
    setNotice('')
    setShowResult(false)
    void startGame('unlimited', stats, today, true)
      .then((nextSession) => {
        setSession(nextSession)
        saveSession(nextSession)
        setKeyboard(EMPTY_KEYBOARD)
        setCurrentGuess('')
        setShowResult(false)
        setIsLoading(false)
      })
      .catch((error: unknown) => {
        setIsLoading(false)
        setNotice(error instanceof GameServiceError ? error.message : 'The next puzzle could not be loaded.')
      })
  }

  function switchMode(nextMode: GameMode) {
    if (nextMode === mode) return
    setMode(nextMode)
  }

  async function shareResult() {
    const text = createShareText(session)

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        const textarea = document.createElement('textarea')
        textarea.value = text
        textarea.setAttribute('readonly', '')
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        if (!document.execCommand('copy')) throw new Error('copy_failed')
        textarea.remove()
      }
      setNotice('Result copied to clipboard')
    } catch {
      setNotice('Copy is unavailable in this browser')
    }
  }

  function retryLoad() {
    startRequestRef.current = null
    setReloadKey((value) => value + 1)
  }

  const isFinished = session.status !== 'active'
  const isBusy = isLoading || isSubmitting || !session.sessionToken
  const keyboardRows = [LETTERS.slice(0, 10), LETTERS.slice(10, 19), LETTERS.slice(19)]
  const dailyWon = dailyResults[today]?.won
  const hasLoadError = !isLoading && !session.sessionToken
  const statusMessage = isLoading
    ? 'Loading puzzle…'
    : isSubmitting
      ? 'Checking guess…'
      : notice

  return (
    <div className="site-frame">
      <header className="site-header">
        <a className="wordmark" href="#top" aria-label="Dailies home">
          <span className="wordmark-mark" aria-hidden="true">+</span>
          <span>Dailies</span>
        </a>
          <div className="header-actions">
          <button className="text-button" type="button" onClick={() => setShowHelp(true)}>How to play</button>
          <button className="text-button" type="button" onClick={() => setShowStats(true)}>Stats</button>
          <div className="theme-wrap">
            <button className="icon-button" type="button" aria-label="Change appearance" onClick={() => setShowTheme((value) => !value)}>◐</button>
            {showTheme && (
              <div className="theme-menu" role="menu">
                {(['system', 'light', 'dark'] as const).map((option) => (
                  <button key={option} type="button" className={theme === option ? 'selected' : ''} onClick={() => { setTheme(option); setShowTheme(false) }}>
                    {option[0].toUpperCase() + option.slice(1)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      <main id="top" className="main-layout">
        <section className="game-panel" aria-label="Wordle game">
          <nav className="mode-tabs" aria-label="Game mode">
            <button type="button" className={mode === 'daily' ? 'active' : ''} onClick={() => switchMode('daily')}>
              <span>01</span> Daily
            </button>
            <button type="button" className={mode === 'unlimited' ? 'active' : ''} onClick={() => switchMode('unlimited')}>
              <span>∞</span> Unlimited
            </button>
          </nav>

          <div className="game-heading">
            <h1 className="game-title">Wordle</h1>
            <span className="date-stamp">{modeDescription}</span>
          </div>

          <div className="board-wrap">
            <div className="board" data-ready={!isLoading && Boolean(session.sessionToken)} aria-label={`${session.attempts.length} of ${MAX_GUESSES} guesses used`}>
              {Array.from({ length: MAX_GUESSES }).map((_, rowIndex) => {
                const attempt = session.attempts[rowIndex]
                const isCurrentRow = rowIndex === session.attempts.length && session.status === 'active'
                return (
                  <div className={`board-row ${isCurrentRow ? 'current-row' : ''}`} aria-label={`Guess ${rowIndex + 1}`} key={rowIndex}>
                    {Array.from({ length: WORD_LENGTH }).map((_, letterIndex) => {
                      const letter = attempt?.guess[letterIndex] ?? (isCurrentRow ? currentGuess[letterIndex] : '')
                      const state = attempt?.result[letterIndex] ?? 'empty'
                      const stateLabel = state === 'correct' ? 'correct' : state === 'present' ? 'present' : state === 'absent' ? 'absent' : 'empty'
                      return <div className={`tile tile-${state} ${letter ? 'filled' : ''}`} aria-label={`${letter || 'empty'}, ${stateLabel}`} key={letterIndex}>{letter}</div>
                    })}
                  </div>
                )
              })}
            </div>
          </div>

          <div className="game-status" aria-live="polite" role={hasLoadError ? 'alert' : undefined}>
            <span>{statusMessage || '\u00a0'}</span>
            {hasLoadError && <button className="retry-button" type="button" onClick={retryLoad}>Retry</button>}
          </div>

          <div className="keyboard" aria-label="On-screen keyboard">
            {keyboardRows.map((row, rowIndex) => (
              <div className="keyboard-row" key={rowIndex}>
                {rowIndex === 2 && <button className="key key-wide" type="button" onClick={removeLetter} disabled={isBusy || isFinished} aria-label="Backspace">⌫</button>}
                {row.map((letter) => <button key={letter} type="button" className={`key key-${keyboard[letter] ?? 'empty'}`} onClick={() => addLetter(letter)} disabled={isBusy || isFinished} aria-label={`${letter}${keyboard[letter] ? `, ${keyboard[letter]}` : ''}`}>{letter}</button>)}
                {rowIndex === 2 && <button className="key key-wide key-enter" type="button" onClick={submitGuess} disabled={isBusy || isFinished}>Enter</button>}
              </div>
            ))}
          </div>

          {isFinished && !showResult && (
            <button className="result-reopen" type="button" onClick={() => setShowResult(true)}>View result</button>
          )}
        </section>
      </main>

      {showResult && isFinished && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowResult(false)}>
          <section className="result-modal" ref={resultRef} role="dialog" aria-modal="true" aria-labelledby="result-title" tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" type="button" aria-label="Close result" onClick={() => setShowResult(false)}>×</button>
            <p className="eyebrow">{mode === 'daily' ? 'Daily result' : 'Practice result'}</p>
            <h2 id="result-title">{session.status === 'won' ? 'Solved.' : 'Not this time.'}</h2>
            <p className="result-copy">
              {session.status === 'won'
                ? `You found it in ${session.attempts.length} ${session.attempts.length === 1 ? 'guess' : 'guesses'}.`
                : <>The answer was <strong>{session.answer}</strong>.</>}
            </p>
            <div className="result-actions">
              <button className="outline-button" type="button" onClick={shareResult}>Share result</button>
              {mode === 'unlimited' && <button className="solid-button" type="button" onClick={startUnlimited}>Next puzzle <span>→</span></button>}
              {mode === 'daily' && dailyWon && <span className="next-note">Back tomorrow</span>}
            </div>
          </section>
        </div>
      )}

      {showHelp && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowHelp(false)}>
          <section className="help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" type="button" aria-label="Close how to play" onClick={() => setShowHelp(false)}>×</button>
            <p className="eyebrow">Quick guide</p>
            <h2 id="help-title">Find the word in six.</h2>
            <div className="help-list">
              <p><strong>Green</strong> means the letter is correct and in the right place.</p>
              <p><strong>Yellow</strong> means the letter belongs somewhere else.</p>
              <p><strong>Grey</strong> means it is not in the word.</p>
            </div>
            <div className="help-note">
              <span>Daily resets at midnight</span>
              <strong>Europe / London</strong>
              <span>Stats stay in this browser. No account is required.</span>
            </div>
          </section>
        </div>
      )}

      {showStats && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowStats(false)}>
          <section className="stats-modal" role="dialog" aria-modal="true" aria-labelledby="stats-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" type="button" aria-label="Close statistics" onClick={() => setShowStats(false)}>×</button>
            <p className="eyebrow">Your record</p>
            <h2 id="stats-title">A little consistency<br />goes a long way.</h2>
            <div className="stats-grid">
              <Stat label="Current streak" value={currentStreak} />
              <Stat label="Daily played" value={Object.keys(stats.dailyResults).length} />
              <Stat label="Daily wins" value={Object.values(stats.dailyResults).filter((result) => result.won).length} />
              <Stat label="Best streak" value={maximumStreak} />
              <Stat label="Practice wins" value={stats.unlimitedResults.filter((result) => result.won).length} />
            </div>
            <p className="modal-footnote">Statistics are stored locally in this browser.</p>
          </section>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="modal-stat"><strong>{value}</strong><span>{label}</span></div>
}

export default App
