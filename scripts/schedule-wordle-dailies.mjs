import { execFileSync } from 'node:child_process'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

const answersFile = process.argv[2] ?? 'C:/laragon/www/wordle-answers.txt'
const startDate = process.argv[3]
const requestedCount = Number.parseInt(process.argv[4] ?? '365', 10)
const publish = process.argv.includes('--publish')

if (answersFile.startsWith('-') || !startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
  console.error('Usage: node scripts/schedule-wordle-dailies.mjs <answers.txt> <start-date> <count> [--publish]')
  process.exit(1)
}

if (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > 5000) {
  throw new Error('Count must be an integer between 1 and 5000.')
}

function parseAnswers(source) {
  const answers = source
    .split(/\r?\n/)
    .map((line) => line.trim().toUpperCase())
    .filter((line) => line && !line.startsWith('#'))
  const invalid = answers.filter((word) => !/^[A-Z]{5}$/.test(word))
  if (invalid.length > 0) throw new Error(`Answers contain invalid entries: ${invalid.slice(0, 5).join(', ')}`)
  if (new Set(answers).size !== answers.length) throw new Error('Answers contain duplicate entries.')
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
  const sqlFile = join(tmpdir(), `dailies-wordle-schedule-${process.pid}.sql`)
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

const answers = parseAnswers(await readFile(answersFile, 'utf8'))
const assignments = Array.from({ length: requestedCount }, (_, index) => ({
  date: shiftDate(startDate, index),
  answer: answers[index % answers.length],
}))
const status = publish ? 'published' : 'draft'
const values = assignments
  .map(({ date, answer }) => `(${sqlString(date)}::date, ${sqlString(answer)}, ${sqlString(status)})`)
  .join(',\n')

const sql = `begin;

with schedule(london_date, normalized_word, status) as (
  values
${values}
), inserted as (
  insert into public.wordle_daily_assignments (london_date, answer_word_id, status, published_at)
  select schedule.london_date,
         words.id,
         schedule.status,
         case when schedule.status = 'published' then now() else null end
  from schedule
  join public.wordle_words words
    on words.normalized_word = schedule.normalized_word
   and words.active = true
   and words.eligible_answer = true
  on conflict (london_date) do nothing
  returning london_date
)
select count(*)::int as inserted_assignments from inserted;

commit;`

console.log(`Prepared ${assignments.length} London-date assignments from ${startDate}.`)
console.log(`Mode: ${status}. Existing dates will not be changed.`)
await runSqlFile(sql)
