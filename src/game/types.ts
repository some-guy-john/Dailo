export type TileState = 'empty' | 'correct' | 'present' | 'absent'

export type GameMode = 'daily' | 'unlimited' | 'archive'

export type GameId = 'wordo' | 'connections'

export type GameStatus = 'active' | 'won' | 'lost'

export type GuessResult = TileState[]

export type Attempt = {
  guess: string
  result: GuessResult
}

export type GameSession = {
  mode: GameMode
  puzzleId: string
  date: string | null
  answer: string | null
  sessionToken?: string
  attempts: Attempt[]
  status: GameStatus
  startedAt: string
  completedAt?: string
}

export type DailyResult = {
  date: string
  won: boolean
  guesses: number
}

export type UnlimitedResult = {
  puzzleId: string
  won: boolean
  guesses: number
}

export type ArchiveResult = {
  date: string
  puzzleId: string
  won: boolean
  guesses: number
}

export type Stats = {
  dailyResults: Record<string, DailyResult>
  unlimitedResults: UnlimitedResult[]
  archiveResults: ArchiveResult[]
  recentUnlimitedPuzzleIds: string[]
  connectionsDailyResults: Record<string, ConnectionsDailyResult>
}

export type ConnectionsGroup = {
  key: string
  label: string
  difficulty: 1 | 2 | 3 | 4
  words: string[]
}

export type ConnectionsDailyResult = {
  date: string
  won: boolean
  mistakes: number
}

export type ConnectionsAttempt = {
  words: string[]
  result: 'correct' | 'one-away' | 'incorrect'
  group?: ConnectionsGroup
}

export type ConnectionsSession = {
  puzzleId: string
  date: string
  sessionToken?: string
  words: string[]
  solvedGroups: ConnectionsGroup[]
  attempts: ConnectionsAttempt[]
  mistakeCount: number
  maxMistakes: number
  status: 'active' | 'won' | 'lost'
  startedAt: string
}
