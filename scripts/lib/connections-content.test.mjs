import assert from 'node:assert/strict'
import test from 'node:test'
import { validateConnectionsContent } from './connections-content.mjs'

const validPuzzle = {
  date: '2026-08-08',
  groups: [
    { key: 'fruit', label: 'Fruit', difficulty: 1, words: ['Apple', 'Mango', 'Pear', 'Plum'] },
    { key: 'strings', label: 'String instruments', difficulty: 2, words: ['Harp', 'Guitar', 'Violin', 'Cello'] },
    { key: 'shapes', label: 'Shapes', difficulty: 3, words: ['Circle', 'Oval', 'Square', 'Triangle'] },
    { key: 'cats', label: 'Big cats', difficulty: 4, words: ['Lion', 'Puma', 'Tiger', 'Leopard'] },
  ],
}

test('normalizes a valid four-level puzzle', () => {
  const [puzzle] = validateConnectionsContent({ puzzles: [validPuzzle] })
  assert.equal(puzzle.status, 'draft')
  assert.equal(puzzle.words.length, 16)
  assert.deepEqual(puzzle.groups.map(({ difficulty }) => difficulty), [1, 2, 3, 4])
  assert.equal(puzzle.words[0], 'APPLE')
})

test('rejects words assigned to multiple groups', () => {
  const duplicate = structuredClone(validPuzzle)
  duplicate.groups[1].words[0] = 'Apple'
  assert.throws(() => validateConnectionsContent([duplicate]), /words across groups must be unique/)
})

test('rejects missing difficulty levels', () => {
  const duplicateDifficulty = structuredClone(validPuzzle)
  duplicateDifficulty.groups[3].difficulty = 3
  assert.throws(() => validateConnectionsContent([duplicateDifficulty]), /difficulties must be unique/)
})

test('rejects board words that do not match the groups', () => {
  const mismatched = { ...validPuzzle, words: validPuzzle.groups.flatMap(({ words }) => words) }
  mismatched.words[0] = 'Banana'
  assert.throws(() => validateConnectionsContent([mismatched]), /must exactly match/)
})

test('rejects duplicate dates', () => {
  assert.throws(() => validateConnectionsContent([validPuzzle, validPuzzle]), /Puzzle dates must be unique/)
})
