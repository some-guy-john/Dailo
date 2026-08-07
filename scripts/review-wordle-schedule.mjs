import { execFileSync } from 'node:child_process'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

const answersFile = process.argv[2] ?? 'C:/laragon/www/wordle-answers.txt'
const startDate = process.argv[3] ?? '2026-08-08'
const requestedCount = Number.parseInt(process.argv[4] ?? '365', 10)

if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !Number.isInteger(requestedCount) || requestedCount < 1) {
  throw new Error('Usage: node scripts/review-wordle-schedule.mjs <answers.txt> <start-date> <count>')
}

function parseAnswers(source) {
  const answers = source.split(/\r?\n/).map((line) => line.trim().toUpperCase()).filter((line) => line && !line.startsWith('#'))
  if (answers.some((word) => !/^[A-Z]{5}$/.test(word))) throw new Error('Answer file contains malformed entries.')
  return answers
}

function shiftDate(dateString, days) {
  const date = new Date(`${dateString}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`
}

async function runSqlFile(sql) {
  const command = process.platform === 'win32' ? process.execPath : 'npx'
  const commandArgs = process.platform === 'win32'
    ? [join(process.cwd(), 'node_modules', 'supabase', 'dist', 'supabase.js')]
    : ['supabase']
  const sqlFile = join(tmpdir(), `dailies-wordle-review-${process.pid}.sql`)
  await writeFile(sqlFile, sql, 'utf8')
  try {
    return execFileSync(command, [...commandArgs, 'db', 'query', '--linked', '--file', sqlFile], {
      cwd: process.cwd(),
      encoding: 'utf8',
    })
  } finally {
    await unlink(sqlFile).catch(() => {})
  }
}

const answers = parseAnswers(await readFile(answersFile, 'utf8'))
const assignments = Array.from({ length: requestedCount }, (_, index) => ({
  date: shiftDate(startDate, index),
  answer: answers[(index * 37) % answers.length],
}))
const values = assignments.map(({ date, answer }) => `(${sqlString(date)}::date, ${sqlString(answer)})`).join(',\n')
const result = await runSqlFile(`with proposed(london_date, normalized_word) as (values\n${values})
select proposed.london_date, proposed.normalized_word, assignments.status as existing_status
from proposed
left join public.wordle_daily_assignments assignments on assignments.london_date = proposed.london_date
order by proposed.london_date;`)

console.log(result)
