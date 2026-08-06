import { DAILY_ANSWERS, LOCAL_WORDS } from './localWords'
import { getLondonDate } from './date'

export function getDailyAnswer(date = getLondonDate()): string {
  const dayNumber = Math.floor(Date.parse(`${date}T12:00:00Z`) / 86_400_000)
  return DAILY_ANSWERS[Math.abs(dayNumber) % DAILY_ANSWERS.length]
}

export function getDailyPuzzleId(date = getLondonDate()): string {
  return `daily-${date}`
}

export function getUnlimitedAnswer(recentPuzzleIds: string[]): { answer: string; puzzleId: string } {
  const recentAnswers = new Set(recentPuzzleIds.map((id) => id.replace('unlimited-', '')))
  const available = LOCAL_WORDS.filter((word) => !recentAnswers.has(word))
  const answer = available[Math.floor(Math.random() * available.length)] ?? LOCAL_WORDS[0]
  return { answer, puzzleId: `unlimited-${answer}` }
}
