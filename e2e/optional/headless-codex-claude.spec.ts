import { expect, test, type Locator, type Page } from '@playwright/test'

const PROJECT_NAME = 'mock-project-1'
const BASE_SESSION_NAME = 'Base Session'
const CODEX_WORKTREE_NAME = 'codex-worktree-1'
const CLAUDE_WORKTREE_NAME = 'claude-worktree-1'

test.describe.configure({ mode: 'serial' })

async function createProject(page: Page): Promise<void> {
  await page.goto('/')

  await page.getByRole('button', { name: 'Add Your First Project' }).click()
  await expect(page.getByRole('heading', { name: 'New Project' })).toBeVisible()
  await page.getByRole('button', { name: /Initialize New Project/i }).click()

  await expect(page.getByText(PROJECT_NAME, { exact: true })).toBeVisible()
  await expect(page.getByText(BASE_SESSION_NAME, { exact: true })).toBeVisible()
  await expect(
    page.getByText('No messages yet. Start a conversation!')
  ).toBeVisible()
}

async function openNewSessionModal(page: Page): Promise<Locator> {
  await page.locator('button[title="New worktree"]').first().click()
  const dialog = page.getByRole('dialog').filter({
    hasText: `New Session for ${PROJECT_NAME}`,
  })
  await expect(dialog).toBeVisible()
  return dialog
}

async function createQuickWorktree(
  page: Page,
  agentLabel: 'Claude CLI' | 'Codex CLI',
  expectedWorktreeName: string
): Promise<void> {
  const dialog = await openNewSessionModal(page)

  await dialog.getByRole('combobox').click()
  await page.getByRole('option', { name: agentLabel }).click()

  await dialog.getByRole('button', { name: /Quick Actions/i }).click()
  await dialog.getByRole('button', { name: /^New Worktree$/ }).click()
  await expect(dialog).toBeHidden()

  await expect(
    page.getByText(expectedWorktreeName, { exact: true }).first()
  ).toBeVisible()
}

async function selectWorktree(page: Page, worktreeName: string): Promise<void> {
  await page.getByText(worktreeName, { exact: true }).first().click()
  await expect(page.locator('textarea').first()).toBeVisible()
}

async function sendMessage(
  page: Page,
  prompt: string,
  expectedResponse: string
): Promise<void> {
  const input = page.locator('textarea').first()
  await input.fill(prompt)
  await input.press('Enter')
  await expect(page.getByText(expectedResponse)).toBeVisible()
}

async function archiveWorktree(
  page: Page,
  worktreeName: string
): Promise<void> {
  await page
    .getByText(worktreeName, { exact: true })
    .first()
    .click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Archive Worktree' }).click()
  await expect(page.getByText(worktreeName, { exact: true })).toHaveCount(0)
}

async function restoreWorktree(
  page: Page,
  worktreeName: string
): Promise<void> {
  await page.getByRole('button', { name: 'Archived' }).click()

  const dialog = page.getByRole('dialog').filter({ hasText: 'Archived Items' })
  await expect(dialog).toBeVisible()

  const card = dialog.locator('div').filter({ hasText: worktreeName }).first()
  await card.hover()
  await card.locator('button[title="Restore worktree"]').click()

  await expect(dialog).toBeHidden()
  await expect(
    page.getByText(worktreeName, { exact: true }).first()
  ).toBeVisible()
}

test('optional headless lifecycle across base, codex and claude', async ({
  page,
}) => {
  await createProject(page)

  await selectWorktree(page, BASE_SESSION_NAME)
  await sendMessage(
    page,
    'base-simple-check',
    '[mock:claude] processed: base-simple-check'
  )

  await createQuickWorktree(page, 'Codex CLI', CODEX_WORKTREE_NAME)
  await selectWorktree(page, CODEX_WORKTREE_NAME)
  await sendMessage(
    page,
    'codex-simple-check',
    '[mock:codex] processed: codex-simple-check'
  )

  await createQuickWorktree(page, 'Claude CLI', CLAUDE_WORKTREE_NAME)
  await selectWorktree(page, CLAUDE_WORKTREE_NAME)
  await sendMessage(
    page,
    'claude-simple-check',
    '[mock:claude] processed: claude-simple-check'
  )

  await archiveWorktree(page, CODEX_WORKTREE_NAME)
  await restoreWorktree(page, CODEX_WORKTREE_NAME)
})

test('optional ask-user-question flow supports selectable answers', async ({
  page,
}) => {
  await createProject(page)
  await createQuickWorktree(page, 'Codex CLI', CODEX_WORKTREE_NAME)
  await selectWorktree(page, CODEX_WORKTREE_NAME)

  const input = page.locator('textarea').first()
  await input.fill('ask me one question with options')
  await input.press('Enter')

  await expect(
    page.getByText('Which flow should I validate next?')
  ).toBeVisible()
  await page.getByText('Archive and restore', { exact: true }).click()
  await page.getByRole('button', { name: /^Answer/ }).click()

  await expect(
    page.getByText('[mock:codex] Answer received and processing continued.')
  ).toBeVisible()
})
