import { expect, test } from '@playwright/test'

test.describe('protected Wordle play', () => {
  test('loads the daily board without exposing the answer', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'Wordle' })).toBeVisible()
    await expect(page.locator('.board[data-ready="true"]')).toBeVisible()
    await expect(page.locator('.board-row')).toHaveCount(6)
    await expect(page.locator('.tile')).toHaveCount(30)
    await expect(page.locator('.result-tray')).toHaveCount(0)
  })

  test('submits a valid guess and restores it after refresh', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.board[data-ready="true"]')).toBeVisible()
    await page.keyboard.type('AALII')
    await page.keyboard.press('Enter')

    const firstRow = page.locator('.board-row').first()
    await expect(firstRow.locator('.tile')).toHaveText(['A', 'A', 'L', 'I', 'I'])
    await expect(firstRow.locator('[class*="tile-"]')).toHaveCount(5)

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
    await page.getByRole('button', { name: /Unlimited/ }).click()

    await expect(page.getByText('Practice · no timer')).toBeVisible()
    await expect(page.locator('.board[data-ready="true"]')).toBeVisible()
    await expect(page.locator('.board-row')).toHaveCount(6)

    await page.keyboard.type('AALII')
    await page.keyboard.press('Enter')
    await expect(page.locator('.board-row').first().locator('.tile')).toHaveText(['A', 'A', 'L', 'I', 'I'])
  })

  test('shows a result dialog after solving', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.board[data-ready="true"]')).toBeVisible()
    await page.keyboard.type('CRANE')
    await page.keyboard.press('Enter')

    const dialog = page.getByRole('dialog', { name: 'Solved.' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Share result' })).toBeVisible()
  })

  test('explains the rules without adding page clutter', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'How to play' }).click()

    await expect(page.getByRole('dialog', { name: 'Find the word in six.' })).toBeVisible()
    await expect(page.getByText('Stats stay in this browser. No account is required.')).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Find the word in six.' }).locator('.help-note strong')).toHaveText(/^\d{2}h \d{2}m$/)
  })

  test('fits the game on a narrow phone viewport', async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 320, height: 700 } })
    await page.goto('/')
    await expect(page.locator('.board[data-ready="true"]')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
    await page.close()
  })
})
