# Wordle Content

The current source word list was supplied as `C:\laragon\www\wordle-answers.txt`.

Validate it without changing Supabase:

```powershell
npm run validate:content -- C:\laragon\www\wordle-answers.txt
```

Import it in safe batches:

```powershell
npm run import:words -- C:\laragon\www\wordle-answers.txt
```

The importer only writes to `public.wordle_words`. It uses normalized-word conflicts so rerunning it is safe and does not touch any other application tables.

This list is currently used for both accepted guesses and eligible answers. A separate accepted-guess list can be introduced later without changing the import boundary.
