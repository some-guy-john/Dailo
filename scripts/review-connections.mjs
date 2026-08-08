import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { validateConnectionsContent } from './lib/connections-content.mjs'
import { runLinkedSql, sqlString } from './lib/supabase-query.mjs'

const file = process.argv[2]
if (!file || file.startsWith('-')) {
  console.error('Usage: node scripts/review-connections.mjs <puzzles.json>')
  process.exit(1)
}

const puzzles = validateConnectionsContent(JSON.parse(await readFile(file, 'utf8')))
const values = puzzles.map((puzzle) => `(
  ${sqlString(puzzle.date)}::date,
  ${sqlString(JSON.stringify(puzzle.words))}::jsonb,
  ${sqlString(JSON.stringify(puzzle.groups))}::jsonb
)`).join(',\n')
const result = await runLinkedSql(`with proposed(london_date, words, groups) as (values
${values}
)
select proposed.london_date,
       existing.status as existing_status,
       case
         when existing.id is null then 'READY: insert draft'
         when existing.words is distinct from proposed.words or existing.groups is distinct from proposed.groups then 'BLOCK: existing date has different content'
         when existing.status = 'draft' then 'READY: publish draft'
         else 'UNCHANGED: existing puzzle'
       end as review_status
from proposed
left join public.connections_daily_puzzles existing using (london_date)
order by proposed.london_date;`, 'connections-review', true)

console.log(`Reviewed ${puzzles.length} Connections puzzle${puzzles.length === 1 ? '' : 's'}.`)
console.log(result)
if (result.includes('BLOCK:')) {
  console.error('Connections review failed: resolve every BLOCK row before publishing.')
  process.exitCode = 1
}
