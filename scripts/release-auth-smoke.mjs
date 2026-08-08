import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const anonKey = process.env.VITE_SUPABASE_ANON_KEY
const emailA = process.env.DAILO_TEST_EMAIL_A
const passwordA = process.env.DAILO_TEST_PASSWORD_A
const emailB = process.env.DAILO_TEST_EMAIL_B
const passwordB = process.env.DAILO_TEST_PASSWORD_B

if (!supabaseUrl || !anonKey || !emailA || !passwordA) {
  console.error('Set VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, DAILO_TEST_EMAIL_A, and DAILO_TEST_PASSWORD_A.')
  process.exit(1)
}

const functionUrl = `${supabaseUrl}/functions/v1/wordle`
const connectionsFunctionUrl = functionUrl

function check(condition, message) {
  if (!condition) throw new Error(message)
  console.log(`PASS ${message}`)
}

async function signIn(email, password) {
  const client = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error || !data.session || !data.user) throw new Error(`Sign-in failed for ${email}: ${error?.message ?? 'missing session'}`)
  check(Boolean(data.user.email_confirmed_at), `confirmed account ${data.user.id}`)
  return { client, user: data.user, token: data.session.access_token }
}

async function invoke(url, token, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const payload = await response.json()
  return { response, payload }
}

function requireSuccess(result, label) {
  check(result.response.ok && !result.payload.error, `${label} (${result.response.status})`)
  return result.payload
}

function requireError(result, code, label) {
  check(result.response.status === code.status && result.payload.error?.code === code.code, `${label} (${result.response.status} ${code.code})`)
}

async function runAccountA() {
  const account = await signIn(emailA, passwordA)
  const dailyFirst = requireSuccess(await invoke(functionUrl, account.token, {
    action: 'start', mode: 'daily', browserId: 'release-smoke-account-a-device-1',
  }), 'account A starts Daily')
  check(dailyFirst.state.accountOwned === true, 'Daily session is account-owned')
  check(dailyFirst.state.answer === null, 'Daily start does not reveal the answer')

  const dailySecond = requireSuccess(await invoke(functionUrl, account.token, {
    action: 'start', mode: 'daily', browserId: 'release-smoke-account-a-device-2',
  }), 'account A resumes Daily on a second device')
  check(dailySecond.state.sessionId === dailyFirst.state.sessionId, 'Daily resume keeps the same server session')
  check(dailySecond.sessionToken !== dailyFirst.sessionToken, 'Second device receives a distinct capability token')

  const archiveList = requireSuccess(await invoke(functionUrl, account.token, { action: 'archive-list' }), 'account A lists Wordo Archive')
  const archiveDate = archiveList.archives?.find((archive) => archive.status === null)?.date
  if (archiveDate) {
    const archiveFirst = requireSuccess(await invoke(functionUrl, account.token, {
      action: 'start', mode: 'archive', archiveDate, browserId: 'release-smoke-account-a-device-1',
    }), 'account A starts Wordo Archive')
    const archiveSecond = requireSuccess(await invoke(functionUrl, account.token, {
      action: 'start', mode: 'archive', archiveDate, browserId: 'release-smoke-account-a-device-2',
    }), 'account A retries Wordo Archive from another device')
    check(archiveSecond.state.sessionId === archiveFirst.state.sessionId, 'Wordo Archive retry keeps the same server session')
    check(archiveSecond.sessionToken !== archiveFirst.sessionToken, 'Wordo Archive retry receives a distinct capability token')
  } else {
    console.log('SKIP no unplayed Wordo Archive date is available')
  }
  requireSuccess(await invoke(functionUrl, account.token, { action: 'archive-stats' }), 'account A reads Wordo Archive stats')

  const connectionsList = requireSuccess(await invoke(connectionsFunctionUrl, account.token, { action: 'connections-archive-list' }), 'account A lists Connections Archive')
  const connectionsDate = connectionsList.connectionsArchives?.find((archive) => archive.status === null)?.date
  if (connectionsDate) {
    const connectionsFirst = requireSuccess(await invoke(connectionsFunctionUrl, account.token, {
      action: 'connections-start', mode: 'archive', archiveDate: connectionsDate, browserId: 'release-smoke-account-a-device-1',
    }), 'account A starts Connections Archive')
    const connectionsSecond = requireSuccess(await invoke(connectionsFunctionUrl, account.token, {
      action: 'connections-start', mode: 'archive', archiveDate: connectionsDate, browserId: 'release-smoke-account-a-device-2',
    }), 'account A retries Connections Archive from another device')
    check(connectionsSecond.state.sessionId === connectionsFirst.state.sessionId, 'Connections Archive retry keeps the same server session')
    check(connectionsSecond.sessionToken !== connectionsFirst.sessionToken, 'Connections Archive retry receives a distinct capability token')
  } else {
    console.log('SKIP no unplayed Connections Archive date is available')
  }
  requireSuccess(await invoke(connectionsFunctionUrl, account.token, { action: 'connections-archive-stats' }), 'account A reads Connections Archive stats')

  await account.client.auth.signOut()
  const recovered = await signIn(emailA, passwordA)
  requireSuccess(await invoke(functionUrl, recovered.token, { action: 'account-history' }), 'account A recovers after sign-out/sign-in')
  return { account, dailyToken: dailyFirst.sessionToken, dailySessionId: dailyFirst.state.sessionId }
}

async function runAccountB(accountA) {
  if (!emailB || !passwordB) {
    console.log('SKIP account isolation: set DAILO_TEST_EMAIL_B and DAILO_TEST_PASSWORD_B')
    return
  }
  const accountB = await signIn(emailB, passwordB)
  const dailyB = requireSuccess(await invoke(functionUrl, accountB.token, {
    action: 'start', mode: 'daily', browserId: 'release-smoke-account-b-device-1',
  }), 'account B starts Daily')
  check(dailyB.state.sessionId !== accountA.dailySessionId, 'Account B receives an isolated Daily session')
  requireError(await invoke(functionUrl, accountB.token, {
    action: 'start', mode: 'daily', sessionToken: accountA.dailyToken, browserId: 'release-smoke-account-b-device-2',
  }), { status: 401, code: 'invalid_session' }, 'account B cannot use account A capability')
}

const accountA = await runAccountA()
await runAccountB(accountA)
console.log('Authenticated release smoke checks completed.')
