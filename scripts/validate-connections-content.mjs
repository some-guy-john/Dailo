import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { validateConnectionsContent } from './lib/connections-content.mjs'

const file = process.argv[2]
if (!file || file.startsWith('-')) {
  console.error('Usage: node scripts/validate-connections-content.mjs <puzzles.json>')
  process.exit(1)
}

const puzzles = validateConnectionsContent(JSON.parse(await readFile(file, 'utf8')))
console.log(`Validated ${puzzles.length} Connections puzzle${puzzles.length === 1 ? '' : 's'} from ${file}.`)
