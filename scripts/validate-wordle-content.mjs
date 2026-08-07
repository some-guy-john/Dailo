import { readFile } from 'node:fs/promises'
import process from 'node:process'

const file = process.argv[2]
if (!file || file.startsWith('-')) {
  console.error('Usage: node scripts/validate-wordle-content.mjs <file.txt|file.json>')
  process.exit(1)
}

const raw = await readFile(file, 'utf8')
let words
if (file.toLowerCase().endsWith('.json')) {
  const source = JSON.parse(raw)
  words = Array.isArray(source) ? source : source.words
} else {
  words = raw.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith('#'))
}

if (!Array.isArray(words) || words.length === 0) {
  throw new Error('Content must contain a non-empty words array.')
}

const seen = new Set()
for (const [index, item] of words.entries()) {
  const word = typeof item === 'string' ? item : item?.word
  const normalized = typeof word === 'string' ? word.trim().toUpperCase() : ''
  if (!/^[A-Z]{5}$/.test(normalized)) throw new Error(`Entry ${index + 1} is not a five-letter A-Z word.`)
  if (seen.has(normalized)) throw new Error(`Duplicate word: ${normalized}`)
  seen.add(normalized)
}

console.log(`Validated ${seen.size} Wordle words from ${file}.`)
