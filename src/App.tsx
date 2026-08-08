import { useEffect, useRef, useState } from 'react'
import { formatCountdown, formatLondonDate, getLondonDate, getMillisecondsUntilLondonMidnight } from './game/date'
import { calculateCurrentStreak, calculateMaximumStreak, recordConnectionsSession, recordSession } from './game/stats'
import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  loadStats,
  loadTheme,
  saveConnectionsSession,
  savePreferences,
  saveSession,
  saveStats,
  saveTheme,
} from './game/storage'
import { createEmptySession, GameServiceError, getArchiveStats, getConnectionsArchiveStats, getConnectionsStats, listArchivePuzzles, listConnectionsArchive, startConnections, startGame, submitConnections, submitGuess as submitGuessToService } from './game/service'
import type { ArchiveStats, ConnectionsArchiveStats, ConnectionsStats } from './game/service'
import { mergeKeyboardState, MAX_GUESSES, WORD_LENGTH } from './game/rules'
import { createConnectionsShareText, createShareText } from './game/share'
import type { ConnectionsSession, GameMode, GameSession, Stats, TileState } from './game/types'
import { getAuthRedirectUrl, supabase } from './lib/supabase'
import type { User } from '@supabase/supabase-js'
import { parseVersusRoute, versusHash, type VersusRoute } from './versus/routing'
import { VersusScreen } from './versus/VersusScreen'

const KEYBOARD_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM']
const EMPTY_KEYBOARD: Record<string, TileState> = {}
const PRAISE = ['Genius', 'Magnificent', 'Impressive', 'Splendid', 'Great', 'Phew']

type Screen = 'play' | 'games' | 'archive' | 'connections' | 'versus'
type Dialog = 'stats' | 'help' | 'settings' | 'account' | null
type AuthMode = 'signin' | 'signup' | 'reset' | 'update'

function App() {
  const initialVersusRoute = typeof window === 'undefined' ? null : parseVersusRoute(window.location.hash)
  const [today, setToday] = useState(getLondonDate)
  const [mode, setMode] = useState<GameMode>('daily')
  const [screen, setScreen] = useState<Screen>(initialVersusRoute ? 'versus' : 'play')
  const [versusRoute, setVersusRoute] = useState<VersusRoute | null>(initialVersusRoute)
  const [archiveDate, setArchiveDate] = useState<string | null>(null)
  const [archivePuzzles, setArchivePuzzles] = useState<Awaited<ReturnType<typeof listArchivePuzzles>>>([])
  const [archiveLoading, setArchiveLoading] = useState(false)
  const [archiveError, setArchiveError] = useState('')
  const [archiveAuthRequired, setArchiveAuthRequired] = useState(false)
  const [archiveStats, setArchiveStats] = useState<ArchiveStats>({ played: 0, wins: 0, distribution: [] })
  const [archiveStatsLoaded, setArchiveStatsLoaded] = useState(false)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [user, setUser] = useState<User | null>(null)
  const [authMode, setAuthMode] = useState<AuthMode>('signin')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authNotice, setAuthNotice] = useState('')
  const [authError, setAuthError] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [isRecovery, setIsRecovery] = useState(false)
  const [stats, setStats] = useState<Stats>(() => loadStats())
  const [session, setSession] = useState<GameSession>(() => createEmptySession('daily', today))
  const [connectionsSession, setConnectionsSession] = useState<ConnectionsSession | null>(null)
  const [connectionsSelected, setConnectionsSelected] = useState<string[]>([])
  const [connectionsNotice, setConnectionsNotice] = useState('')
  const [connectionsLoading, setConnectionsLoading] = useState(false)
  const [connectionsSubmitting, setConnectionsSubmitting] = useState(false)
  const [connectionsReloadKey, setConnectionsReloadKey] = useState(0)
  const [connectionsArchiveDate, setConnectionsArchiveDate] = useState<string | null>(null)
  const [connectionsArchiveOpen, setConnectionsArchiveOpen] = useState(false)
  const [connectionsArchivePuzzles, setConnectionsArchivePuzzles] = useState<Awaited<ReturnType<typeof listConnectionsArchive>>>([])
  const [connectionsArchiveStats, setConnectionsArchiveStats] = useState<ConnectionsArchiveStats>({ played: 0, wins: 0, mistakeDistribution: [] })
  const [connectionsCloudStats, setConnectionsCloudStats] = useState<ConnectionsStats>({ dailyResults: {} })
  const [connectionsCloudStatsLoaded, setConnectionsCloudStatsLoaded] = useState(false)
  const [keyboard, setKeyboard] = useState<Record<string, TileState>>(EMPTY_KEYBOARD)
  const [currentGuess, setCurrentGuess] = useState('')
  const [pendingGuess, setPendingGuess] = useState('')
  const [notice, setNotice] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [theme, setTheme] = useState(loadTheme)
  const [preferences, setPreferences] = useState(() => (typeof window === 'undefined' ? DEFAULT_PREFERENCES : loadPreferences()))
  const [invalidRow, setInvalidRow] = useState(-1)
  const [revealRow, setRevealRow] = useState(-1)
  const [dailyNeedsAdvance, setDailyNeedsAdvance] = useState(false)
  const [dailyCountdown, setDailyCountdown] = useState(() => formatCountdown(getMillisecondsUntilLondonMidnight()))
  const [reloadKey, setReloadKey] = useState(0)
  const [shareLabel, setShareLabel] = useState('Share')
  const startRequestRef = useRef<{ key: string; promise: Promise<GameSession> } | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const dialogOpenerRef = useRef<HTMLElement | null>(null)
  const noticeTimerRef = useRef<number | undefined>(undefined)
  const connectionsGridRef = useRef<HTMLDivElement>(null)

  const dailyResults = stats.dailyResults
  const currentStreak = calculateCurrentStreak(dailyResults, today)
  const maximumStreak = calculateMaximumStreak(dailyResults)
  const dailyPlayed = Object.keys(dailyResults).length
  const dailyWins = Object.values(dailyResults).filter((result) => result.won).length
  const winPercentage = dailyPlayed === 0 ? 0 : Math.round((dailyWins / dailyPlayed) * 100)
  const distribution = countDistribution(stats)
  const unlimitedPlayed = stats.unlimitedResults.length
  const unlimitedWins = stats.unlimitedResults.filter((result) => result.won).length
  const unlimitedWinPercentage = unlimitedPlayed === 0 ? 0 : Math.round((unlimitedWins / unlimitedPlayed) * 100)
  const unlimitedDistribution = countGuessDistribution(stats.unlimitedResults)
  const displayedDistribution = mode === 'unlimited' ? unlimitedDistribution : distribution
  const displayedBestBucket = Math.max(1, ...displayedDistribution)
  const isFinished = session.status !== 'active'
  const isBusy = isLoading || isSubmitting || !session.sessionToken
  const hasLoadError = !isLoading && !session.sessionToken
  const archivePlayed = stats.archiveResults.length
  const archiveWins = stats.archiveResults.filter((result) => result.won).length
  const archiveWinPercentage = archivePlayed === 0 ? 0 : Math.round((archiveWins / archivePlayed) * 100)
  const displayedArchivePlayed = archiveStatsLoaded ? archiveStats.played : archivePlayed
  const displayedArchiveWins = archiveStatsLoaded ? archiveStats.wins : archiveWins
  const connectionsDeviceResults = stats.connectionsDailyResults
  const connectionsResults = user && connectionsCloudStatsLoaded ? connectionsCloudStats.dailyResults : connectionsDeviceResults
  const connectionsPlayed = Object.keys(connectionsResults).length
  const connectionsWins = Object.values(connectionsResults).filter((result) => result.won).length
  const connectionsWinPercentage = connectionsPlayed === 0 ? 0 : Math.round((connectionsWins / connectionsPlayed) * 100)
  const connectionsCurrentStreak = calculateCurrentStreak(connectionsResults, today)
  const connectionsMaximumStreak = calculateMaximumStreak(connectionsResults)
  const connectionsMistakeDistribution = Array.from({ length: 5 }, (_, mistakes) => (
    Object.values(connectionsResults).filter((result) => result.won && result.mistakes === mistakes).length
  ))
  const showingConnectionsArchiveStats = connectionsArchiveOpen || connectionsSession?.mode === 'archive'
  const displayedConnectionsPlayed = showingConnectionsArchiveStats ? connectionsArchiveStats.played : connectionsPlayed
  const displayedConnectionsWins = showingConnectionsArchiveStats ? connectionsArchiveStats.wins : connectionsWins
  const displayedConnectionsWinPercentage = displayedConnectionsPlayed === 0 ? 0 : Math.round((displayedConnectionsWins / displayedConnectionsPlayed) * 100)
  const displayedConnectionsDistribution = showingConnectionsArchiveStats ? connectionsArchiveStats.mistakeDistribution : connectionsMistakeDistribution

  useEffect(() => {
    if (!session.sessionToken) return
    saveSession(session)
  }, [session])

  useEffect(() => { saveStats(stats) }, [stats])

  useEffect(() => {
    document.documentElement.dataset.theme = theme === 'system' ? '' : theme
    saveTheme(theme)
  }, [theme])

  useEffect(() => { savePreferences(preferences) }, [preferences])

  useEffect(() => {
    const syncRoute = () => {
      const route = parseVersusRoute(window.location.hash)
      setVersusRoute(route)
      if (route) setScreen('versus')
    }
    window.addEventListener('hashchange', syncRoute)
    return () => window.removeEventListener('hashchange', syncRoute)
  }, [])

  useEffect(() => {
    const updateCountdown = () => setDailyCountdown(formatCountdown(getMillisecondsUntilLondonMidnight()))
    const interval = window.setInterval(updateCountdown, 15_000)
    updateCountdown()
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    const checkLondonDate = () => {
      const nextDate = getLondonDate()
      setToday((currentDate) => currentDate === nextDate ? currentDate : nextDate)
    }
    const interval = window.setInterval(checkLondonDate, 15_000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    if (screen !== 'archive') return
    let cancelled = false
    setArchiveLoading(true)
    setArchiveError('')
    setArchiveAuthRequired(false)
    void listArchivePuzzles()
      .then((puzzles) => {
        if (cancelled) return
        setArchivePuzzles(puzzles)
        setArchiveLoading(false)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setArchiveLoading(false)
        setArchiveAuthRequired(error instanceof GameServiceError && (error.code === 'archive_auth_required' || error.code === 'archive_email_unconfirmed'))
        setArchiveError(error instanceof GameServiceError ? error.message : 'The archive could not be loaded.')
      })
    return () => { cancelled = true }
  }, [screen, user?.id])

  useEffect(() => {
    if (!user) {
      setArchiveStatsLoaded(false)
      setConnectionsCloudStatsLoaded(false)
      return
    }
    let cancelled = false
    void getArchiveStats()
      .then((nextStats) => {
        if (cancelled) return
        setArchiveStats(nextStats)
        setArchiveStatsLoaded(true)
      })
      .catch(() => {
        if (!cancelled) setArchiveStatsLoaded(false)
      })
    void getConnectionsStats().then((nextStats) => {
      if (cancelled) return
      setConnectionsCloudStats(nextStats)
      setConnectionsCloudStatsLoaded(true)
    }).catch(() => {
      if (!cancelled) setConnectionsCloudStatsLoaded(false)
    })
    return () => { cancelled = true }
  }, [user?.id])

  useEffect(() => {
    if (!supabase) return
    let active = true
    void supabase.auth.getSession().then(({ data }) => {
      if (active) setUser(data.session?.user ?? null)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((event, sessionState) => {
      setUser(sessionState?.user ?? null)
      if (event === 'PASSWORD_RECOVERY') {
        setIsRecovery(true)
        setAuthMode('update')
        setDialog('account')
      }
    })
    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    if (screen !== 'play') return () => { cancelled = true }
    const gameDate = mode === 'archive' ? archiveDate : today
    if (mode === 'archive' && !gameDate) return () => { cancelled = true }
    const requestKey = `${mode}:${gameDate}:${reloadKey}`

    const continuingPreviousDaily = mode === 'daily'
      && session.mode === 'daily'
      && session.status === 'active'
      && session.date !== null
      && session.date !== today
      && session.attempts.length > 0

    if (continuingPreviousDaily) {
      setIsLoading(false)
      setNotice('Finish yesterday’s puzzle before starting today’s.')
      setDailyNeedsAdvance(true)
      return () => { cancelled = true }
    }

    setIsLoading(true)
    setDailyNeedsAdvance(false)
    setKeyboard(EMPTY_KEYBOARD)
    setCurrentGuess('')
    setPendingGuess('')
    setNotice('')
    setRevealRow(-1)
    setSession(createEmptySession(mode, gameDate ?? today))

    const request = startRequestRef.current?.key === requestKey
      ? startRequestRef.current.promise
      : startGame(mode, stats, gameDate ?? today)

    startRequestRef.current = { key: requestKey, promise: request }

    void request
      .then((nextSession) => {
        if (cancelled) return
        setSession(nextSession)
        setKeyboard(nextSession.attempts.reduce(
          (current, attempt) => mergeKeyboardState(current, attempt.guess, attempt.result),
          EMPTY_KEYBOARD,
        ))
        setIsLoading(false)
        if (nextSession.status !== 'active' && mode !== 'unlimited') setDialog('stats')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        startRequestRef.current = null
        setIsLoading(false)
        setNotice(error instanceof GameServiceError ? error.message : 'The game could not be loaded.')
      })

    return () => { cancelled = true }
  }, [mode, today, archiveDate, reloadKey, screen])

  useEffect(() => {
    if (screen !== 'connections' || connectionsArchiveOpen) return
    let cancelled = false
    setConnectionsLoading(true)
    setConnectionsSession(null)
    setConnectionsSelected([])
    setConnectionsNotice('')
    const date = connectionsArchiveDate ?? today
    const connectionsMode = connectionsArchiveDate ? 'archive' : 'daily'
    void startConnections(date, false, connectionsMode)
      .then((nextSession) => {
        if (cancelled) return
        setConnectionsSession(nextSession)
        saveConnectionsSession(nextSession)
        if (nextSession.status !== 'active') setStats((currentStats) => recordConnectionsSession(currentStats, nextSession))
        setConnectionsLoading(false)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setConnectionsLoading(false)
        setConnectionsNotice(error instanceof GameServiceError ? error.message : 'Connections could not be loaded.')
      })
    return () => { cancelled = true }
  }, [screen, today, user?.id, connectionsArchiveDate, connectionsArchiveOpen, connectionsReloadKey])

  useEffect(() => {
    if (screen !== 'connections' || !connectionsArchiveOpen) return
    setConnectionsLoading(true)
    setConnectionsNotice('')
    void Promise.all([listConnectionsArchive(), getConnectionsArchiveStats()]).then(([puzzles, archiveStats]) => {
      setConnectionsArchivePuzzles(puzzles)
      setConnectionsArchiveStats(archiveStats)
      setConnectionsLoading(false)
    }).catch((error: unknown) => {
      setConnectionsLoading(false)
      setConnectionsNotice(error instanceof GameServiceError ? error.message : 'Connections Archive could not be loaded.')
    })
  }, [screen, connectionsArchiveOpen, user?.id, connectionsReloadKey])

  useEffect(() => {
    if (dialog) {
      if (document.activeElement instanceof HTMLElement && !document.activeElement.closest('.modal')) dialogOpenerRef.current = document.activeElement
      dialogRef.current?.focus()
      return
    }
    dialogOpenerRef.current?.focus()
    dialogOpenerRef.current = null
  }, [dialog])

  useEffect(() => {
    if (!notice) return
    window.clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = window.setTimeout(() => setNotice(''), 2000)
    return () => window.clearTimeout(noticeTimerRef.current)
  }, [notice])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && dialog) {
        setDialog(null)
        return
      }
      if (dialog || screen !== 'play' || event.metaKey || event.ctrlKey || event.altKey) return

      if (event.key === 'Enter') {
        void submitGuess()
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
    if (session.status !== 'active' || isBusy || currentGuess.length >= WORD_LENGTH) return
    setCurrentGuess((value) => `${value}${letter.toUpperCase()}`)
  }

  function removeLetter() {
    if (session.status !== 'active' || isBusy) return
    setCurrentGuess((value) => value.slice(0, -1))
  }

  function rejectGuess(message: string) {
    setNotice(message)
    setInvalidRow(session.attempts.length)
    window.setTimeout(() => setInvalidRow(-1), 600)
  }

  async function submitGuess() {
    if (session.status !== 'active' || isBusy) return
    if (currentGuess.length < WORD_LENGTH) {
      rejectGuess('Not enough letters')
      return
    }

    const submittedGuess = currentGuess
    setIsSubmitting(true)
    setPendingGuess(submittedGuess)
    setCurrentGuess('')

    try {
      const nextSession = await submitGuessToService(session, submittedGuess)
      const lastAttempt = nextSession.attempts[nextSession.attempts.length - 1]
      if (lastAttempt) setKeyboard((value) => mergeKeyboardState(value, lastAttempt.guess, lastAttempt.result))
      setRevealRow(nextSession.attempts.length - 1)
      setSession(nextSession)
      saveSession(nextSession)
      setPendingGuess('')

      if (nextSession.status === 'won' || nextSession.status === 'lost') {
        setStats((currentStats) => recordSession(currentStats, nextSession))
        if (nextSession.mode === 'archive' && user) {
          void getArchiveStats().then((nextStats) => {
            setArchiveStats(nextStats)
            setArchiveStatsLoaded(true)
          }).catch(() => {})
        }
        setNotice(nextSession.status === 'won'
          ? PRAISE[Math.min(nextSession.attempts.length, PRAISE.length) - 1]
          : nextSession.answer ?? 'Out of guesses')
        if (nextSession.mode !== 'unlimited') window.setTimeout(() => setDialog('stats'), 1600)
      } else {
        setNotice('')
      }
    } catch (error: unknown) {
      setPendingGuess('')
      setCurrentGuess(submittedGuess)
      const message = error instanceof GameServiceError ? error.message : 'The guess could not be submitted.'
      rejectGuess(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  function switchMode(nextMode: GameMode) {
    if (nextMode === mode) return
    setDialog(null)
    setScreen('play')
    setArchiveDate(null)
    setMode(nextMode)
  }

  function startAnotherUnlimited() {
    setDialog(null)
    setIsLoading(true)
    setSession(createEmptySession('unlimited', today))
    setKeyboard(EMPTY_KEYBOARD)
    setCurrentGuess('')
    setPendingGuess('')
    setNotice('')
    setRevealRow(-1)
    void startGame('unlimited', stats, today, true)
      .then((nextSession) => {
        setSession(nextSession)
        saveSession(nextSession)
        setKeyboard(EMPTY_KEYBOARD)
        setCurrentGuess('')
        setPendingGuess('')
        setIsLoading(false)
      })
      .catch((error: unknown) => {
        setIsLoading(false)
        setNotice(error instanceof GameServiceError ? error.message : 'The next puzzle could not be loaded.')
      })
  }

  async function shareResult() {
    const text = createShareText(session, preferences.highContrast)

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
      setShareLabel('Copied')
    } catch {
      setShareLabel('Copy unavailable')
    }
    window.setTimeout(() => setShareLabel('Share'), 1600)
  }

  function retryLoad() {
    if (mode === 'unlimited') {
      startAnotherUnlimited()
      return
    }
    startRequestRef.current = null
    setReloadKey((value) => value + 1)
  }

  async function shareConnectionsResult() {
    if (!connectionsSession || connectionsSession.status === 'active') return
    try {
      await navigator.clipboard.writeText(createConnectionsShareText(connectionsSession))
      setShareLabel('Copied')
    } catch {
      setShareLabel('Copy unavailable')
    }
    window.setTimeout(() => setShareLabel('Share'), 1600)
  }

  function openArchive() {
    setDialog(null)
    setScreen('archive')
    setArchiveDate(null)
  }

  function openConnections() {
    setDialog(null)
    setConnectionsArchiveOpen(false)
    setConnectionsArchiveDate(null)
    setScreen('connections')
  }

  function openVersus() {
    const route: VersusRoute = { kind: 'create' }
    window.location.hash = versusHash(route)
    setVersusRoute(route)
    setScreen('versus')
  }

  function changeVersusRoute(route: VersusRoute) {
    window.location.hash = versusHash(route)
    setVersusRoute(route)
    setScreen('versus')
  }

  function openConnectionsArchive() {
    setDialog(null)
    setConnectionsSession(null)
    setConnectionsArchiveDate(null)
    setConnectionsArchiveOpen(true)
  }

  function playConnectionsArchive(date: string) {
    setConnectionsArchiveDate(date)
    setConnectionsArchiveOpen(false)
  }

  function toggleConnectionsWord(word: string) {
    if (!connectionsSession || connectionsSession.status !== 'active' || connectionsSubmitting) return
    setConnectionsNotice('')
    setConnectionsSelected((selected) => selected.includes(word)
      ? selected.filter((value) => value !== word)
      : selected.length < 4 ? [...selected, word] : selected)
  }

  async function submitConnectionsSelection() {
    if (!connectionsSession || connectionsSelected.length !== 4 || connectionsSubmitting) return
    setConnectionsSubmitting(true)
    try {
      const response = await submitConnections(connectionsSession, connectionsSelected)
      setConnectionsSession(response.session)
      saveConnectionsSession(response.session)
      setConnectionsSelected([])
      setConnectionsNotice(response.result.result === 'correct'
        ? `Group found${response.result.group ? `: ${response.result.group.label}` : ''}`
        : response.result.result === 'one-away' ? 'One away' : 'Not quite')
      if (response.session.status !== 'active') {
        setStats((currentStats) => recordConnectionsSession(currentStats, response.session))
        if (user) void getConnectionsStats().then((nextStats) => {
          setConnectionsCloudStats(nextStats)
          setConnectionsCloudStatsLoaded(true)
        }).catch(() => {})
        if (response.session.mode === 'archive') void getConnectionsArchiveStats().then(setConnectionsArchiveStats).catch(() => {})
        window.setTimeout(() => setDialog('stats'), 900)
      } else if (response.result.result === 'correct') {
        window.setTimeout(() => connectionsGridRef.current?.querySelector<HTMLButtonElement>('button')?.focus(), 0)
      }
    } catch (error: unknown) {
      setConnectionsNotice(error instanceof GameServiceError ? error.message : 'The selection could not be checked.')
    } finally {
      setConnectionsSubmitting(false)
    }
  }

  function retryConnections() {
    setConnectionsReloadKey((value) => value + 1)
  }

  function openAccount() {
    setDialog('account')
    setAuthError('')
    setAuthNotice('')
    if (!isRecovery) setAuthMode(user ? 'signin' : archiveAuthRequired ? 'signin' : authMode)
  }

  function changeAuthMode(nextMode: AuthMode) {
    setAuthMode(nextMode)
    setAuthError('')
    setAuthNotice('')
  }

  async function submitAuth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || authBusy) return
    setAuthBusy(true)
    setAuthError('')
    setAuthNotice('')

    try {
      if (authMode === 'reset') {
        const { error } = await supabase.auth.resetPasswordForEmail(authEmail, { redirectTo: getAuthRedirectUrl() })
        if (error) throw error
        setAuthNotice('Check your inbox for a password reset link.')
      } else if (authMode === 'update') {
        const { error } = await supabase.auth.updateUser({ password: authPassword })
        if (error) throw error
        setIsRecovery(false)
        setAuthMode('signin')
        setAuthPassword('')
        setAuthNotice('Password updated.')
      } else if (authMode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email: authEmail,
          password: authPassword,
          options: { emailRedirectTo: getAuthRedirectUrl() },
        })
        if (error) throw error
        if (data.session) setAuthNotice('Account created. Archive is ready.')
        else setAuthNotice('Account created. Check your inbox to confirm your email.')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword })
        if (error) throw error
        setAuthNotice('Signed in.')
      }
    } catch (error: unknown) {
      setAuthError(error instanceof Error ? error.message : 'Authentication failed.')
    } finally {
      setAuthBusy(false)
    }
  }

  async function signOut() {
    if (!supabase) return
    await supabase.auth.signOut()
    setIsRecovery(false)
    setDialog(null)
    if (screen === 'archive') setScreen('games')
  }

  function openArchivePuzzle(date: string) {
    setDialog(null)
    setArchiveDate(date)
    setMode('archive')
    setScreen('play')
    setReloadKey((value) => value + 1)
  }

  function openGame(nextMode: GameMode) {
    setScreen('play')
    setArchiveDate(null)
    if (nextMode !== mode) {
      setMode(nextMode)
    } else if (nextMode === 'daily' && session.date !== today) {
      setReloadKey((value) => value + 1)
    }
  }

  function startToday() {
    setDailyNeedsAdvance(false)
    startRequestRef.current = null
    setSession(createEmptySession('daily', today))
    setReloadKey((value) => value + 1)
  }

  const statusMessage = isLoading ? 'Loading puzzle…' : notice
  const verdict = !isFinished
    ? ''
    : session.status === 'won'
      ? `Solved in ${session.attempts.length} ${session.attempts.length === 1 ? 'guess' : 'guesses'}.`
      : session.answer
        ? `The word was ${session.answer}.`
        : 'Out of guesses.'

  return (
    <div
      className="app"
      data-contrast={preferences.highContrast ? 'on' : 'off'}
      data-motion={preferences.reduceMotion ? 'reduced' : 'normal'}
    >
      <header className="bar" data-screen={screen} data-size={screen === 'games' ? 'small' : 'normal'}>
        <div className="bar-left">
          <span className="brand-stamp" aria-label="Dailo">D</span>
          <button className="icon-button" type="button" aria-label="All games" onClick={() => { setDialog(null); window.location.hash = ''; setVersusRoute(null); setScreen('games') }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <rect x="3.5" y="3.5" width="7" height="7" /><rect x="13.5" y="3.5" width="7" height="7" />
              <rect x="3.5" y="13.5" width="7" height="7" /><rect x="13.5" y="13.5" width="7" height="7" />
            </svg>
          </button>
          <button className="icon-button" type="button" aria-label="How to play" onClick={() => setDialog('help')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M9.4 9.2a2.7 2.7 0 0 1 5.2.9c0 1.8-2.6 2.2-2.6 3.9" />
              <circle cx="12" cy="17.4" r="0.9" fill="currentColor" stroke="none" />
            </svg>
          </button>
        </div>
        <h1>{screen === 'games' || screen === 'archive' ? 'Dailo' : screen === 'connections' ? 'Connections' : screen === 'versus' ? 'Wordo Versus' : 'Wordo'}</h1>
        <div className="bar-right">
          <button className="icon-button account-button" type="button" aria-label="Account" onClick={openAccount}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <circle cx="12" cy="8" r="3.2" /><path d="M5.5 20c.8-3.2 2.9-5 6.5-5s5.7 1.8 6.5 5" />
            </svg>
            {user && <i />}
          </button>
          <button className="icon-button" type="button" aria-label="Statistics" onClick={() => setDialog('stats')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M4 20V4M4 7h11M4 12.5h15M4 18h8" />
            </svg>
          </button>
          <button className="icon-button" type="button" aria-label="Settings" onClick={() => setDialog('settings')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8" />
            </svg>
          </button>
        </div>
      </header>

      {screen === 'games' ? (
        <section className="screen" aria-label="All games">
          <div className="hub">
            <div className="hub-date">
              <strong>{formatLondonDate(today)}</strong>
              <span>New puzzles at midnight</span>
            </div>

            <div className="game-list">
              <button className="game-row" type="button" onClick={() => openGame('daily')}>
                <span className="game-thumb" aria-hidden="true">
                  <i data-state="correct" /><i /><i /><i data-state="present" />
                </span>
                <span>
                  <b>Wordo</b>
                  <span className="game-note">Guess the word in six tries</span>
                </span>
                <span className="game-go">Play</span>
              </button>

              <button className="game-row" type="button" onClick={() => openGame('unlimited')}>
                <span className="game-thumb" aria-hidden="true">
                  <i /><i data-state="present" /><i data-state="correct" /><i />
                </span>
                <span>
                  <b>Wordo Unlimited</b>
                  <span className="game-note">Endless puzzles, no streak at stake</span>
                </span>
                <span className="game-go">Play</span>
              </button>

              <button className="game-row" type="button" onClick={openArchive}>
                <span className="game-thumb" aria-hidden="true">
                  <i /><i data-state="correct" /><i data-state="present" /><i data-state="correct" />
                </span>
                <span>
                  <b>Wordo Archive</b>
                  <span className="game-note">Replay past daily editions</span>
                </span>
                <span className="game-go">Browse</span>
              </button>

              <button className="game-row" type="button" onClick={openConnections}>
                <span className="game-thumb" aria-hidden="true"><i /><i /><i /><i /></span>
                <span>
                  <b>Connections</b>
                  <span className="game-note">Group the words into four</span>
                </span>
                <span className="game-go">Play</span>
              </button>

              <button className="game-row" type="button" onClick={openVersus}>
                <span className="game-thumb versus-thumb" aria-hidden="true"><i data-state="correct" /><i /><i data-state="present" /><i /></span>
                <span>
                  <b>Wordo Versus</b>
                  <span className="game-note">Challenge someone with a private link</span>
                </span>
                <span className="game-go">Create</span>
              </button>
            </div>

            <p className="hub-foot">
              Current streak <b>{currentStreak}</b> · Next puzzle in <b>{dailyCountdown}</b>
            </p>
          </div>
        </section>
      ) : screen === 'versus' ? (
        <VersusScreen route={versusRoute ?? { kind: 'create' }} onRoute={changeVersusRoute} />
      ) : screen === 'connections' ? (
        <section className="screen connections-screen" aria-label={connectionsArchiveOpen ? 'Connections archive' : 'Connections game'}>
          <div className="connections-game">
            <div className="connections-heading">
              <span>Word groups</span>
              <h2>{connectionsArchiveOpen ? 'Connections Archive' : connectionsArchiveDate ? `Connections · ${formatLondonDate(connectionsArchiveDate)}` : 'Connections'}</h2>
              <p>{connectionsArchiveOpen ? 'Past editions, separate from your Daily streak.' : 'Find four groups of four. You have four mistakes.'}</p>
              {!connectionsArchiveOpen && <button className="back-link" type="button" onClick={connectionsArchiveDate ? openConnections : openConnectionsArchive}>{connectionsArchiveDate ? 'Play today' : 'Browse archive'}</button>}
            </div>
            {connectionsLoading && <p className="connections-status" role="status">Loading {connectionsArchiveOpen || connectionsArchiveDate ? 'archive' : 'today’s'} puzzle…</p>}
            {!connectionsLoading && connectionsArchiveOpen && !connectionsNotice && (
              <div className="archive-list">
                <div className="archive-summary"><b>{connectionsArchiveStats.played}</b><span>played</span><b>{connectionsArchiveStats.wins}</b><span>won</span></div>
                {connectionsArchivePuzzles.length === 0 ? <div className="archive-empty"><strong>No past Connections puzzles yet</strong></div> : connectionsArchivePuzzles.map((puzzle) => (
                  <button className="archive-item" type="button" key={puzzle.date} onClick={() => playConnectionsArchive(puzzle.date)}>
                    <span>{formatLondonDate(puzzle.date)}</span><b>{puzzle.status === 'won' ? 'Won' : puzzle.status === 'lost' ? 'Played' : puzzle.status === 'active' ? 'Resume' : 'Play'}</b>
                  </button>
                ))}
              </div>
            )}
            {!connectionsLoading && !connectionsArchiveOpen && connectionsSession && (
              <>
                <div className="connections-mistakes" aria-label={`${connectionsSession.mistakeCount} of ${connectionsSession.maxMistakes} mistakes used`}>
                  {Array.from({ length: connectionsSession.maxMistakes }).map((_, index) => <i data-used={index < connectionsSession.mistakeCount} key={index} />)}
                </div>
                <div className="connections-groups">
                  {connectionsSession.solvedGroups.map((group) => (
                    <div className="connections-group" data-difficulty={group.difficulty} key={group.key}>
                      <strong>{group.label}</strong>
                      <span>{group.words.join(' · ')}</span>
                    </div>
                  ))}
                </div>
                {connectionsSession.status === 'active' ? (
                  <>
                    <div className="connections-grid" ref={connectionsGridRef} role="group" aria-label={`Word selection, ${connectionsSelected.length} of 4 selected`}>
                      {shuffleConnectionsWords(connectionsSession.words, connectionsSession.puzzleId)
                        .filter((word) => !connectionsSession.solvedGroups.some((group) => group.words.includes(word)))
                        .map((word) => (
                          <button className="connections-word" data-selected={connectionsSelected.includes(word)} aria-pressed={connectionsSelected.includes(word)} type="button" key={word} onClick={() => toggleConnectionsWord(word)}>
                            {word}
                          </button>
                        ))}
                    </div>
                    <div className="connections-actions">
                      <button className="secondary-button" type="button" onClick={() => setConnectionsSelected([])} disabled={connectionsSelected.length === 0}>Clear</button>
                      <button className="primary-button" type="button" onClick={() => void submitConnectionsSelection()} disabled={connectionsSelected.length !== 4 || connectionsSubmitting}>Submit</button>
                    </div>
                    {connectionsNotice && <p className="connections-feedback" role="status">{connectionsNotice}</p>}
                  </>
                ) : (
                  <div className="connections-finished" role="status">
                    <strong>{connectionsSession.status === 'won' ? 'All groups found.' : 'The groups were hiding well.'}</strong>
                    <span>{connectionsSession.mistakeCount} of {connectionsSession.maxMistakes} mistakes used.</span>
                    <button className="primary-button" type="button" onClick={() => setDialog('stats')}>View results</button>
                  </div>
                )}
              </>
            )}
            {!connectionsLoading && !connectionsSession && connectionsNotice && <div className="error-bar" role="alert"><span>{connectionsNotice}</span><button type="button" onClick={retryConnections}>Retry</button></div>}
          </div>
        </section>
      ) : screen === 'archive' ? (
        <section className="screen" aria-label="Wordo archive">
          <div className="archive-browser">
            <div className="archive-heading">
              <button className="back-link" type="button" onClick={() => setScreen('games')}>← All games</button>
              <span>Replay desk</span>
              <h2>Wordo Archive</h2>
              <p>Past daily editions, separate from today’s streak.</p>
            </div>
            {archiveLoading && <p className="archive-status">Loading past editions…</p>}
            {archiveError && <div className="error-bar" role="alert"><span>{archiveError}</span>{archiveAuthRequired ? <button type="button" onClick={openAccount}>Sign in</button> : <button type="button" onClick={openArchive}>Retry</button>}</div>}
            {!archiveLoading && !archiveError && (
              <div className="archive-list">
                {archivePuzzles.length === 0 ? (
                  <div className="archive-empty">
                    <strong>Your replay shelf is empty</strong>
                    <span>Past daily editions will appear here after the next daily reset.</span>
                  </div>
                ) : groupArchivePuzzles(archivePuzzles).map((group) => (
                  <div className="archive-month" key={group.label}>
                    <h3>{group.label}</h3>
                    {group.puzzles.map((puzzle) => (
                      <button className="archive-row" data-state={puzzle.status ?? 'new'} type="button" key={puzzle.date} onClick={() => openArchivePuzzle(puzzle.date)}>
                        <span className="archive-date">{formatLondonDate(puzzle.date)}</span>
                        <span className="archive-state">
                          <i />
                          {puzzle.status === 'won' ? 'Solved' : puzzle.status === 'lost' ? 'Finished' : puzzle.status === 'active' ? 'In progress' : 'Play'}
                        </span>
                        <span aria-hidden="true">→</span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
            <p className="archive-foot">{archivePlayed} played · {archiveWins} won · archive results never change your streak</p>
          </div>
        </section>
      ) : (
        <section className="screen play-screen" aria-label="Wordo game">
          <nav className="mode-tabs" aria-label="Game mode">
            <button type="button" aria-pressed={mode === 'daily'} onClick={() => switchMode('daily')}>Daily</button>
            <button type="button" aria-pressed={mode === 'unlimited'} onClick={() => switchMode('unlimited')}>Unlimited</button>
            {mode === 'archive' && <button type="button" aria-pressed="true" onClick={openArchive}>Archive</button>}
          </nav>

            <div className="board-area">
              <div className="board-card">
                <div
                  className="board"
                  data-ready={!isLoading && Boolean(session.sessionToken)}
                  aria-label={`${session.attempts.length} of ${MAX_GUESSES} guesses used`}
                >
                  {Array.from({ length: MAX_GUESSES }).map((_, rowIndex) => {
                    const attempt = session.attempts[rowIndex]
                    const isPendingRow = rowIndex === session.attempts.length && Boolean(pendingGuess)
                    const isCurrentRow = rowIndex === session.attempts.length && session.status === 'active' && !pendingGuess
                    return (
                      <div
                        className="board-row"
                        data-invalid={invalidRow === rowIndex}
                        aria-label={`Guess ${rowIndex + 1}`}
                        key={rowIndex}
                      >
                        {Array.from({ length: WORD_LENGTH }).map((__, letterIndex) => {
                          const letter = attempt?.guess[letterIndex]
                            ?? (isPendingRow ? pendingGuess[letterIndex] ?? '' : isCurrentRow ? currentGuess[letterIndex] ?? '' : '')
                          const state = attempt?.result[letterIndex]
                          const stateLabel = state ?? 'empty'
                          return (
                            <div
                              className="tile"
                              key={letterIndex}
                              style={{ '--tile-index': letterIndex } as React.CSSProperties}
                              data-state={state}
                              data-filled={letter && !state ? 'true' : undefined}
                              data-pending={isPendingRow ? 'true' : undefined}
                              data-reveal={revealRow === rowIndex ? 'true' : undefined}
                              aria-label={`${letter || 'empty'}, ${stateLabel}`}
                            >
                              {letter}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

          {hasLoadError && (
            <div className="error-bar" role="alert">
              <span>{notice || 'The puzzle could not be loaded.'}</span>
              <button type="button" onClick={retryLoad}>Retry</button>
            </div>
          )}

          {dailyNeedsAdvance && (
            <div className="rollover-bar" role="status">
              <span>Yesterday’s puzzle is still in progress.</span>
              <button type="button" onClick={startToday}>Start today</button>
            </div>
          )}

          {mode === 'unlimited' && isFinished && (
            <div className="unlimited-next" role="status">
              <button className="primary-button" type="button" onClick={startAnotherUnlimited}>Next puzzle</button>
            </div>
          )}

          <div className="keyboard" aria-label="On-screen keyboard">
            {KEYBOARD_ROWS.map((row, rowIndex) => (
              <div className="keyboard-row" data-indent={rowIndex === 1} key={rowIndex}>
                {rowIndex === 2 && (
                  <button className="key" data-wide="true" type="button" onClick={() => void submitGuess()} disabled={isBusy || isFinished}>
                    Enter
                  </button>
                )}
                {row.split('').map((letter) => (
                  <button
                    key={letter}
                    type="button"
                    className="key"
                    data-state={keyboard[letter]}
                    onClick={() => addLetter(letter)}
                    disabled={isBusy || isFinished}
                    aria-label={`${letter}${keyboard[letter] ? `, ${keyboard[letter]}` : ''}`}
                  >
                    {letter}
                  </button>
                ))}
                {rowIndex === 2 && (
                  <button className="key" data-wide="true" type="button" onClick={removeLetter} disabled={isBusy || isFinished} aria-label="Backspace">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                      <path d="M21 5.5H9.2L3 12l6.2 6.5H21z" /><path d="M12.5 9.5l5 5M17.5 9.5l-5 5" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="toast-wrap">
        <p className="toast" data-show={Boolean(statusMessage) && !hasLoadError} role="status" aria-live="polite">
          {statusMessage || ' '}
        </p>
      </div>

      {dialog === 'account' && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setDialog(null)}>
          <div
            className="modal account-modal"
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="account-title"
            tabIndex={-1}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button className="icon-button modal-close" type="button" aria-label="Close account" onClick={() => setDialog(null)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
            <h2 id="account-title">Account</h2>
            {user && !isRecovery ? (
              <div className="account-signed-in">
                <p className="account-kicker">Signed in as</p>
                <p className="account-email">{user.email}</p>
                <p className="fine">Your confirmed account can access Archive. Daily and Unlimited remain available without signing in.</p>
                <button className="primary-button" type="button" onClick={() => void signOut()}>Sign out</button>
              </div>
            ) : (
              <>
                <p className="account-intro">
                  {authMode === 'reset' ? 'Reset your Dailo password.' : authMode === 'update' ? 'Choose a new password for your Dailo account.' : 'Sign in to play Archive and keep your account ready for future progress sync.'}
                </p>
                {authError && <p className="account-message account-message-error" role="alert">{authError}</p>}
                {authNotice && <p className="account-message" role="status">{authNotice}</p>}
                {supabase ? (
                  <form className="account-form" onSubmit={(event) => void submitAuth(event)}>
                    {authMode !== 'update' && (
                      <label>
                        Email
                        <input type="email" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} autoComplete="email" required />
                      </label>
                    )}
                    {authMode !== 'reset' && (
                      <label>
                        Password
                        <input type="password" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} minLength={6} autoComplete={authMode === 'signup' || authMode === 'update' ? 'new-password' : 'current-password'} required />
                      </label>
                    )}
                    <button className="primary-button" type="submit" disabled={authBusy}>
                      {authBusy ? 'Working…' : authMode === 'signup' ? 'Create account' : authMode === 'reset' ? 'Send reset link' : authMode === 'update' ? 'Update password' : 'Sign in'}
                    </button>
                  </form>
                ) : (
                  <p className="account-message account-message-error">Account services are not configured.</p>
                )}
                <div className="account-links">
                  {authMode === 'signin' && <><button type="button" onClick={() => changeAuthMode('signup')}>Create account</button><button type="button" onClick={() => changeAuthMode('reset')}>Forgot password?</button></>}
                  {authMode !== 'signin' && authMode !== 'update' && <button type="button" onClick={() => changeAuthMode('signin')}>Back to sign in</button>}
                </div>
                {authMode === 'signup' && <p className="fine account-note">We will email you a confirmation link before Archive becomes available.</p>}
              </>
            )}
          </div>
        </div>
      )}

      {dialog === 'stats' && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setDialog(null)}>
          <div
            className="modal"
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="stats-title"
            tabIndex={-1}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button className="icon-button modal-close" type="button" aria-label="Close statistics" onClick={() => setDialog(null)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
            <h2 id="stats-title">{screen === 'connections' ? 'Connections statistics' : mode === 'archive' ? 'Archive result' : 'Statistics'}</h2>
            {screen !== 'connections' && verdict && <p className="verdict">{verdict}</p>}

            {screen === 'connections' ? (
              <>
                <div className="stat-row">
                  <div className="stat"><b>{displayedConnectionsPlayed}</b><span>Played</span></div>
                  <div className="stat"><b>{displayedConnectionsWinPercentage}</b><span>Win %</span></div>
                  <div className="stat"><b>{showingConnectionsArchiveStats ? '—' : connectionsCurrentStreak}</b><span>{showingConnectionsArchiveStats ? 'No streak' : 'Current streak'}</span></div>
                  <div className="stat"><b>{showingConnectionsArchiveStats ? '—' : connectionsMaximumStreak}</b><span>{showingConnectionsArchiveStats ? 'No streak' : 'Max streak'}</span></div>
                </div>
                <h2>Mistakes in wins</h2>
                <div className="connections-distribution">
                  {displayedConnectionsDistribution.map((count, mistakes) => <div key={mistakes}><b>{count}</b><span>{mistakes} mistake{mistakes === 1 ? '' : 's'}</span></div>)}
                </div>
                {user && <div className="device-stats"><b>This device</b><span>{Object.keys(connectionsDeviceResults).length} locally saved result{Object.keys(connectionsDeviceResults).length === 1 ? '' : 's'}. Cloud statistics above include verified signed-in games only.</span></div>}
                <div className="share-split">
                  <div className="next-in"><span>Next Connections</span><b>{dailyCountdown}</b></div>
                  <div className="share-rule" />
                  <button className="primary-button" type="button" onClick={() => void shareConnectionsResult()} disabled={!connectionsSession || connectionsSession.status === 'active'}>{shareLabel}</button>
                </div>
                <p className="fine" style={{ marginTop: 14 }}>{showingConnectionsArchiveStats ? 'Archive results are synced separately and never change your Daily streak.' : user ? 'Verified signed-in results sync across devices. Older device results remain local.' : 'Saved in this browser only. Sign in to sync future verified results.'}</p>
              </>
            ) : <><div className="stat-row">
              <div className="stat"><b>{mode === 'archive' ? displayedArchivePlayed : mode === 'unlimited' ? unlimitedPlayed : dailyPlayed}</b><span>{mode === 'archive' ? 'Archive played' : 'Played'}</span></div>
              <div className="stat"><b>{mode === 'archive' ? (displayedArchivePlayed === 0 ? 0 : Math.round((displayedArchiveWins / displayedArchivePlayed) * 100)) : mode === 'unlimited' ? unlimitedWinPercentage : winPercentage}</b><span>Win %</span></div>
              <div className="stat"><b>{mode === 'archive' || mode === 'unlimited' ? '—' : currentStreak}</b><span>{mode === 'archive' || mode === 'unlimited' ? 'No streak' : 'Current streak'}</span></div>
              <div className="stat"><b>{mode === 'archive' || mode === 'unlimited' ? '—' : maximumStreak}</b><span>{mode === 'archive' || mode === 'unlimited' ? 'No streak' : 'Max streak'}</span></div>
            </div>

            {mode === 'archive' ? (
              <p className="fine" style={{ margin: '-6px 0 18px', textAlign: 'center' }}>This result is saved separately and never changes your Daily streak.</p>
            ) : (
              <>
                <h2>Guess distribution</h2>
                <div className="dist">
                  {displayedDistribution.map((count, index) => (
                    <div className="dist-row" key={index}>
                      <span>{index + 1}</span>
                      <div
                        className="dist-bar"
                        data-best={count > 0 && count === displayedBestBucket}
                        style={{ width: `${Math.max(8, Math.round((count / displayedBestBucket) * 100))}%` }}
                      >
                        {count}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="share-split">
              <div className="next-in">
                <span>Next Wordo</span>
                <b>{dailyCountdown}</b>
              </div>
              <div className="share-rule" />
              {mode === 'unlimited' && isFinished ? (
                <button className="primary-button" type="button" onClick={startAnotherUnlimited}>Next puzzle</button>
              ) : (
                <button className="primary-button" type="button" onClick={() => void shareResult()} disabled={!isFinished}>
                  {shareLabel}
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 16V4M7.5 8.5L12 4l4.5 4.5" /><path d="M5 14v5.5h14V14" />
                  </svg>
                </button>
              )}
            </div>
            <p className="fine" style={{ marginTop: 14 }}>Saved in this browser only. Clearing your data clears these.</p></>}
          </div>
        </div>
      )}

      {dialog === 'help' && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setDialog(null)}>
          <div
            className="modal"
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
            tabIndex={-1}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button className="icon-button modal-close" type="button" aria-label="Close how to play" onClick={() => setDialog(null)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
            <h2 id="help-title">How to play</h2>
            {screen === 'connections' ? <>
              <p style={{ marginTop: 0 }}>Find four groups of four related words.</p>
              <ul className="help-list">
                <li>Select exactly four words, then submit.</li>
                <li>A correct group leaves the board and reveals its category.</li>
                <li>“One away” means three selected words belong together.</li>
                <li>Four incorrect selections end the puzzle.</li>
              </ul>
              <p className="fine">Group colours represent difficulty from yellow through purple. Daily and Archive results are tracked separately.</p>
            </> : <><p style={{ marginTop: 0 }}>
              Guess the word in six tries. Each guess must be a real five-letter word. The colours show how close you were.
            </p>
            <ul className="examples">
              <li>
                <div className="example-row" aria-hidden="true">
                  <i data-state="correct">W</i><i>E</i><i>A</i><i>R</i><i>Y</i>
                </div>
                <strong>W</strong> is in the word and in the right spot.
              </li>
              <li>
                <div className="example-row" aria-hidden="true">
                  <i>P</i><i data-state="present">I</i><i>L</i><i>L</i><i>S</i>
                </div>
                <strong>I</strong> is in the word but in the wrong spot.
              </li>
              <li>
                <div className="example-row" aria-hidden="true">
                  <i>V</i><i>A</i><i>G</i><i data-state="absent">U</i><i>E</i>
                </div>
                <strong>U</strong> is not in the word at all.
              </li>
            </ul>
            <div className="rule" />
            <p className="fine">
              A new puzzle for everyone at midnight. Unlimited never runs out and never touches your streak.
            </p>
            </>}
          </div>
        </div>
      )}

      {dialog === 'settings' && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setDialog(null)}>
          <div
            className="modal"
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            tabIndex={-1}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button className="icon-button modal-close" type="button" aria-label="Close settings" onClick={() => setDialog(null)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
            <h2 id="settings-title">Settings</h2>

            <div className="setting-row">
              <span className="setting-label">
                <b>Theme</b>
                <span>Auto follows your device</span>
              </span>
              <div className="segmented" role="group" aria-label="Theme">
                {(['system', 'light', 'dark'] as const).map((option) => (
                  <button key={option} type="button" aria-pressed={theme === option} onClick={() => setTheme(option)}>
                    {option === 'system' ? 'Auto' : option[0].toUpperCase() + option.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div className="setting-row">
              <span className="setting-label">
                <b>High contrast colours</b>
                <span>Orange and blue instead of green and yellow</span>
              </span>
              <button
                className="switch"
                type="button"
                aria-pressed={preferences.highContrast}
                aria-label="High contrast colours"
                onClick={() => setPreferences((value) => ({ ...value, highContrast: !value.highContrast }))}
              >
                <i />
              </button>
            </div>

            <div className="setting-row">
              <span className="setting-label">
                <b>Reduce motion</b>
                <span>No tile flips</span>
              </span>
              <button
                className="switch"
                type="button"
                aria-pressed={preferences.reduceMotion}
                aria-label="Reduce motion"
                onClick={() => setPreferences((value) => ({ ...value, reduceMotion: !value.reduceMotion }))}
              >
                <i />
              </button>
            </div>

            <div className="setting-row">
              <span className="setting-label">
                <b>Daily reset</b>
                <span>New puzzles arrive at midnight, London time</span>
              </span>
            </div>

            <p className="fine" style={{ marginTop: 16 }}>Daily and Unlimited work without an account. Archive needs a confirmed email account.</p>
          </div>
        </div>
      )}
    </div>
  )
}

function countDistribution(stats: Stats): number[] {
  return countGuessDistribution(Object.values(stats.dailyResults))
}

function countGuessDistribution(results: Array<{ won: boolean; guesses: number }>): number[] {
  const buckets = Array.from({ length: MAX_GUESSES }, () => 0)
  results.forEach((result) => {
    if (result.won && result.guesses >= 1 && result.guesses <= MAX_GUESSES) {
      buckets[result.guesses - 1] += 1
    }
  })
  return buckets
}

function groupArchivePuzzles(puzzles: Awaited<ReturnType<typeof listArchivePuzzles>>) {
  const groups: Array<{ label: string; puzzles: typeof puzzles }> = []
  puzzles.forEach((puzzle) => {
    const label = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', month: 'long', year: 'numeric' }).format(new Date(`${puzzle.date}T12:00:00Z`))
    const existing = groups.find((group) => group.label === label)
    if (existing) existing.puzzles.push(puzzle)
    else groups.push({ label, puzzles: [puzzle] })
  })
  return groups
}

function shuffleConnectionsWords(words: string[], puzzleId: string): string[] {
  return [...words].sort((left, right) => {
    const score = (word: string) => Array.from(`${puzzleId}${word}`).reduce((total, character) => total * 31 + character.charCodeAt(0), 7)
    return score(left) - score(right)
  })
}

export default App
