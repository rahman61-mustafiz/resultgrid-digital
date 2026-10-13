// Read-only independent review probes. No database or app mutations.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import ts from 'typescript'

const nativeRequire = createRequire(import.meta.url)
const cache = new Map()
const mockClient = {
  auth: { getUser: async () => ({ data: { user: null } }) },
  from(table) {
    const result = table === 'projects'
      ? { data: null, error: { message: 'independent injected project read failure' } }
      : table === 'workspaces'
        ? { data: { name: 'Review', default_timezone: 'Asia/Dhaka' }, error: null }
        : table === 'project_targets'
          ? { data: [{ project_id: 'missing-project', metric: 'LEADS', unit: 'leads', target: 10, actual: 5, baseline: null, period_start: '2026-01-01', period_end: '2026-12-31' }], error: null }
          : { data: [], count: 0, error: null }
    const query = new Proxy({}, { get: (_, key) => key === 'then' ? (resolve) => Promise.resolve(result).then(resolve) : () => query })
    return query
  },
}
function load(file) {
  file = path.resolve(file)
  if (cache.has(file)) return cache.get(file).exports
  const mod = { exports: {} }; cache.set(file, mod)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText
  const req = (name) => {
    if (name === '@/lib/supabase/server') return { createClient: async () => mockClient }
    if (name === '@/app/(app)/dashboard/actions') return { saveDashboardCardsAction() {} }
    if (name.startsWith('@/components/') || name === 'next/link') return new Proxy({ __esModule: true }, { get: (_, key) => key === '__esModule' ? true : key })
    if (!name.startsWith('@/') && !name.startsWith('.')) return nativeRequire(name)
    const base = name.startsWith('@/') ? path.resolve('src', name.slice(2)) : path.resolve(path.dirname(file), name)
    return load(['.ts', '.tsx', '/index.ts'].map(ext => base + ext).find(fs.existsSync) ?? base)
  }
  new Function('require', 'module', 'exports', code)(req, mod, mod.exports)
  return mod.exports
}
const { fetchAll } = load('src/lib/supabase/fetch-all.ts')
let calls = 0
const capped = await fetchAll(async (from) => { calls++; return { data: Array.from({ length: Math.min(500, 1500 - from) }, (_, i) => from + i), error: null } })
console.log(JSON.stringify({ scenario: '1500 rows, server cap 500 (simulated)', ok: capped.ok, returned: capped.rows.length, calls }))
const exact = await fetchAll(async (from, to) => ({ data: Array.from({ length: Math.max(0, Math.min(to + 1, 50000) - from) }, (_, i) => from + i), error: null }))
console.log(JSON.stringify({ scenario: 'exactly 50000 rows', ok: exact.ok, message: exact.message }))
const tree = await load('src/app/(app)/dashboard/page.tsx').default({ searchParams: Promise.resolve({}) })
const found = new Set()
function walk(node) {
  if (Array.isArray(node)) return node.forEach(walk)
  if (!node || typeof node !== 'object') return
  if (node.props?.['data-testid']) found.add(node.props['data-testid'])
  walk(node.props?.children)
}
walk(tree)
console.log(JSON.stringify({ scenario: 'project query fails, target query succeeds (injected server component)', moneyUnavailable: found.has('money-unavailable'), targetRowStillShown: found.has('target-row'), targetsUnavailable: found.has('targets-unavailable'), attentionCardShown: found.has('card-attention') }))
