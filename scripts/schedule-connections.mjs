import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { validateConnectionsContent } from './lib/connections-content.mjs'
import { runLinkedSql, sqlString } from './lib/supabase-query.mjs'

const file = process.argv[2]
if (!file || file.startsWith('-')) {
  console.error('Usage: node scripts/schedule-connections.mjs <puzzles.json>')
  process.exit(1)
}

const puzzles = validateConnectionsContent(JSON.parse(await readFile(file, 'utf8')))
if (puzzles.some(({ status }) => status !== 'draft')) throw new Error('Scheduling accepts draft puzzles only. Publish them separately after review.')
const values = puzzles.map((puzzle) => `(
  ${sqlString(puzzle.date)}::date,
  ${sqlString(JSON.stringify(puzzle.words))}::jsonb,
  ${sqlString(JSON.stringify(puzzle.groups))}::jsonb
)`).join(',\n')

await runLinkedSql(`begin;
with proposed(london_date, words, groups) as (values
${values}
), inserted as (
  insert into public.connections_daily_puzzles (london_date, words, groups, status)
  select london_date, words, groups, 'draft' from proposed
  on conflict (london_date) do nothing
  returning london_date
)
select count(*)::int as inserted_drafts from inserted;
commit;`, 'connections-schedule')
console.log(`Scheduled ${puzzles.length} validated Connections puzzle${puzzles.length === 1 ? '' : 's'} as drafts. Existing dates were preserved.`)
