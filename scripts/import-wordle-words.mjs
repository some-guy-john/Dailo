import { execFileSync } from 'node:child_process'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

const guessesFile = process.argv[2] ?? 'C:/laragon/www/wordle-valid-guesses.txt'
const answersFile = process.argv[3] ?? 'C:/laragon/www/wordle-answers.txt'
const chunkSize = 500

if (guessesFile.startsWith('-') || answersFile.startsWith('-')) {
  console.error('Usage: node scripts/import-wordle-words.mjs <valid-guesses.txt> <answers.txt>')
  process.exit(1)
}

function parseWords(source, label) {
  const words = source
    .split(/\r?\n/)
    .map((line) => line.trim().toUpperCase())
    .filter((line) => line && !line.startsWith('#'))
  const invalid = words.filter((word) => !/^[A-Z]{5}$/.test(word))
  if (invalid.length > 0) throw new Error(`${label} contains invalid entries: ${invalid.slice(0, 5).join(', ')}`)
  if (new Set(words).size !== words.length) throw new Error(`${label} contains duplicate entries.`)
  return words
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`
}

async function runSqlFile(sql, label) {
  const command = process.platform === 'win32' ? process.execPath : 'npx'
  const commandArgs = process.platform === 'win32'
    ? [join(process.cwd(), 'node_modules', 'supabase', 'dist', 'supabase.js')]
    : ['supabase']
  const sqlFile = join(tmpdir(), `dailies-wordle-${label}-${process.pid}.sql`)
  await writeFile(sqlFile, sql, 'utf8')
  try {
    execFileSync(command, [...commandArgs, 'db', 'query', '--linked', '--file', sqlFile], {
      cwd: process.cwd(),
      stdio: ['ignore', 'inherit', 'inherit'],
    })
  } finally {
    await unlink(sqlFile).catch(() => {})
  }
}

const guesses = parseWords(await readFile(guessesFile, 'utf8'), 'Valid guesses')
const answers = parseWords(await readFile(answersFile, 'utf8'), 'Answers')
const answerSet = new Set(answers)
const missingAnswers = answers.filter((word) => !guesses.includes(word))
if (missingAnswers.length > 0) throw new Error(`Answers missing from valid guesses: ${missingAnswers.slice(0, 10).join(', ')}`)

console.log(`Validated ${guesses.length} guesses and ${answers.length} answers.`)

const statements = [
  'begin;',
  // Existing session/assignment references remain valid while removed words are retired.
  'update public.wordle_words\nset accepted_guess = false, eligible_answer = false, active = false, updated_at = now();',
]
for (let offset = 0, batch = 1; offset < guesses.length; offset += chunkSize, batch += 1) {
  const chunk = guesses.slice(offset, offset + chunkSize)
  const values = chunk.map((word) => `(${sqlString(word)}, true, ${answerSet.has(word)}, true)`).join(',\n')
  const sql = `insert into public.wordle_words (normalized_word, accepted_guess, eligible_answer, active)\nvalues\n${values}\non conflict (normalized_word) do update set\n  accepted_guess = excluded.accepted_guess,\n  eligible_answer = excluded.eligible_answer,\n  active = excluded.active,\n  updated_at = now();`
  statements.push(sql)
}
statements.push('commit;')

console.log('Applying one transactional Dailies-only reset...')
await runSqlFile(statements.join('\n\n'), 'import')
console.log(`Imported ${guesses.length} accepted guesses and ${answers.length} eligible answers.`)
