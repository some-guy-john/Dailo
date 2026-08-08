# Dailo Games Supabase Setup

The Dailo Release 1 backend keeps Wordo answers and Connections group data behind the Supabase database and Edge Function. The public app must not ship answer data or unsolved Connections groups in its JavaScript bundle.

## Local Setup

1. Install the Supabase CLI.
2. Create a development project.
3. Apply the SQL migration in `migrations/`.
4. Import reviewed Wordo content into `wordle_words`.
5. Add published rows to `wordle_daily_assignments` using `Europe/London` calendar dates.
6. Validate, review, schedule, and publish Connections content with the scripts documented in `content/README.md`.
7. Deploy `functions/wordle`.
8. Configure the frontend with the public Supabase URL and anon key only.

The Edge Function uses `SUPABASE_SERVICE_ROLE_KEY` server-side. Never put that value in the frontend, repository, or issue tracker.

## Function Contract

The `wordle` function accepts JSON POST requests.

Start or resume a game:

```json
{
  "action": "start",
  "mode": "daily",
  "sessionToken": "optional-existing-token",
  "browserId": "optional-local-identifier",
  "recentPuzzleIds": []
}
```

Archive listing:

```json
{
  "action": "archive-list",
  "browserId": "optional-local-identifier"
}
```

Archive requests must include the Supabase access token in an `Authorization: Bearer <access-token>` header. The user must have a confirmed email address.

Start or resume an archived daily:

```json
{
  "action": "start",
  "mode": "archive",
  "archiveDate": "2026-08-01",
  "sessionToken": "optional-existing-token",
  "browserId": "optional-local-identifier"
}
```

Archive requests only accept published dates before the current London date. Archive sessions use the protected guess endpoint but do not contribute to Daily statistics or streaks.

Submit a guess:

```json
{
  "action": "guess",
  "sessionToken": "opaque-session-token",
  "guess": "CRANE",
  "expectedAttempt": 1,
  "idempotencyKey": "unique-request-id"
}
```

The function returns tile results and public state. It returns the answer only after a game is won or lost. Archive listing, archive sessions, and archive guesses require a confirmed Supabase email/password user. Authenticated Archive sessions can be resumed across devices. Daily, Unlimited, and Connections remain anonymously playable.

Connections start:

```json
{
  "action": "connections-start",
  "sessionToken": "optional-existing-token",
  "browserId": "optional-local-identifier"
}
```

Connections submission:

```json
{
  "action": "connections-submit",
  "sessionToken": "opaque-session-token",
  "words": ["APPLE", "MANGO", "PEAR", "PLUM"],
  "idempotencyKey": "unique-request-id"
}
```

Connections returns the 16 playable words and solved groups, but does not return unsolved group labels or memberships until the puzzle is complete. A player has four mistakes.

Each Connections group has one unique difficulty from 1 through 4. The database enforces a complete partition of 16 unique normalized words, protects published puzzle content from ordinary mutation, and permits the submission RPC only through the service-role Edge Function.

When a confirmed user starts or resumes Connections, the server binds a session only after the player proves possession of its token or starts while authenticated. Verified completed Daily sessions provide cross-device Connections statistics through `connections-stats`. Browser-only historical summaries are never uploaded or treated as authoritative.

Connections Archive uses `connections-archive-list`, `connections-archive-stats`, and `connections-start` with `mode: "archive"` plus an `archiveDate`. Only confirmed users may list, start, resume, or submit archive sessions. Archive sessions and statistics are stored separately and never affect Connections Daily streaks.

## Content Import

Validate a JSON file before import:

```bash
npm run validate:content -- content/wordle-words.example.json
```

The example file is intentionally small. Production content should be reviewed, validated, and imported through a controlled process. AI-generated content is draft material and must not be published without human review.
