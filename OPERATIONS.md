# Dailo Release 1 Operations

This runbook covers the production project `imndxrsbavywbsnyreyz` and the GitHub Pages deployment at `https://some-guy-john.github.io/Dailo/`.

## Health Checks

Run the public site check after every Pages deployment:

```powershell
curl.exe --fail --silent --show-error --retry 5 --retry-delay 5 https://some-guy-john.github.io/Dailo/
```

Run the function reachability checks with the public anon key. These requests must return application-level errors rather than gateway authentication errors:

```powershell
$env:DAILO_SUPABASE_ANON_KEY="public-anon-key"
npm run health:production
```

The health script checks:

- `wordle` rejects an unknown action with `400 invalid_action`.
- `wordo-versus` rejects an unknown action with `400 invalid_action`.
- `dailo-admin` rejects an anonymous request with `401 admin_auth_required`.

These checks do not create games, modify content, or expose answers.

## Standard Deployment

1. Confirm the working tree contains only intended files.
2. Run `npm test`, `npm run build`, content validation, local database lint, pgTAP, and Playwright.
3. Confirm linked migration parity with `npx supabase migration list --linked`.
4. Run `npx supabase db lint --linked`.
5. Push the approved commit to `main`.
6. Wait for the GitHub Actions `Deploy to GitHub Pages` workflow to pass.
7. Run the site and function health checks.
8. Review Supabase Edge Function logs for unexpected errors.

Deploy Edge Functions only after their migrations are applied. Gateway JWT verification stays disabled because anonymous game requests are supported; each function performs its own request-level authorization:

```powershell
npx supabase functions deploy wordle --project-ref imndxrsbavywbsnyreyz --no-verify-jwt --use-api
npx supabase functions deploy wordo-versus --project-ref imndxrsbavywbsnyreyz --no-verify-jwt --use-api
npx supabase functions deploy dailo-admin --project-ref imndxrsbavywbsnyreyz --no-verify-jwt --use-api
```

## Content Backups

Supabase is the source of truth. Before meaningful content changes, export the published schedules and source content using the authenticated operator connection. Store exports outside the repository and restrict access to operators.

At minimum, preserve:

- `wordle_words` including `normalized_word`, `accepted_guess`, `eligible_answer`, and `active`.
- `wordle_daily_assignments` including dates, answer references, statuses, and publication times.
- `connections_daily_puzzles` including dates, words, groups, statuses, and publication times.
- The migration commit or tag used for the release.

Do not export or share session tokens, auth credentials, service-role keys, or unpublished answers through tickets or chat. A content export is for recovery and review; it is not a frontend fixture.

## Migration Rollback

Migrations are append-only. Do not edit or delete an applied migration and do not use `supabase db reset` against production.

1. Stop the release and record the failing migration, function version, and timestamp.
2. Keep the last known-good frontend commit and Edge Function versions available.
3. If the migration is additive, deploy a forward corrective migration after review and local/linked lint.
4. If the migration changes behavior, deploy the previous compatible Edge Function version while the corrective migration is prepared.
5. Re-run migration parity, linked lint, pgTAP, health checks, and authenticated smoke tests.
6. Record the incident and corrective commit in the release notes.

Never reverse a migration by manually dropping tables or columns that may contain player progress. Preserve session and content references unless a reviewed data-recovery procedure explicitly says otherwise.

## Frontend Rollback

GitHub Pages deploys from `main` through GitHub Actions. To roll back a frontend regression:

1. Identify the last known-good commit from the workflow history.
2. Create a new revert commit or revert branch; do not rewrite `main` history.
3. Run the normal test and build workflow.
4. Push the revert and wait for the Pages deployment to pass.
5. Run the public site and function health checks.

The frontend may be rolled back independently only when its function and database contracts remain compatible. If not, roll back or forward-deploy the Edge Functions first.

## Monitoring

Use the Supabase dashboard Function Logs for `wordle`, `wordo-versus`, and `dailo-admin`. Filter for:

- `wordle_function_error`
- `wordo_versus_error`
- `dailo_admin_error`
- HTTP `429`, `500`, and `503` responses
- Sudden increases in invalid session or expired session responses

Logs must not contain bearer tokens, session tokens, answer words before completion, passwords, or service-role credentials. Capture the function name, outcome, error category, approximate time, and a non-sensitive correlation identifier when investigating.

## Rate-Limit Maintenance

Rate-limit buckets are hashed and safe to remove after their window has elapsed. Migration `202608080015` adds opportunistic cleanup; no manual cleanup is normally required.

If the table grows unexpectedly, inspect counts and age through an authenticated operator connection, then remove only stale rows after confirming no incident investigation depends on them. Never grant browser roles access to `dailo_rate_limits`.

## Admin Access

`DAILO_ADMIN_USER_IDS` is a protected comma-separated allowlist. Add only confirmed user UUIDs approved by the project owner:

```powershell
npx supabase secrets set --project-ref imndxrsbavywbsnyreyz DAILO_ADMIN_USER_IDS="user-uuid" DAILO_ENVIRONMENT="production"
npx supabase functions deploy dailo-admin --project-ref imndxrsbavywbsnyreyz --no-verify-jwt --use-api
```

An empty allowlist is fail-closed. After changing it, verify anonymous denial and authenticated admin overview without creating or publishing content.
