# Dailo

## Document Status

This document defines the product and technical requirements for the first public release of **Dailo**. The first games are **Wordo** and **Connections**; technical compatibility names such as `wordle_words` and the `wordle` Edge Function are intentionally retained in the backend.

Release 1 is intentionally limited to polished daily puzzle games with:

- One shared daily puzzle
- Curated unlimited puzzles
- Local progress and statistics
- Confirmed-account archive replay for published past editions
- Responsive and accessible play
- Server-side protection of puzzle answers
- Four-group Connections puzzles with protected group data

Full account-backed Wordo history, multiplayer, crosswords, public profiles, leaderboards, chat, advertising, and a graphical admin panel are not part of Release 1. Archive access uses a confirmed email/password account. Daily, Unlimited, and Connections remain playable anonymously; signed-in Connections players sync server-verified current and future Daily results.

---

## 1. Product Summary

**Dailo** is a lightweight web platform for daily and replayable word and puzzle games.

The first public release contains Wordo and Connections. Both games should feel complete and reliable on phones and desktop browsers before additional games or social features are considered.

### Current Implementation

The deployed Release 1 experience includes:

- Dailo games hub and shared navigation shell
- Wordo Daily and Wordo Unlimited modes
- Daily Connections mode with four hidden groups of four words
- Confirmed-account Wordo Archive browsing for published past editions
- Confirmed-account Connections Archive with separate replay statistics
- Supabase email/password accounts for Archive access, including email confirmation and password recovery
- Cross-device resume for authenticated Archive sessions
- Server-synced Archive play statistics
- Protected Supabase sessions and server-authoritative guesses
- Protected Connections sessions and server-authoritative group submissions
- Connections sharing, local statistics, and signed-in verified Daily result sync
- London-time daily rollover handling
- Browser-local stats, streaks, preferences, and refresh recovery
- Responsive mobile and desktop layout with reduced-motion and high-contrast options
- GitHub Pages deployment at `https://some-guy-john.github.io/Dailo/`

The current content schedule contains 91 published daily assignments and 275 reviewed drafts through `2026-11-05`. Future content is published through the controlled scripts in `scripts/`, not from the public frontend.

The priorities, in order, are:

1. Correct game behavior
2. A polished mobile experience
3. Accessibility
4. Reliable daily scheduling and saved progress
5. Protection against casual answer discovery
6. Simple, inexpensive operation
7. A codebase that can be extended without designing speculative systems in advance

---

## 2. Release 1 Scope

### 2.1 Included

Release 1 includes:

- Daily Wordo
- Wordo Unlimited
- Daily Connections
- A shared game shell and navigation
- On-screen and physical-keyboard input
- Mobile and desktop layouts
- Local game recovery after refresh or browser restart
- Local daily and unlimited statistics
- Daily streaks
- Spoiler-free result sharing
- Light, dark, and system theme preferences
- Reduced-motion support
- Server-side game-session and guess validation
- A curated answer bank
- Automated tests
- Deployment to GitHub Pages
- Supabase-backed protected puzzle data and Edge Functions

### 2.2 Excluded

Release 1 does not include:

- Full account-backed Daily or Unlimited history
- General cross-device synchronization outside authenticated Archive sessions
- Multiplayer or Versus mode
- Timers
- Matchmaking
- Public profiles
- Leaderboards
- Friend systems
- Chat
- User-created puzzles
- Crosswords
- A graphical admin panel
- Advertising
- Analytics
- Push notifications
- Progressive Web App installation
- Advanced anti-cheat guarantees

Excluded features must not influence the Release 1 schema or architecture unless they create a clear, immediate requirement.

---

## 3. Product Principles

### 3.1 Polish Over Breadth

A smaller complete product is preferable to a larger partially reliable product.

A feature is not complete until it has:

- Defined behavior
- Error handling
- Mobile behavior
- Keyboard behavior
- Accessible feedback
- Persistence behavior
- Automated test coverage where practical

### 3.2 Minimal Personal Data

Daily and Unlimited do not require an account, name, email address, public profile, or social identity. Archive access requires a confirmed email/password account, but does not expose a public profile or social identity.

The system may store technical data needed to operate game sessions, prevent malformed requests, and enforce basic rate limits. It must not intentionally collect personal profile data.

### 3.3 Honest Enforcement

Anonymous daily play can only be limited per browser installation or game session. Release 1 must not claim that one play per human is globally enforceable.

### 3.4 Build for Current Requirements

Wordo-specific logic and tables are acceptable.

The project may share layout, theme, and navigation components, but it must not create a generic puzzle engine, generic crossword schema, or universal multiplayer system during Release 1.

---

## 4. Technology Decisions

### 4.1 Frontend

The frontend will use:

- React
- TypeScript
- Vite
- CSS modules or a similarly simple component-scoped styling approach
- Vitest for unit and component tests
- Playwright for critical browser flows

The frontend will be deployed as a static site on GitHub Pages.

Routing must work correctly on GitHub Pages. Release 1 should use hash-based routing or avoid routes that require server-side fallback configuration.

### 4.2 Backend

Supabase will provide:

- PostgreSQL storage
- Edge Functions
- Protected server-side operations
- Deployment secrets

The browser must never receive:

- The Supabase service-role key
- The full answer bank
- Future daily answers
- The current answer before a game ends
- Administrative database access

### 4.3 Browser Storage

Release 1 will use browser storage for:

- Current local game state needed to recover the UI
- Opaque game-session tokens
- Daily result history
- Unlimited result history
- Streak display data
- Recently played unlimited puzzle identifiers
- Theme preference
- Reduced-motion and other local preferences

Local storage is not treated as secure or authoritative. The server remains authoritative for accepted guesses, attempt counts, game completion, and answer disclosure.

### 4.4 Authentication

Daily and Unlimited remain available without an account. Archive requires a confirmed email/password account through Supabase Auth.

Each game is authorized with an opaque, unguessable session token created by the server. Archive requests also carry the Supabase access token, and the server verifies the user and confirmed email before allowing archive listing, session creation, resume, or guesses.

A browser-installation identifier may be generated locally for anonymous Daily and Unlimited continuity and basic abuse controls. It is not an account and must not be presented as one.

---

## 5. Core Wordo Rules

### 5.1 Puzzle Rules

- Every answer contains exactly five English alphabetic letters.
- A player receives at most six accepted guesses.
- Guesses are case-insensitive.
- Displayed letters use a consistent uppercase presentation.
- A guess must contain exactly five alphabetic letters.
- A guess must exist in the accepted-guess list.
- Invalid guesses do not consume an attempt.
- A completed or failed game cannot accept additional guesses.
- Hard mode is not included in Release 1.
- Solo play has no timer.

### 5.2 Repeated-Letter Scoring

Scoring must follow the standard two-pass Wordo algorithm:

1. Mark exact-position matches.
2. Count the unmatched letters remaining in the answer.
3. Evaluate the unmatched guess letters from left to right.
4. Mark a letter present only while an unmatched copy remains available.
5. Mark all other letters absent.

The scoring function must be pure, deterministic, and thoroughly unit tested before backend integration.

### 5.3 Keyboard State

A keyboard letter may have one of these states:

- Unknown
- Absent
- Present
- Correct

A stronger result must never be replaced by a weaker result. For example, a letter already marked correct must not later appear absent because of another copy in a guess.

---

## 6. Daily Mode

### 6.1 Shared Daily Puzzle

- There is one shared daily puzzle for each London calendar date.
- The active date uses the `Europe/London` timezone.
- The schedule therefore follows GMT and BST automatically.
- The server, not the device clock, determines the active daily date.
- Exactly one published daily assignment may exist for a date.
- A daily assignment cannot be silently changed after players have begun it.

### 6.2 Starting and Resuming

When the player opens Daily mode:

1. The client asks the server for the current London date.
2. The client checks for a locally stored unfinished session for that date.
3. If one exists, it resumes using the stored opaque session token.
4. Otherwise, the client requests a new daily session.
5. The server creates or returns the applicable session without revealing the answer.

Refreshing or closing the browser must not discard an active daily game.

### 6.3 Midnight Behavior

A game session remains tied to the London date on which it was created.

If midnight passes while a daily game is unfinished:

- The player may finish the existing session.
- The result counts toward the original puzzle date.
- After completion, the current day's puzzle becomes available.
- The client must clearly label the older puzzle date to avoid confusion.

This avoids invalidating an active game at midnight while preserving one shared puzzle per date.

### 6.4 Daily Completion Limit

Release 1 enforces one recorded daily result per browser installation and server game session.

This is a convenience rule, not a guarantee that one human cannot replay using another browser, cleared storage, or another device.

### 6.5 Daily Statistics

Release 1 tracks locally:

- Games played
- Games won
- Win percentage
- Current streak
- Maximum streak
- Guess distribution
- Last completed daily date

The displayed statistics can be lost if the player clears browser data. The interface should state this where appropriate and must not imply cloud backup.

### 6.6 Streak Rules

A daily streak counts consecutive London puzzle dates won.

The rules are:

- Winning the current daily after winning the immediately preceding daily increases the streak by one.
- Winning after one or more missed dates starts a new streak at one.
- Losing a daily sets the current streak to zero.
- A missed date breaks continuity but does not require an explicit stored loss.
- Reopening an already completed puzzle does not change the streak.
- Finishing an older in-progress session after midnight applies the result to that session's original date.
- Results must be applied idempotently so refreshing or repeating a completion response cannot increment statistics twice.
- Maximum streak changes only when the new current streak exceeds it.

The streak should be derived and updated from stored dated results rather than from the device's current clock alone.

### 6.7 Sharing

After a daily game ends, the player can copy a spoiler-free result containing:

- Product name
- Puzzle date or public puzzle number
- Attempts used, or `X/6` for a loss
- A grid of result symbols
- Optional hard-mode marker only if hard mode is added in a later release

The answer and guessed words must not appear in the shared text.

---

## 7. Wordo Unlimited Mode

### 7.1 Puzzle Selection

Unlimited puzzles use the curated answer bank.

When a player starts a new unlimited game:

- The server selects an eligible answer.
- The answer is not returned to the browser.
- The selected puzzle must not be the current daily answer.
- The server should avoid the player's recently completed unlimited puzzles when possible.
- Selection may be random among eligible puzzles in Release 1.
- If the exclusion history leaves no eligible puzzle, older exclusions may be ignored.

### 7.2 Recent-Puzzle Exclusion

The client will retain the identifiers of the 20 most recently completed unlimited puzzles.

The server may use this list as a selection hint. The server must validate the list and must not trust it for authorization or protected data access.

### 7.3 Unlimited Statistics

Unlimited statistics are tracked separately from daily statistics.

They may include:

- Games played
- Games won
- Win percentage
- Guess distribution

Unlimited games do not affect the daily current streak or maximum streak.

### 7.4 Restart Behavior

- Refreshing resumes the current unlimited game.
- A player may abandon an unfinished unlimited game and start another.
- Abandoning does not count as a loss unless the player explicitly chooses a future setting that changes this rule.
- Only one active unlimited session needs to be recoverable in Release 1.

---

## 8. Server Game Flow

### 8.1 Start Daily Session

The client submits a request to start or resume the daily puzzle.

The server:

1. Determines the current London date.
2. Finds the published puzzle assignment.
3. Creates a game session or validates a resumable session.
4. Returns an opaque session token and public state.
5. Does not return the answer.

### 8.2 Start Unlimited Session

The client submits recent puzzle identifiers.

The server:

1. Validates and limits the exclusion list.
2. Excludes the current daily answer.
3. Selects an eligible curated puzzle.
4. Creates a game session.
5. Returns an opaque session token and public state.
6. Does not return the answer.

### 8.3 Submit Guess

The client submits:

- Session token
- Guess
- Expected attempt sequence number
- Request idempotency key

The server validates:

- Session existence
- Session token
- Session mode
- Session status
- Puzzle availability
- Guess format
- Guess membership in the accepted-guess list
- Attempt sequence
- Attempt limit
- Duplicate request status
- Basic rate limits

The server then:

1. Scores the guess.
2. Stores the accepted attempt.
3. Updates the session state atomically.
4. Returns tile feedback and public game state.
5. Returns the answer only if the game has ended.

### 8.4 Idempotency

A duplicate submission with the same idempotency key must return the original result instead of consuming another attempt.

Two requests for the same attempt sequence must not both be accepted.

### 8.5 Failure Responses

The API must distinguish at least:

- Invalid session
- Expired session
- Invalid guess format
- Guess not in accepted list
- Attempt sequence conflict
- Game already complete
- Rate limit reached
- Temporary server failure

User-facing messages should be clear without exposing sensitive internals.

---

## 9. Data Model

The exact SQL may evolve, but Release 1 should use clear Wordo-specific entities. The current SQL names remain `wordle_*` for compatibility with the deployed database and function contract.

### 9.1 `wordle_words`

Stores accepted guesses and candidate answers.

Required concepts:

- Stable internal identifier
- Normalized five-letter word
- Whether the word is accepted as a guess
- Whether the word is eligible as an answer
- Active or retired status
- Creation and update timestamps

Constraints:

- Words are unique after normalization.
- Words contain exactly five permitted letters.
- Retired words cannot be selected for new sessions.

### 9.2 `wordle_daily_assignments`

Stores one answer assignment per London date.

Required concepts:

- London calendar date
- Answer word identifier
- Publication status
- Publication timestamp
- Creation and update timestamps

Constraints:

- At most one assignment exists per date.
- Only published assignments may be played.
- A published assignment used by an active or completed session should not be changed through ordinary content operations.

### 9.3 `wordle_game_sessions`

Stores authoritative game state.

Required concepts:

- Session identifier
- Hashed session token or secure token reference
- Mode: daily or unlimited
- Puzzle word identifier
- Daily date when applicable
- Status: active, won, lost, abandoned, or expired
- Accepted attempt count
- Created timestamp
- Completed timestamp
- Expiration timestamp where applicable

Constraints:

- Attempt count is between zero and six.
- Completed sessions cannot return to active status.
- A daily session references exactly one daily date.
- An unlimited session has no daily date.
- The current daily answer cannot be selected for a new unlimited session.

### 9.4 `wordle_attempts`

Stores accepted guesses.

Required concepts:

- Session identifier
- Sequence number
- Guess word or normalized guess
- Tile result
- Idempotency key
- Accepted timestamp

Constraints:

- Sequence number is unique within a session.
- Idempotency key is unique within a session.
- Sequence numbers are limited to one through six.
- Attempts cannot be added to completed sessions.

### 9.5 Direct Client Access

The browser must not have direct read access to:

- Answer-eligible words
- Daily assignments containing answers
- Game-session puzzle references
- Attempts belonging to other sessions

Protected operations must occur through Edge Functions.

---

## 10. Security Requirements

### 10.1 Threat Model

Release 1 aims to prevent:

- Accidental answer exposure in frontend bundles
- Casual inspection of network responses for unrevealed answers
- Direct browsing of the answer bank
- Manipulation of accepted attempt counts
- Guess submission after game completion
- Basic automated abuse

Release 1 does not claim to prevent:

- A determined user replaying through another browser or device
- Screen scraping
- Automated play using valid public endpoints
- All forms of answer-bank harvesting
- Device compromise
- Advanced denial-of-service attacks

### 10.2 Secrets

- The service-role key exists only in protected server-side configuration.
- Public frontend environment variables may contain only publishable values.
- Secrets must not be committed to the repository.
- Production and local-development secrets must be separate.

### 10.3 Database Access

- Row Level Security must be enabled on exposed tables.
- Sensitive answer and session tables should deny direct anonymous reads.
- Edge Functions may perform privileged operations using server-side credentials.
- Privileged operations must validate all client-provided identifiers.
- Administrative content changes must not be available from the public frontend.

### 10.4 Rate Limiting

Apply basic limits to:

- Creating sessions
- Guess submissions per session
- Guess submissions per browser identifier
- Repeated invalid guesses
- Requests from one network source where practical

Limits must be generous enough not to punish ordinary play.

### 10.5 Token Handling

- Session tokens must be unguessable.
- Plain session tokens should not be stored in database rows when a secure hash can be used.
- Tokens must never appear in logs.
- Tokens must expire after a reasonable period.
- Daily sessions should remain valid long enough to support finishing after midnight.
- Completed sessions may retain read-only result access for local recovery.

---

## 11. Content Workflow

Release 1 will not include a graphical admin panel.

Puzzle content will be managed through a controlled import process using versioned JSON or CSV files and a validation script.

The workflow is:

1. Prepare candidate words and daily assignments.
2. Run automated validation.
3. Run the read-only schedule review and resolve every `BLOCK` row or answer reuse warning.
4. Review the proposed changes manually.
5. Import them into the non-production environment.
6. Test representative puzzles.
7. Apply the approved migration or import to production.
8. Export a backup after meaningful content changes.

Validation must reject:

- Invalid word length
- Invalid characters
- Duplicate normalized words
- Duplicate daily dates
- Missing answer references
- Inactive answer words
- Assignments that would expose or reuse content against defined rules
- Unpublished dates with malformed state

AI-generated word lists are draft material only. They must not be published without validation and human review.

Supabase remains the source of truth. Export files are for review, migration, and backup rather than routine client delivery.

---

## 12. User Experience Requirements

### 12.1 Layout

The game must work at a minimum viewport width of 320 CSS pixels without horizontal scrolling during ordinary play.

The primary board, keyboard, title, and controls should fit within the visible mobile layout as much as practical.

Desktop layouts should not stretch the game board excessively.

### 12.2 Input

Support:

- On-screen keyboard
- Physical keyboard
- Touch input
- Mouse input

Required keys:

- A–Z
- Enter
- Backspace or Delete

Input must be disabled while a guess request is being committed, while preserving responsive visual feedback.

### 12.3 Loading and Errors

The interface must provide visible states for:

- Initial loading
- Restoring a session
- Submitting a guess
- Recoverable network failure
- Session expiration
- Missing daily assignment
- Service unavailability

A failed network request must not silently consume a local attempt.

### 12.4 Theme

Release 1 includes:

- Follow system theme
- Light theme
- Dark theme

The preference is stored locally.

### 12.5 Motion

Animations should be restrained.

When the user prefers reduced motion:

- Tile flips should be replaced with minimal transitions.
- Keyboard and modal animations should be shortened or removed.
- No important information may depend on animation.

### 12.6 Sound

Sound effects are excluded from Release 1.

---

## 13. Accessibility Requirements

All core actions must be usable with a physical keyboard.

The implementation must provide:

- Visible focus indicators
- Logical focus order
- Text or accessible labels for every keyboard button
- Status announcements for invalid guesses, accepted guesses, wins, and losses
- Tile feedback that is not communicated by color alone
- Sufficient contrast for text, controls, and tile states
- Reduced-motion behavior
- Clear modal focus management
- No keyboard traps
- Accessible names for settings and share controls

For screen-reader feedback, each submitted row should be announced in a compact form such as:

- Letter, correct
- Letter, present
- Letter, absent

The visual board may use color, but shape, text, iconography, or accessible descriptions must provide equivalent information.

---

## 14. Testing Strategy

### 14.1 Unit Tests

Required unit-test areas:

- Repeated-letter scoring
- Input normalization
- Guess validation
- Keyboard-state precedence
- Streak calculation
- Daily-date comparison
- Share-text generation
- Local result deduplication
- Unlimited recent-puzzle history

### 14.2 Backend Tests

Required backend-test areas:

- Starting a daily session
- Resuming a session
- Starting an unlimited session
- Excluding the current daily answer
- Invalid session tokens
- Invalid words
- Duplicate idempotency keys
- Conflicting attempt sequences
- Seventh-guess rejection
- Completed-game rejection
- Answer disclosure only after completion
- London midnight behavior
- GMT/BST date transitions
- Rate-limit behavior
- Missing daily assignment

### 14.3 Browser Tests

Critical end-to-end flows:

- Complete and win a daily puzzle
- Lose a daily puzzle
- Refresh midway and resume
- Close and reopen midway and resume
- Share a completed result
- Start and complete unlimited games
- Verify unlimited does not change daily streak
- Change theme
- Play entirely with a physical keyboard
- Recover from a failed guess request
- Display a useful service-error state

### 14.4 Manual Checks

Before release, manually test:

- At least one small phone-sized viewport
- A larger phone
- A desktop browser
- Touch input
- Physical keyboard input
- Screen-reader announcements
- Reduced-motion behavior
- Light and dark themes
- Poor or interrupted network conditions

---

## 15. Observability and Operations

Release 1 should keep operations simple but must support diagnosis.

The backend should log:

- Function name
- Request outcome
- Anonymous request correlation identifier
- Error category
- Duration
- Session identifier in a non-sensitive or hashed form

Logs must not contain:

- Session tokens
- Answers before game completion
- Service-role credentials
- Full client storage data

The project should define:

- A production Supabase project
- A separate local or development environment
- Database migrations under version control
- A documented content backup process
- A documented deployment rollback process
- A simple service-health check
- A maximum acceptable monthly hosting budget

Release 1 does not require a third-party analytics platform.

---

## 16. Development Plan

### Milestone 0: Rules Engine

Deliver:

- Pure Wordo scoring function
- Comprehensive repeated-letter tests
- Guess normalization and validation
- Keyboard-state calculation

Exit condition:

- All game-rule unit tests pass.
- The rules engine has no UI or database dependencies.

### Milestone 1: Local Playable UI

Deliver:

- Responsive board
- On-screen keyboard
- Physical-keyboard input
- Win and loss states
- Local temporary puzzles
- Local recovery
- Basic theme support
- Initial accessibility behavior

Exit condition:

- A complete game can be played on phone and desktop.
- Refreshing restores the local game.
- Core play works using only a keyboard.

This milestone is a development prototype and does not satisfy answer-protection requirements.

### Milestone 2: Protected Backend

Deliver:

- Word and daily-assignment tables
- Game-session and attempt tables
- Database migrations
- Start-daily endpoint
- Start-unlimited endpoint
- Submit-guess endpoint
- Server-derived London date
- Opaque session tokens
- Idempotent guess submission
- RLS and protected data access
- Content validation and import script

Exit condition:

- The public frontend contains no answer bank.
- The current answer is absent from successful network responses until game completion.
- Attempt counts and completion are server-authoritative.
- Backend integration tests pass.

### Milestone 3: Daily Product Experience

Deliver:

- Exact streak rules
- Daily statistics
- Guess distribution
- Spoiler-free sharing
- Midnight-session behavior
- Missing-puzzle and service-error states
- Theme completion
- Reduced-motion support

Exit condition:

- Daily state survives refresh and browser restart.
- Results are not double-counted.
- GMT/BST transition tests pass.

### Milestone 4: Unlimited and Final Polish

Deliver:

- Curated unlimited selection
- Recent-puzzle exclusion
- Separate unlimited statistics
- Abandon-and-restart flow
- Complete responsive pass
- Accessibility pass
- Network-resilience pass
- Final copy and onboarding instructions

Exit condition:

- Unlimited mode never selects the current daily answer.
- Daily statistics are unaffected by unlimited play.
- All critical browser tests pass.

### Milestone 5: Public Launch

Deliver:

- Production database and secrets
- Production content import
- GitHub Actions build and deployment
- Smoke test after deployment
- Backup and rollback documentation
- Final security review
- Release checklist

Exit condition:

- The production site passes the Release 1 success criteria below.

---

## 17. Release 1 Success Criteria

Release 1 is successful when all of the following are true:

### Gameplay

- A player can open the site at a 320-pixel-wide viewport and complete a game without horizontal scrolling.
- Repeated letters are scored correctly.
- Invalid guesses do not consume attempts.
- Refreshing or reopening the browser restores an active game.
- Physical and on-screen keyboards both work.

### Daily Mode

- All players receive the puzzle assigned to the same London calendar date.
- The active date is determined by the server.
- A win, loss, missed day, and post-midnight completion follow the documented streak rules.
- A completed daily result is not counted twice.
- The player can copy a spoiler-free result.

### Unlimited Mode

- A player can start another puzzle after finishing or abandoning one.
- The current daily answer is never selected.
- Recent repeats are avoided when eligible alternatives exist.
- Unlimited results do not change the daily streak.

### Security

- The answer bank is not present in public JavaScript, public JSON, or direct anonymous table access.
- The current answer is not returned before the game ends.
- The browser cannot directly increase its accepted attempt count.
- Duplicate guess requests do not consume duplicate attempts.
- The service-role key is not present in the frontend or repository.

### Accessibility and Reliability

- Core gameplay is usable with a keyboard.
- Tile results have non-color accessible equivalents.
- Reduced-motion preferences are respected.
- Recoverable network errors do not corrupt game state.
- The production deployment can be rolled back using documented steps.

---

## 18. Post-Release Order

Future work should be considered only after Release 1 is stable.

The preferred order is:

1. Operational improvements and content tooling
2. Basic untimed two-player Versus
3. Timed Versus after ordinary multiplayer is reliable
4. A graphical admin panel if the script-based workflow has become insufficient
5. Additional games based on validated demand

No future feature should be added merely because the initial architecture attempted to anticipate it.

---

## 19. Deferred Product Decisions

The following decisions do not block Release 1:

- Whether hard mode should be added
- Whether sound effects should be added
- How future Versus scoring should work
- Whether timed multiplayer should exist
- Which game should follow Wordo
- Whether a graphical admin panel will ever be necessary

These decisions should be made when their corresponding feature enters active planning.
