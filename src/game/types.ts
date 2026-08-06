export type TileState = 'empty' | 'correct' | 'present' | 'absent'

export type GameMode = 'daily' | 'unlimited'

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

export type Stats = {
  dailyResults: Record<string, DailyResult>
  unlimitedResults: UnlimitedResult[]
  recentUnlimitedPuzzleIds: string[]
}
