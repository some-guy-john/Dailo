import { expect, test, type Page } from '@playwright/test'

async function mockWordle(page: Page) {
  await page.route('**/functions/v1/wordle', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as { action?: string }
    if (body.action === 'start') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          sessionToken: 'accessibility-test-token',
          state: { mode: 'daily', puzzleId: 'accessibility-puzzle', date: '2026-08-08', status: 'active', attemptCount: 0, attempts: [], answer: null },
        }),
      })
      return
    }

    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        sessionToken: 'accessibility-test-token',
        result: {
          status: 'active',
          attemptCount: 1,
          attempt: { guess: 'CRANE', result: ['absent', 'present', 'correct', 'absent', 'absent'] },
          answer: null,
        },
      }),
    })
  })
}

test.describe('accessibility regression coverage', () => {
  test('keeps modal focus contained and restores the opener', async ({ page }) => {
    await page.goto('/')
    const opener = page.getByRole('button', { name: 'Settings' })
    await opener.click()

    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await expect(dialog).toHaveAttribute('aria-modal', 'true')
    await expect(dialog).toBeFocused()

    await page.keyboard.press('Shift+Tab')
    await expect(dialog.getByRole('button', { name: 'Reduce motion' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(dialog.getByRole('button', { name: 'Close settings' })).toBeFocused()
    await page.keyboard.press('Escape')

    await expect(dialog).toHaveCount(0)
    await expect(opener).toBeFocused()
  })

  test('exposes keyboard and tile states through accessible labels and announcements', async ({ page }) => {
    await mockWordle(page)
    await page.goto('/')
    await expect(page.locator('.board[data-ready="true"]')).toBeVisible()

    await expect(page.getByRole('group', { name: 'On-screen keyboard' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Backspace' })).toBeVisible()
    await page.keyboard.type('CRANE')
    await page.keyboard.press('Enter')

    await expect(page.locator('.board-row').first().locator('.tile').nth(0)).toHaveAttribute('aria-label', 'C, absent')
    await expect(page.locator('.board-row').first().locator('.tile').nth(1)).toHaveAttribute('aria-label', 'R, present')
    await expect(page.locator('.board-row').first().locator('.tile').nth(2)).toHaveAttribute('aria-label', 'A, correct')
    await expect(page.locator('.visually-hidden[aria-live="polite"]')).toContainText('Guess 1:')
  })

  test('announces modal errors without relying on visual styling', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Account' }).click()
    const dialog = page.getByRole('dialog', { name: 'Account' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('Email')).toHaveAttribute('type', 'email')
    await expect(dialog.getByLabel('Password')).toHaveAttribute('type', 'password')
    await expect(dialog.getByRole('button', { name: 'Sign in' })).toBeEnabled()
  })
})
