const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const WORD_PATTERN = /^[A-Z][A-Z0-9 '&-]*$/

function normalizedWord(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : ''
}

function requireUnique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`${label} must be unique.`)
}

export function validateConnectionsPuzzle(input, index = 0) {
  const location = `Puzzle ${index + 1}`
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error(`${location} must be an object.`)
  if (!DATE_PATTERN.test(input.date ?? '') || Number.isNaN(Date.parse(`${input.date}T12:00:00Z`))) {
    throw new Error(`${location} has an invalid date.`)
  }
  if (input.status !== undefined && !['draft', 'published'].includes(input.status)) {
    throw new Error(`${location} status must be draft or published.`)
  }
  if (!Array.isArray(input.groups) || input.groups.length !== 4) throw new Error(`${location} must contain four groups.`)

  const groups = input.groups.map((group, groupIndex) => {
    const groupLocation = `${location}, group ${groupIndex + 1}`
    if (!group || typeof group !== 'object' || Array.isArray(group)) throw new Error(`${groupLocation} must be an object.`)
    if (!KEY_PATTERN.test(group.key ?? '')) throw new Error(`${groupLocation} has an invalid key.`)
    const label = typeof group.label === 'string' ? group.label.trim() : ''
    if (!label || label.length > 80) throw new Error(`${groupLocation} label must contain 1-80 characters.`)
    if (!Number.isInteger(group.difficulty) || group.difficulty < 1 || group.difficulty > 4) {
      throw new Error(`${groupLocation} difficulty must be an integer from 1 to 4.`)
    }
    if (!Array.isArray(group.words) || group.words.length !== 4) throw new Error(`${groupLocation} must contain four words.`)
    const words = group.words.map(normalizedWord)
    if (words.some((word) => !WORD_PATTERN.test(word))) throw new Error(`${groupLocation} contains an invalid word.`)
    requireUnique(words, `${groupLocation} words`)
    return { key: group.key, label, difficulty: group.difficulty, words }
  })

  requireUnique(groups.map(({ key }) => key), `${location} group keys`)
  requireUnique(groups.map(({ label }) => label.toUpperCase()), `${location} group labels`)
  requireUnique(groups.map(({ difficulty }) => difficulty), `${location} difficulties`)
  const derivedWords = groups.flatMap(({ words }) => words)
  requireUnique(derivedWords, `${location} words across groups`)

  if (input.words !== undefined && (!Array.isArray(input.words) || input.words.length !== 16)) {
    throw new Error(`${location} words must contain 16 entries.`)
  }
  const words = input.words === undefined ? derivedWords : input.words.map(normalizedWord)
  if (input.words !== undefined) {
    if (words.some((word) => !WORD_PATTERN.test(word))) throw new Error(`${location} contains an invalid board word.`)
    requireUnique(words, `${location} board words`)
    const expected = [...derivedWords].sort()
    const actual = [...words].sort()
    if (expected.some((word, wordIndex) => word !== actual[wordIndex])) {
      throw new Error(`${location} board words must exactly match its grouped words.`)
    }
  }

  return {
    date: input.date,
    status: input.status ?? 'draft',
    words,
    groups: groups.sort((left, right) => left.difficulty - right.difficulty),
  }
}

export function validateConnectionsContent(source) {
  const puzzles = Array.isArray(source) ? source : source?.puzzles
  if (!Array.isArray(puzzles) || puzzles.length === 0) throw new Error('Content must contain a non-empty puzzles array.')
  const validated = puzzles.map(validateConnectionsPuzzle)
  requireUnique(validated.map(({ date }) => date), 'Puzzle dates')
  return validated
}
