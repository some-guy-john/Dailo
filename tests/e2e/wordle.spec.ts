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
})
