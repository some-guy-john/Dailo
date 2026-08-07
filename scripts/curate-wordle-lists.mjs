import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { all as canonicalGuesses, answers as canonicalAnswers } from '../node_modules/wordle-words/index.mjs'

const guessesFile = resolve(process.argv[2] ?? 'C:/laragon/www/wordle-valid-guesses.txt')
const answersFile = resolve(process.argv[3] ?? 'C:/laragon/www/wordle-answers.txt')

// Explicit content exclusions. Valid medical or ordinary words are not removed merely
// because they can be uncomfortable; this list targets slurs and strongly explicit terms.
const blocked = new Set([
  'adbot', 'bitch', 'boner', 'boobs', 'chink', 'clits', 'cocks', 'cunts',
  'dicks', 'dildo', 'faggy', 'fagot', 'fucks', 'kikes', 'labia', 'nigga',
  'penis', 'porno', 'pussy', 'rapes', 'semen', 'shart', 'sluts', 'spics',
  'twats', 'vulva', 'whore',
])

// Common modern English additions absent from the original Wordle dictionary.
const guessAdditions = [
  'admin', 'aggro', 'anime', 'async', 'auths', 'bruvs', 'ciaos', 'enums',
  'glamp', 'glowy', 'gzips', 'hacky', 'innie', 'jitsu', 'jpegs', 'kbyte',
  'kcals', 'ketos', 'laggy', 'lexer', 'libre', 'mazel', 'mecha', 'metta',
  'multi', 'mutex', 'nimby', 'noire', 'paleo', 'popup', 'regex', 'selfy',
  'socio', 'sotto', 'topsy', 'turvy', 'utero', 'vibed', 'waggy', 'wakey',
  'wishy',
]

// Familiar, fair answer candidates added beyond Claude's conservative intersection
// with the original answer bank. Inflections and niche specialist terms stay guesses.
const answerAdditions = [
  'abuzz', 'adieu', 'aegis', 'agave', 'alder', 'alias', 'aloha', 'anise',
  'antsy', 'aspen', 'atlas', 'aural', 'batik', 'beige', 'biker', 'biped',
  'bogey', 'bogus', 'cadre', 'codex', 'combo', 'corgi', 'croon', 'cushy',
  'decaf', 'divan', 'divot', 'droid', 'edema', 'emery', 'emote', 'expat',
  'exude', 'feint', 'fount', 'franc', 'frizz', 'gizmo', 'glitz', 'grist',
  'hydra', 'indie', 'inset', 'joule', 'kazoo', 'kiddo', 'laser', 'legit',
  'levee', 'liter', 'lotus', 'matte', 'mochi', 'moray', 'moxie', 'nacho',
  'nexus', 'nifty', 'oasis', 'orate', 'oxbow', 'panda', 'peony', 'pious',
  'polio', 'promo', 'pylon', 'remix', 'ruble', 'runny', 'saber', 'samba',
  'scoot', 'scuff', 'sinus', 'squid', 'strep', 'strum', 'suede', 'swank',
  'swipe', 'tacos', 'taupe', 'tetra', 'tinge', 'toner', 'trill', 'typos',
  'upend', 'uvula', 'venal', 'vibes', 'volts', 'wonky', 'yodel', 'yokel',
  'zilch', 'zippy',
]

function parse(source) {
  return source
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line && !line.startsWith('#'))
}

function validate(words, label) {
  const invalid = words.filter((word) => !/^[a-z]{5}$/.test(word))
  if (invalid.length > 0) throw new Error(`${label} contains invalid words: ${invalid.slice(0, 5).join(', ')}`)
  if (new Set(words).size !== words.length) throw new Error(`${label} contains duplicates.`)
}

const originalGuesses = parse(await readFile(guessesFile, 'utf8'))
const originalAnswers = parse(await readFile(answersFile, 'utf8'))
validate(originalGuesses, 'Guess source')
validate(originalAnswers, 'Answer source')

const canonicalAnswerSet = new Set(canonicalAnswers)
const answerSet = new Set([
  ...originalAnswers.filter((word) => canonicalAnswerSet.has(word)),
  ...answerAdditions,
].filter((word) => !blocked.has(word)))

const guessSet = new Set([
  ...canonicalGuesses,
  ...guessAdditions,
  ...answerSet,
].filter((word) => !blocked.has(word)))

const answers = [...answerSet].sort()
const guesses = [...guessSet].sort()
validate(answers, 'Curated answers')
validate(guesses, 'Curated guesses')

const missingAnswers = answers.filter((word) => !guessSet.has(word))
if (missingAnswers.length > 0) throw new Error(`Answers missing from guesses: ${missingAnswers.join(', ')}`)

await writeFile(answersFile, `# Curated Wordle Answer List\n\n${answers.join('\n')}\n`, 'utf8')
await writeFile(guessesFile, `${guesses.join('\n')}\n`, 'utf8')

console.log(JSON.stringify({
  originalGuesses: originalGuesses.length,
  curatedGuesses: guesses.length,
  originalAnswers: originalAnswers.length,
  curatedAnswers: answers.length,
  blockedEntries: [...blocked].filter((word) => canonicalGuesses.includes(word) || originalGuesses.includes(word)).length,
  reviewedGuessAdditions: guessAdditions.length,
  reviewedAnswerAdditions: answerAdditions.length,
}, null, 2))
