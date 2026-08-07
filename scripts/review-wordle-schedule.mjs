import { execFileSync } from 'node:child_process'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

const answersFile = process.argv[2] ?? 'C:/laragon/www/wordle-answers.txt'
const startDate = process.argv[3] ?? '2026-08-08'
const requestedCount = Number.parseInt(process.argv[4] ?? '365', 10)
const spread = process.argv.includes('--spread')
const scheduleStartFlagIndex = process.argv.indexOf('--schedule-start')
const scheduleStartDate = scheduleStartFlagIndex === -1
  ? '2026-08-08'
  : process.argv[scheduleStartFlagIndex + 1]

if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(scheduleStartDate) || !Number.isInteger(requestedCount) || requestedCount < 1) {
  throw new Error('Usage: node scripts/review-wordle-schedule.mjs <answers.txt> <start-date> <count> [--spread] [--schedule-start YYYY-MM-DD]')
}

function parseAnswers(source) {
  const answers = source.split(/\r?\n/).map((line) => line.trim().toUpperCase()).filter((line) => line && !line.startsWith('#'))
  if (answers.some((word) => !/^[A-Z]{5}$/.test(word))) throw new Error('Answer file contains malformed entries.')
  if (new Set(answers).size !== answers.length) throw new Error('Answer file contains duplicate entries.')
  return answers
}

function shiftDate(dateString, days) {
  const date = new Date(`${dateString}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function daysBetween(start, end) {
  const startTimestamp = Date.parse(`${start}T12:00:00Z`)
  const endTimestamp = Date.parse(`${end}T12:00:00Z`)
  return Math.round((endTimestamp - startTimestamp) / 86_400_000)
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
const startOffset = daysBetween(scheduleStartDate, startDate)
if (startOffset < 0) throw new Error(`Review start date must be on or after the schedule start date (${scheduleStartDate}).`)
const assignments = Array.from({ length: requestedCount }, (_, index) => ({
  date: shiftDate(startDate, index),
  answer: answers[((startOffset + index) * (spread ? 37 : 1)) % answers.length],
}))
const values = assignments.map(({ date, answer }) => `(${sqlString(date)}::date, ${sqlString(answer)})`).join(',\n')
const result = await runSqlFile(`with proposed(london_date, normalized_word) as (values
${values}), report as (
  select
    proposed.london_date,
    proposed.normalized_word,
    words.active as answer_active,
    words.eligible_answer,
    assignments.status as existing_status,
    existing_words.normalized_word as existing_word,
    case
      when words.id is null then 'BLOCK: missing answer row'
      when words.active is not true or words.eligible_answer is not true then 'BLOCK: answer is inactive or ineligible'
      when count(*) over (partition by proposed.normalized_word) > 1 then 'BLOCK: proposed answer reused'
      when assignments.id is null then 'READY: insert draft'
      when existing_words.normalized_word is distinct from proposed.normalized_word then 'BLOCK: existing date has another answer'
      when assignments.status = 'draft' then 'READY: publish draft'
      else 'UNCHANGED: existing assignment'
    end as review_status,
    count(*) over (partition by proposed.normalized_word) as proposed_uses
  from proposed
  left join public.wordle_words words on words.normalized_word = proposed.normalized_word
  left join public.wordle_daily_assignments assignments on assignments.london_date = proposed.london_date
  left join public.wordle_words existing_words on existing_words.id = assignments.answer_word_id
)
select london_date, normalized_word, answer_active, eligible_answer, existing_status, existing_word, proposed_uses, review_status
from report
order by london_date;`)

console.log(`Reviewed ${assignments.length} proposed London-date assignments from ${startDate}.`)
console.log(`Schedule anchor: ${scheduleStartDate}.`)
console.log(`Selection: ${spread ? 'spread across the answer list' : 'sequential answer order'}.`)
console.log('Do not publish rows marked BLOCK. Existing assignments marked UNCHANGED are preserved.')
console.log(result)
if (result.includes('BLOCK:')) {
  console.error('Schedule review failed: resolve every BLOCK row before publishing.')
  process.exitCode = 1
}
