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
    await expect(page.getByRole('dialog', { name: 'Statistics' })).toBeVisible()

    await page.getByRole('button', { name: 'Next puzzle' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.locator('.board[data-ready="true"]')).toBeVisible()
    expect(unlimitedStarts).toBe(2)
  })

  test('opens the statistics dialog after solving', async ({ page }) => {
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
    await expect(dialog.getByText('midnight, London time', { exact: false })).toBeVisible()
  })

  test('lists the games behind the header icon', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'All games' }).click()

    await expect(page.getByRole('heading', { name: 'Dailo' })).toBeVisible()
    await expect(page.getByText('Wordo Unlimited')).toBeVisible()
    await expect(page.getByText('Connections')).toBeVisible()
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

  test('fits the game on a narrow phone viewport', async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 320, height: 700 } })
    await page.goto('/')
    await expect(page.locator('.board[data-ready="true"]')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
    await page.close()
  })
})
