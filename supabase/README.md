# Supabase Release 1 Setup

Release 1 keeps answers behind the Supabase database and Edge Function. The public app must not ship the answer bank or the current answer in its JavaScript bundle.

## Local Setup

1. Install the Supabase CLI.
2. Create a development project.
3. Apply the SQL migration in `migrations/`.
4. Import reviewed content into `wordle_words`.
5. Add published rows to `wordle_daily_assignments` using `Europe/London` calendar dates.
6. Deploy `functions/wordle`.
7. Configure the frontend with the public Supabase URL and anon key only.

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

The function returns tile results and public state. It returns the answer only after a game is won or lost.

## Content Import

Validate a JSON file before import:

```bash
npm run validate:content -- content/wordle-words.example.json
```

The example file is intentionally small. Production content should be reviewed, validated, and imported through a controlled process. AI-generated content is draft material and must not be published without human review.
