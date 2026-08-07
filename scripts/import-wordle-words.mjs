import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import process from 'node:process'

const sourceFile = process.argv[2] ?? 'C:/laragon/www/wordle-answers.txt'
const chunkSize = 250

if (sourceFile.startsWith('-')) {
  console.error('Usage: node scripts/import-wordle-words.mjs <file.txt>')
  process.exit(1)
}

function parseWords(source) {
  const words = source
    .split(/\r?\n/)
    .map((line) => line.trim().toUpperCase())
    .filter((line) => line && !line.startsWith('#'))

  const invalid = words.filter((word) => !/^[A-Z]{5}$/.test(word))
  if (invalid.length > 0) {
    throw new Error(`Found ${invalid.length} invalid entries. First invalid entry: ${invalid[0]}`)
  }

  const uniqueWords = [...new Set(words)]
  if (uniqueWords.length !== words.length) {
    throw new Error(`Found ${words.length - uniqueWords.length} duplicate entries.`)
  }
  return uniqueWords
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`
}

async function runQuery(sql, batchNumber) {
  const command = process.platform === 'win32' ? process.execPath : 'npx'
  const commandArgs = process.platform === 'win32'
    ? [join(process.cwd(), 'node_modules', 'supabase', 'dist', 'supabase.js')]
    : ['supabase']
  const sqlFile = join(tmpdir(), `dailies-wordle-import-${process.pid}-${batchNumber}.sql`)
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

const source = await readFile(sourceFile, 'utf8')
const words = parseWords(source)
console.log(`Validated ${words.length} words from ${sourceFile}.`)

for (let offset = 0, batchNumber = 1; offset < words.length; offset += chunkSize, batchNumber += 1) {
  const chunk = words.slice(offset, offset + chunkSize)
  const values = chunk.map((word) => `(${sqlString(word)}, true, true, true)`).join(',\n')
  const sql = `insert into public.wordle_words (normalized_word, accepted_guess, eligible_answer, active)\nvalues\n${values}\non conflict (normalized_word) do update set\n  accepted_guess = excluded.accepted_guess,\n  eligible_answer = excluded.eligible_answer,\n  active = excluded.active,\n  updated_at = now();`
  console.log(`Importing ${offset + 1}-${offset + chunk.length}...`)
  await runQuery(sql, batchNumber)
}

console.log(`Imported ${words.length} words into public.wordle_words.`)
