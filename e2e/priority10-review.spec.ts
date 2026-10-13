import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { admin, cleanupQa, createQaOwner, freshTotp, purgeQaLeads, QA_CLIENT_PREFIX } from './helpers/qa'

test('independent review: follow-up filtering reads beyond 1000 and reports 500 of 1501', async ({ page }) => {
  const run = `p10-review-${Date.now().toString(36)}`
  const prefix = `${QA_CLIENT_PREFIX}${run}`
  const ids = Array.from({ length: 1501 }, () => randomUUID())
  const owner = await createQaOwner(run)
  try {
    await page.goto('/login')
    await page.getByLabel('Email').fill(owner.email)
    await page.getByLabel('Password').fill(owner.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/setup\/totp$/)
    const secret = (await page.locator('p.font-mono').textContent())!.trim()
    await page.getByLabel('Authenticator code').fill(await freshTotp(secret))
    await page.getByRole('button', { name: 'Confirm and continue' }).click()
    await expect(page).toHaveURL(/\/dashboard$/)
    const { data: workspace, error } = await admin.from('workspaces').select('id').limit(1).single()
    expect(error).toBeNull()
    // Direct admin fixture setup; the browser reads through the actual Owner session.
    for (let start = 0; start < ids.length; start += 500) {
      const { error: seedError } = await admin.from('leads').insert(ids.slice(start, start + 500).map((id, i) => ({
        id, workspace_id: workspace!.id, name: `${prefix} ${String(start + i).padStart(4, '0')}`,
        created_at: new Date(Date.now() - 4 * 86400000).toISOString(), created_by: owner.userId,
      })))
      expect(seedError).toBeNull()
    }
    await page.goto(`/leads?followup=due&q=${encodeURIComponent(prefix)}&sort=name`)
    await expect(page.getByTestId('result-count')).toContainText('Showing the first 500 of 1501 results')
    await expect(page.getByTestId('lead-list').locator('a')).toHaveCount(500)
    await page.goto(`/leads?followup=due&q=${encodeURIComponent(prefix + ' 1500')}`)
    await expect(page.getByTestId('result-count')).toHaveText('1 result')
    await expect(page.getByTestId('lead-list')).toContainText(`${prefix} 1500`)
  } finally {
    let remaining = 0
    try {
      // Keep the helper's verification URL below the request-size limit.
      for (let start = 0; start < ids.length; start += 200) remaining += await purgeQaLeads(ids.slice(start, start + 200))
      expect(remaining).toBe(0)
    } finally {
      const report = await cleanupQa(owner, [])
      console.log('Independent Priority 10 cleanup:', JSON.stringify({ remaining, ...report }))
      expect(report.workspaceMembershipsRemaining).toBe(0)
      expect(report.mfaFactorsRemaining).toBe(0)
      expect(report.authUser).not.toBe('NOT_DELETED')
    }
  }
})
