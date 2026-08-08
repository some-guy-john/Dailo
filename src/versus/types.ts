import type { Attempt } from '../game/types'

export type VersusPlayerStatus = 'waiting' | 'playing' | 'won' | 'lost' | 'conceded'
export type VersusMatchStatus = 'waiting' | 'active' | 'completed' | 'expired' | 'cancelled'

export type VersusMatch = {
  publicKey: string
  participantToken: string
  status: VersusMatchStatus
  playerName: string
  opponentName: string | null
  playerStatus: VersusPlayerStatus
  opponentStatus: VersusPlayerStatus | null
  attempts: Attempt[]
  opponentRows: Attempt['result'][]
  answer: string | null
  outcome: 'win' | 'loss' | 'draw' | 'void' | null
  expiresAt: string
}
