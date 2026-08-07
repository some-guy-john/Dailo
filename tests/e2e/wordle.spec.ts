import { expect, test } from '@playwright/test'

test.describe('protected Wordo play', () => {
  test('loads the daily board without exposing the answer', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'Wordo' })).toBeVisible()
    await expect(page.locator('.board[data-ready="true"]')).toBeVisible()
    await expect(page.locator('.board-row')).toHaveCount(6)
    await expect(page.locator('.tile')).toHaveCount(30)
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('submits a valid guess and restores it after refresh', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.board[data-ready="true"]')).toBeVisible()
    await page.keyboard.type('AALII')
    await page.keyboard.press('Enter')

    const firstRow = page.locator('.board-row').first()
    await expect(page.locator('.board')).toHaveAttribute('aria-label', '1 of 6 guesses used')
    await expect(firstRow.locator('.tile')).toHaveText(['A', 'A', 'L', 'I', 'I'])
    await expect(firstRow.locator('.tile[data-state]')).toHaveCount(5)

    await page.reload()
    await expect(page.locator('.board-row').first().locator('.tile')).toHaveText(['A', 'A', 'L', 'I', 'I'])
  })

  test('shows a submitted guess while the server verifies it', async ({ page }) => {
    await page.route('**/functions/v1/wordle', async (route) => {
      const body = JSON.parse(route.request().postData() ?? '{}') as { action?: string }
      if (body.action === 'start') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            sessionToken: 'pending-guess-token',
            state: { mode: 'daily', puzzleId: 'pending-guess-puzzle', date: '2026-08-08', status: 'active', attemptCount: 0, attempts: [], answer: null },
          }),
        })
        return
      }

      await new Promise((resolve) => setTimeout(resolve, 250))
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          sessionToken: 'pending-guess-token',
          result: {
            status: 'active',
            attemptCount: 1,
            attempt: { guess: 'CRANE', result: ['absent', 'absent', 'absent', 'absent', 'absent'] },
            answer: null,
          },
        }),
      })
    })

    await page.goto('/')
    await expect(page.locator('.board[data-ready="true"]')).toBeVisible()
    await page.keyboard.type('CRANE')
    await page.keyboard.press('Enter')
    await expect(page.locator('.board-row').first().locator('.tile')).toHaveText(['C', 'R', 'A', 'N', 'E'])
    await expect(page.locator('.toast')).not.toContainText('Checking guess')
  })

  test('rejects a removed generated word without consuming a row', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.board[data-ready="true"]')).toBeVisible()
    await page.keyboard.type('ADBOT')
    await page.keyboard.press('Enter')

    await expect(page.getByText('That word is not in the list.')).toBeVisible()
    await expect(page.locator('.board').getAttribute('aria-label')).resolves.toBe('0 of 6 guesses used')
  })

  test('starts an unlimited protected session', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Unlimited' }).click()

    await expect(page.getByRole('button', { name: 'Unlimited' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.board[data-ready="true"]')).toBeVisible()
    await expect(page.locator('.board-row')).toHaveCount(6)

    await page.keyboard.type('AALII')
    await page.keyboard.press('Enter')
    await expect(page.locator('.board-row').first().locator('.tile')).toHaveText(['A', 'A', 'L', 'I', 'I'])
  })

  test('continues with another unlimited puzzle after finishing one', async ({ page }) => {
    let unlimitedStarts = 0
    await page.route('**/functions/v1/wordle', async (route) => {
      const body = JSON.parse(route.request().postData() ?? '{}') as { action?: string; mode?: string }

      if (body.action === 'start') {
        if (body.mode === 'daily') {
          await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
              sessionToken: 'daily-test-token',
              state: { mode: 'daily', puzzleId: 'daily-puzzle', date: '2026-08-07', status: 'active', attemptCount: 0, attempts: [], answer: null },
            }),
          })
          return
        }

        unlimitedStarts += 1
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            sessionToken: `unlimited-test-token-${unlimitedStarts}`,
            state: { mode: 'unlimited', puzzleId: `unlimited-puzzle-${unlimitedStarts}`, date: null, status: 'active', attemptCount: 0, attempts: [], answer: null },
          }),
        })
        return
      }

      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          sessionToken: 'unlimited-test-token-1',
          result: {
            status: 'won',
            attemptCount: 1,
            attempt: { guess: 'CRANE', result: ['correct', 'correct', 'correct', 'correct', 'correct'] },
            answer: 'CRANE',
          },
        }),
      })
    })

    await page.goto('/')
    await page.getByRole('button', { name: 'Unlimited' }).click()
    await expect(page.locator('.board[data-ready="true"]')).toBeVisible()

    await page.keyboard.type('CRANE')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Next puzzle' })).toBeVisible()

    await page.getByRole('button', { name: 'Next puzzle' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.locator('.board[data-ready="true"]')).toBeVisible()
    expect(unlimitedStarts).toBe(2)
  })

  test('opens the statistics dialog after solving', async ({ page }) => {
    await page.route('**/functions/v1/wordle', async (route) => {
      const body = JSON.parse(route.request().postData() ?? '{}') as { action?: string }
      if (body.action === 'start') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            sessionToken: 'statistics-test-token',
            state: { mode: 'daily', puzzleId: 'statistics-test-puzzle', date: '2026-08-08', status: 'active', attemptCount: 0, attempts: [], answer: null },
          }),
        })
        return
      }

      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          sessionToken: 'statistics-test-token',
          result: {
            status: 'won',
            attemptCount: 1,
            attempt: { guess: 'CRANE', result: ['correct', 'correct', 'correct', 'correct', 'correct'] },
            answer: 'CRANE',
          },
        }),
      })
    })

    await page.goto('/')
    await expect(page.locator('.board[data-ready="true"]')).toBeVisible()
    await page.keyboard.type('CRANE')
    await page.keyboard.press('Enter')

    const dialog = page.getByRole('dialog', { name: 'Statistics' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Solved in 1 guess.')).toBeVisible()
    await expect(dialog.getByRole('button', { name: /Share/ })).toBeEnabled()
  })

  test('explains the rules without adding page clutter', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'How to play' }).click()

    const dialog = page.getByRole('dialog', { name: 'How to play' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Guess the word in six tries.', { exact: false })).toBeVisible()
    await expect(dialog.getByText('midnight', { exact: false })).toBeVisible()
  })

  test('lists the games behind the header icon', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'All games' }).click()

    await expect(page.getByRole('heading', { name: 'Dailo' })).toBeVisible()
    await expect(page.getByText('Wordo Unlimited')).toBeVisible()
    await expect(page.getByText('Connections')).toBeVisible()
  })

  test('opens the protected archive browser and starts a past edition', async ({ page }) => {
    await page.route('**/functions/v1/wordle', async (route) => {
      const body = JSON.parse(route.request().postData() ?? '{}') as { action?: string; mode?: string }
      if (body.action === 'archive-list') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ archives: [{ date: '2026-08-06', puzzleId: 'archive-puzzle', status: null }] }),
        })
        return
      }

      if (body.action === 'archive-stats') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ archiveStats: { played: 4, wins: 3, distribution: [1, 1, 1, 0, 0, 0] } }),
        })
        return
      }

      if (body.action === 'start' && body.mode === 'archive') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            sessionToken: 'archive-test-token',
            state: { mode: 'archive', puzzleId: 'archive-puzzle', date: '2026-08-06', status: 'active', attemptCount: 0, attempts: [], answer: null },
          }),
        })
        return
      }

      await route.fallback()
    })

    await page.goto('/')
    await page.getByRole('button', { name: 'All games' }).click()
    await page.getByRole('button', { name: /Wordo Archive/ }).click()
    await expect(page.getByRole('heading', { name: 'Wordo Archive' })).toBeVisible()
    await page.getByRole('button', { name: /Thu 6 Aug/ }).click()
    await expect(page.getByRole('heading', { name: 'Wordo' })).toBeVisible()
    await expect(page.locator('.board[data-ready="true"]')).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Game mode' })).toBeVisible()
    await expect(page.getByText('Archived daily edition')).toHaveCount(0)
  })

  test('uses Dailo for the site and Wordo for the game', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Wordo' })).toBeVisible()
    await page.getByRole('button', { name: 'All games' }).click()
    await expect(page.getByRole('heading', { name: 'Dailo' })).toBeVisible()
  })

  test('switches the tiles to high contrast colours', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'High contrast colours' }).click()

    await expect(page.locator('.app')).toHaveAttribute('data-contrast', 'on')
  })

  test('darkens a keyboard letter after an absent result', async ({ page }) => {
    await page.route('**/functions/v1/wordle', async (route) => {
      const body = JSON.parse(route.request().postData() ?? '{}') as { action?: string }
      if (body.action === 'start') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            sessionToken: 'keyboard-state-token',
            state: { mode: 'daily', puzzleId: 'keyboard-state-puzzle', date: '2026-08-08', status: 'active', attemptCount: 0, attempts: [], answer: null },
          }),
        })
        return
      }

      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          sessionToken: 'keyboard-state-token',
          result: {
            status: 'active',
            attemptCount: 1,
            attempt: { guess: 'CRANE', result: ['absent', 'absent', 'absent', 'absent', 'absent'] },
            answer: null,
          },
        }),
      })
    })

    await page.goto('/')
    await expect(page.locator('.board[data-ready="true"]')).toBeVisible()
    const unusedColour = await page.getByRole('button', { name: 'Q' }).evaluate((element) => getComputedStyle(element).backgroundColor)
    await page.keyboard.type('CRANE')
    await page.keyboard.press('Enter')
    const absentKey = page.locator('.key[data-state="absent"]').first()
    await expect(absentKey).toBeVisible()
    await expect.poll(() => absentKey.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(unusedColour)
  })

  test('keeps timezone details in settings instead of the game board', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('navigation', { name: 'Game mode' })).toBeVisible()
    await expect(page.getByText('Daily edition')).toHaveCount(0)
    await expect(page.getByText('London daily edition')).toHaveCount(0)
    await expect(page.getByText('LON', { exact: true })).toHaveCount(0)

    await page.getByRole('button', { name: 'Settings' }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await expect(dialog.getByText('midnight, London time', { exact: false })).toBeVisible()
  })

  test('opens the account dialog with sign-in and account creation paths', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Account' }).click()

    const dialog = page.getByRole('dialog', { name: 'Account' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('Email')).toBeVisible()
    await expect(dialog.getByLabel('Password')).toBeVisible()
    await dialog.getByRole('button', { name: 'Create account' }).click()
    await expect(dialog.getByRole('button', { name: 'Create account', exact: true })).toBeVisible()
    await expect(dialog.getByText('We will email you a confirmation link')).toBeVisible()
    await dialog.getByRole('button', { name: 'Back to sign in' }).click()
    await dialog.getByRole('button', { name: 'Forgot password?' }).click()
    await expect(dialog.getByRole('button', { name: 'Send reset link' })).toBeVisible()
  })

  test('directs unconfirmed archive users to account access', async ({ page }) => {
    await page.route('**/functions/v1/wordle', async (route) => {
      const body = JSON.parse(route.request().postData() ?? '{}') as { action?: string }
      if (body.action === 'archive-list') {
        await route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'archive_email_unconfirmed', message: 'Confirm your email before using Archive.' } }),
        })
        return
      }
      await route.fallback()
    })

    await page.goto('/')
    await page.getByRole('button', { name: 'All games' }).click()
    await page.getByRole('button', { name: /Wordo Archive/ }).click()
    await expect(page.getByRole('alert')).toContainText('Confirm your email before using Archive.')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('dialog', { name: 'Account' })).toBeVisible()
  })

  test('fits the game on a narrow phone viewport', async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 320, height: 700 } })
    await page.goto('/')
    await expect(page.locator('.board[data-ready="true"]')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
    const board = await page.locator('.board').boundingBox()
    const keyboard = await page.locator('.keyboard').boundingBox()
    expect(board?.width ?? 0).toBeGreaterThan(240)
    expect((keyboard?.y ?? 0) + (keyboard?.height ?? 0)).toBeLessThanOrEqual(700)
    await page.close()
  })

  test('keeps the board and keyboard together on a short desktop viewport', async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await page.goto('/')
    await expect(page.locator('.board[data-ready="true"]')).toBeVisible()
    const board = await page.locator('.board').boundingBox()
    const keyboard = await page.locator('.keyboard').boundingBox()
    expect(board?.width ?? 0).toBeGreaterThan(280)
    expect((keyboard?.y ?? 0) + (keyboard?.height ?? 0)).toBeLessThanOrEqual(800)
    await page.close()
  })
})
