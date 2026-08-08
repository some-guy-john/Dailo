import process from 'node:process'
import { runLinkedSql, sqlString } from './lib/supabase-query.mjs'

const startDate = process.argv[2]
const endDate = process.argv[3] ?? startDate
const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') && !Number.isNaN(Date.parse(`${value}T12:00:00Z`))
if (!validDate(startDate) || !validDate(endDate) || startDate > endDate) {
  console.error('Usage: node scripts/publish-connections.mjs <start-date> [end-date]')
  process.exit(1)
}

await runLinkedSql(`begin;
update public.connections_daily_puzzles
set status = 'published',
    published_at = coalesce(published_at, now()),
    updated_at = now()
where london_date between ${sqlString(startDate)}::date and ${sqlString(endDate)}::date
  and status = 'draft';
select count(*)::int as published_puzzles
from public.connections_daily_puzzles
where london_date between ${sqlString(startDate)}::date and ${sqlString(endDate)}::date
  and status = 'published';
commit;`, 'connections-publish')
console.log(`Published reviewed Connections drafts from ${startDate} through ${endDate}.`)
