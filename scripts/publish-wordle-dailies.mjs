import { execFileSync } from 'node:child_process'
import { unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

const startDate = process.argv[2]
const requestedCount = Number.parseInt(process.argv[3] ?? '30', 10)

if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > 365) {
  console.error('Usage: node scripts/publish-wordle-dailies.mjs <start-date> <count>')
  process.exit(1)
}

function shiftDate(dateString, days) {
  const date = new Date(`${dateString}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`
}

const endDate = shiftDate(startDate, requestedCount - 1)
const command = process.platform === 'win32' ? process.execPath : 'npx'
const commandArgs = process.platform === 'win32'
  ? [join(process.cwd(), 'node_modules', 'supabase', 'dist', 'supabase.js')]
  : ['supabase']
const sqlFile = join(tmpdir(), `dailies-wordle-publish-${process.pid}.sql`)
const sql = `begin;

update public.wordle_daily_assignments assignments
set status = 'published',
    published_at = coalesce(assignments.published_at, now()),
    updated_at = now()
from public.wordle_words words
where assignments.answer_word_id = words.id
  and assignments.london_date between ${sqlString(startDate)}::date and ${sqlString(endDate)}::date
  and assignments.status = 'draft'
  and words.active = true
  and words.eligible_answer = true;

select count(*)::int as published_assignments
from public.wordle_daily_assignments
where london_date between ${sqlString(startDate)}::date and ${sqlString(endDate)}::date
  and status = 'published';

commit;`

await writeFile(sqlFile, sql, 'utf8')
try {
  console.log(`Publishing draft assignments from ${startDate} through ${endDate}...`)
  execFileSync(command, [...commandArgs, 'db', 'query', '--linked', '--file', sqlFile], {
    cwd: process.cwd(),
    stdio: ['ignore', 'inherit', 'inherit'],
  })
} finally {
  await unlink(sqlFile).catch(() => {})
}
