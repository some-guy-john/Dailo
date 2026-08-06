import { useEffect, useState } from 'react'
import { formatLondonDate, getLondonDate } from './game/date'
import { calculateCurrentStreak, calculateMaximumStreak, recordSession } from './game/stats'
import { loadStats, loadTheme, saveSession, saveStats, saveTheme } from './game/storage'
import { GameServiceError, getLocalInitialSession, startGame, submitGuess as submitGuessToService } from './game/service'
import { mergeKeyboardState, MAX_GUESSES, WORD_LENGTH } from './game/rules'
import { createShareText } from './game/share'
import type { GameMode, GameSession, Stats, TileState } from './game/types'

const LETTERS = 'QWERTYUIOPASDFGHJKLZXCVBNM'.split('')
const EMPTY_KEYBOARD: Record<string, TileState> = {}

function App() {
  const [today] = useState(getLondonDate)
  const [mode, setMode] = useState<GameMode>('daily')
  const [stats, setStats] = useState<Stats>(() => loadStats())
  const [session, setSession] = useState<GameSession>(() => getLocalInitialSession('daily', loadStats(), today))
  const [keyboard, setKeyboard] = useState<Record<string, TileState>>(EMPTY_KEYBOARD)
  const [currentGuess, setCurrentGuess] = useState('')
  const [notice, setNotice] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [theme, setTheme] = useState(loadTheme)
  const [showStats, setShowStats] = useState(false)
  const [showTheme, setShowTheme] = useState(false)

  const dailyResults = stats.dailyResults
  const currentStreak = calculateCurrentStreak(dailyResults, today)
  const maximumStreak = calculateMaximumStreak(dailyResults)
  const modeLabel = mode === 'daily' ? 'Daily dispatch' : 'Unlimited practice'
  const modeDescription = mode === 'daily'
    ? `One shared puzzle · ${formatLondonDate(today)}`
    : 'Curated puzzles · no clock'

  useEffect(() => {
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
    setIsLoading(true)
    setKeyboard(EMPTY_KEYBOARD)
    setCurrentGuess('')
    setNotice('')

    void startGame(mode, stats, today)
      .then((nextSession) => {
        if (cancelled) return
        setSession(nextSession)
        setIsLoading(false)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setIsLoading(false)
        setNotice(error instanceof GameServiceError ? error.message : 'The game could not be loaded.')
      })

    return () => { cancelled = true }
  }, [mode, today])

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
    if (session.status !== 'active' || currentGuess.length >= WORD_LENGTH) return
    setCurrentGuess((value) => `${value}${letter.toUpperCase()}`)
  }

  function removeLetter() {
    if (session.status !== 'active') return
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
      setCurrentGuess('')

      if (nextSession.status === 'won' || nextSession.status === 'lost') {
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
    void startGame('unlimited', stats, today, true)
      .then((nextSession) => {
        setSession(nextSession)
        setKeyboard(EMPTY_KEYBOARD)
        setCurrentGuess('')
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
      await navigator.clipboard.writeText(text)
      setNotice('Result copied to clipboard')
    } catch {
      setNotice('Copy is unavailable in this browser')
    }
  }

  const isFinished = session.status !== 'active'
  const keyboardRows = [LETTERS.slice(0, 10), LETTERS.slice(10, 19), LETTERS.slice(19)]
  const dailyWon = dailyResults[today]?.won

  return (
    <div className="site-frame">
      <header className="site-header">
        <a className="wordmark" href="#top" aria-label="Dailies home">
          <span className="wordmark-mark" aria-hidden="true">+</span>
          <span>Dailies</span>
        </a>
        <div className="header-actions">
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
        <aside className="dispatch-panel">
          <div>
            <p className="eyebrow">A small word ritual</p>
            <h1>Make a little room<br />for a good word.</h1>
            <p className="intro-copy">A daily puzzle, a quiet minute, and just enough friction to make the answer feel earned.</p>
          </div>

          <div className="dispatch-note">
            <span className="dispatch-dot" aria-hidden="true" />
            <div>
              <p className="eyebrow">Today’s dispatch</p>
              <strong>{formatLondonDate(today)}</strong>
              <span>New puzzle at midnight London time</span>
            </div>
          </div>

          <div className="streak-card">
            <div>
              <span className="stat-number">{currentStreak}</span>
              <span className="stat-label">current<br />streak</span>
            </div>
            <div className="streak-line" aria-hidden="true">
              <span className={dailyWon ? 'active' : ''} />
              <span />
              <span />
              <span />
              <span />
            </div>
            <p>Keep the chain going<br />one day at a time.</p>
          </div>

          <p className="fine-print">Your progress stays in this browser for now. No account, no fuss.</p>
        </aside>

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
            <div>
              <p className="eyebrow">{modeLabel}</p>
              <h2>Find the five.</h2>
            </div>
            <span className="date-stamp">{modeDescription}</span>
          </div>

          <div className="board-wrap">
            <div className="board" aria-label={`${session.attempts.length} of ${MAX_GUESSES} guesses used`}>
              {Array.from({ length: MAX_GUESSES }).map((_, rowIndex) => {
                const attempt = session.attempts[rowIndex]
                const isCurrentRow = rowIndex === session.attempts.length && session.status === 'active'
                return (
                  <div className={`board-row ${isCurrentRow ? 'current-row' : ''}`} key={rowIndex}>
                    {Array.from({ length: WORD_LENGTH }).map((_, letterIndex) => {
                      const letter = attempt?.guess[letterIndex] ?? (isCurrentRow ? currentGuess[letterIndex] : '')
                      const state = attempt?.result[letterIndex] ?? 'empty'
                      return <div className={`tile tile-${state} ${letter ? 'filled' : ''}`} key={letterIndex}>{letter}</div>
                    })}
                  </div>
                )
              })}
            </div>
          </div>

          <p className="notice" aria-live="polite">{notice || '\u00a0'}</p>

          <div className="keyboard" aria-label="On-screen keyboard">
            {keyboardRows.map((row, rowIndex) => (
              <div className="keyboard-row" key={rowIndex}>
                {rowIndex === 2 && <button className="key key-wide" type="button" onClick={removeLetter} aria-label="Backspace">⌫</button>}
                {row.map((letter) => <button key={letter} type="button" className={`key key-${keyboard[letter] ?? 'empty'}`} onClick={() => addLetter(letter)}>{letter}</button>)}
                {rowIndex === 2 && <button className="key key-wide key-enter" type="button" onClick={submitGuess}>Enter</button>}
              </div>
            ))}
          </div>

          {isFinished && (
            <div className="result-tray">
              <div>
                <span className="eyebrow">{session.status === 'won' ? 'Nicely done' : 'The word was'}</span>
                <strong>{session.status === 'won' ? `${session.attempts.length} / 6` : session.answer}</strong>
              </div>
              <div className="result-actions">
                <button className="outline-button" type="button" onClick={shareResult}>Share result</button>
                {mode === 'unlimited' && <button className="solid-button" type="button" onClick={startUnlimited}>Next puzzle <span>→</span></button>}
                {mode === 'daily' && dailyWon && <span className="next-note">Back tomorrow</span>}
              </div>
            </div>
          )}
        </section>
      </main>

      <footer className="site-footer">
        <span>Built for the space between busy things.</span>
        <span>Release 0.1 / local play</span>
      </footer>

      {showStats && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowStats(false)}>
          <section className="stats-modal" role="dialog" aria-modal="true" aria-labelledby="stats-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" type="button" aria-label="Close statistics" onClick={() => setShowStats(false)}>×</button>
            <p className="eyebrow">Your record</p>
            <h2 id="stats-title">A little consistency<br />goes a long way.</h2>
            <div className="stats-grid">
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
