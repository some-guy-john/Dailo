import { execFileSync } from 'node:child_process'
import { unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

export function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`
}

export async function runLinkedSql(sql, label, capture = false) {
  const command = process.platform === 'win32' ? process.execPath : 'npx'
  const commandArgs = process.platform === 'win32'
    ? [join(process.cwd(), 'node_modules', 'supabase', 'dist', 'supabase.js')]
    : ['supabase']
  const sqlFile = join(tmpdir(), `dailies-${label}-${process.pid}.sql`)
  await writeFile(sqlFile, sql, 'utf8')
  try {
    return execFileSync(command, [...commandArgs, 'db', 'query', '--linked', '--file', sqlFile], {
      cwd: process.cwd(),
      encoding: capture ? 'utf8' : undefined,
      stdio: capture ? undefined : ['ignore', 'inherit', 'inherit'],
    })
  } finally {
    await unlink(sqlFile).catch(() => {})
  }
}
