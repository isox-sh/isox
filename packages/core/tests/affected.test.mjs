import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { test } from 'vitest'

const require = createRequire(import.meta.url)
const { createProjectGraph, getAffectedProjects, getGitChanges, createProjectMatrix, matchesTags, parseWorkspace } = require('../../../dist/core')

function workspace(definitions) {
  return { projects: Object.fromEntries(Object.entries(definitions).map(([name, extra]) => [name, {
    name, root: `packages/${name}`, executors: { build: { executor: 'core:run-command' } }, ...extra,
  }])) }
}

async function repository(t) {
  const root = await mkdtemp(join(tmpdir(), 'isox-git-'))
  t.onTestFinished(() => rm(root, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init', '--initial-branch=main')
  const write = async (file, content = 'initial') => {
    await mkdir(dirname(join(root, file)), { recursive: true })
    await writeFile(join(root, file), typeof content === 'string' ? content : JSON.stringify(content))
  }
  const commit = () => {
    git('add', '.')
    git('-c', 'commit.gpgsign=false', '-c', 'user.name=Isox test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture')
    return git('rev-parse', 'HEAD')
  }
  return { root, git, write, commit }
}

test('affected walks a diamond in reverse, filters no edges, and isolates unrelated projects', () => {
  const graph = workspace({ shared: {}, a: { dependencies: ['shared'] }, b: { dependencies: ['shared'] }, app: { dependencies: ['b', 'a'] }, isolated: {} })
  assert.deepEqual(getAffectedProjects(graph, ['packages/shared/src/index.ts']), ['a', 'app', 'b', 'shared'])
  assert.deepEqual(getAffectedProjects(graph, []), [])
  assert.deepEqual(createProjectGraph(graph).dependencies.app, ['a', 'b'])
  assert.deepEqual(createProjectGraph(graph).dependents.shared, ['a', 'b'])
})

test('graph reports unknown dependencies and the full cycle, including self cycles', () => {
  assert.throws(() => createProjectGraph(workspace({ app: { dependencies: ['missing'] } })), /app depends on unknown project missing/)
  assert.throws(() => createProjectGraph(workspace({ a: { dependencies: ['b'] }, b: { dependencies: ['c'] }, c: { dependencies: ['a'] } })), /a -> b -> c -> a/)
  assert.throws(() => createProjectGraph(workspace({ a: { dependencies: ['a'] } })), /a -> a/)
})

test('ownership uses path boundaries and the deepest root, including a root project', () => {
  const graph = workspace({ root: { root: '.' }, parent: { root: 'libs/ui' }, nested: { root: 'libs/ui/nested' }, other: { root: 'libs/ui-extra' } })
  assert.deepEqual(getAffectedProjects(graph, ['libs/ui/nested/a.ts']), ['nested'])
  assert.deepEqual(getAffectedProjects(graph, ['libs/ui-extra/a.ts']), ['other'])
  assert.deepEqual(getAffectedProjects(graph, ['readme.md']), ['root'])
  assert.deepEqual(getAffectedProjects(graph, ['pnpm-lock.yaml']), ['nested', 'other', 'parent', 'root'])
  assert.deepEqual(getAffectedProjects(graph, ['tsconfig.base.json']), ['nested', 'other', 'parent', 'root'])
  assert.deepEqual(getAffectedProjects(workspace({ app: {}, lib: {} }), ['removed-project/source.ts']), ['app', 'lib'])
  assert.deepEqual(getAffectedProjects(graph, ['libs/ui/a.ts'], { globalFiles: ['libs/ui/**'] }), ['nested', 'other', 'parent', 'root'])
  assert.deepEqual(getAffectedProjects(workspace({ a: { root: '.' }, b: { root: 'b' } }), ['b/file.ts']), ['b'])
})

test('tags combine OR/AND, handle untagged exclusions, and exclude every forbidden value', () => {
  assert.equal(matchesTags(['resource=gcp-cloud-run'], 'resource!=vercel,resource!=gcp-function'), true)
  assert.equal(matchesTags([], 'resource!=vercel'), true)
  assert.equal(matchesTags(['resource=vercel', 'resource=gcp-cloud-run'], 'resource!=vercel'), false)
  assert.equal(matchesTags(['web', 'env=prod'], 'api\nweb,env = prod'), true)
  assert.equal(matchesTags(['web'], 'web,env=prod'), false)
  for (const value of ['web,', '=value', 'key=', 'key!=']) {
    assert.throws(() => matchesTags([], value), /Tag filters|Invalid tag/)
  }
})

test('weighted planning places heavy projects first and produces reproducible exact shards', () => {
  const graph = workspace({ a: { plan: { weight: 8 } }, b: { plan: { weight: 7 } }, c: { plan: { weight: 3 } }, d: { plan: { weight: 2 } }, e: {}, f: {} })
  const names = Object.keys(graph.projects)
  const plan = createProjectMatrix(graph, names, [{ target: 'build', maxJobs: 2, parallel: 2 }])
  assert.deepEqual(plan.include.map(row => ({ projects: row.projects, weight: row.weight })), [
    { projects: ['a', 'd', 'e'], weight: 11 },
    { projects: ['b', 'c', 'f'], weight: 11 },
  ])
  assert.deepEqual(createProjectMatrix(graph, names.reverse(), [{ target: 'build', maxJobs: 2, parallel: 2 }]), plan)
  assert.deepEqual(plan.include.map(row => [row.index, row.count, row.parallel]), [[1, 2, 2], [2, 2, 2]])
})

test('default weights balance by count, with no empty shards or duplicate projects', () => {
  const graph = workspace(Object.fromEntries(['a', 'b', 'c', 'd', 'e'].map(name => [name, {}])))
  const plan = createProjectMatrix(graph, Object.keys(graph.projects), [{ target: 'build', maxJobs: 3 }])
  assert.deepEqual(plan.include.map(row => row.weight), [2, 2, 1])
  assert.deepEqual(plan.include.flatMap(row => row.projects).sort(), ['a', 'b', 'c', 'd', 'e'])
  assert.equal(createProjectMatrix(graph, ['a'], [{ target: 'build', maxJobs: 5 }]).include.length, 1)
  assert.deepEqual(createProjectMatrix(graph, [], [{ target: 'build' }]), { include: [] })
})

test('plans apply ci=off and command filters only after dependent propagation', () => {
  const graph = workspace({ lib: { tags: ['ci=off'] }, app: { dependencies: ['lib'], tags: ['resource=web'] }, other: { executors: {} } })
  const selected = getAffectedProjects(graph, ['packages/lib/a.ts'])
  const plan = createProjectMatrix(graph, selected, [{ target: 'build', tag: 'resource=web' }])
  assert.deepEqual(plan.include[0].projects, ['app'])
})

test('plans validate numbers, matrix limits, configurations and pre/post stages', () => {
  const graph = workspace({ app: {} })
  for (const maxJobs of [0, -1, 1.5, 257, NaN]) {
    assert.throws(() => createProjectMatrix(graph, ['app'], [{ target: 'build', maxJobs }]), /maxJobs must/)
  }
  assert.throws(() => createProjectMatrix(graph, ['app'], [{ target: 'build', config: 'missing' }]), /Configuration missing not found/)
  assert.throws(() => createProjectMatrix(graph, [], [{ target: 'build', preTargets: ['bad:config:extra'] }]), /Invalid target/)
  assert.throws(() => createProjectMatrix(graph, [], [{ target: 'build', preTargets: ['prepare:acc,prod'] }]), /Invalid target/)
  assert.throws(() => createProjectMatrix(graph, ['app'], Array.from({ length: 257 }, () => ({ target: 'build' }))), /limit of 256/)
  for (const weight of [0, -1, Infinity, NaN]) {
    graph.projects.app.plan = { weight }
    assert.throws(() => createProjectMatrix(graph, ['app'], [{ target: 'build' }]), /plan.weight/)
  }
})

test('plans preserve schema-valid comma-containing stage names and their configurations', () => {
  const graph = workspace({ app: { executors: {
    build: { executor: 'core:run-command' },
    'prepare,assets': { executor: 'core:run-command', configurations: { acc: {} } },
    '--finish,assets': { executor: 'core:run-command' },
  } } })
  const options = { target: 'build', preTargets: ['prepare,assets:acc'], postTargets: ['--finish,assets'] }
  const [row] = createProjectMatrix(graph, ['app'], [options]).include
  assert.deepEqual(row.preTargets, options.preTargets)
  assert.deepEqual(row.postTargets, options.postTargets)
})

test('project schema accepts positive fractional weights, defaults to 1, and rejects invalid weights', async t => {
  const { root, write } = await repository(t)
  for (const weight of [0, -1, '3', null]) {
    await write('project.json', { name: 'test', plan: { weight } })
    await assert.rejects(parseWorkspace(root, { cache: false }), /Invalid project configuration/)
  }
  await write('project.json', { name: 'test', plan: { weight: 2.5, custom: true } })
  assert.equal((await parseWorkspace(root, { cache: false })).projects.test.plan.weight, 2.5)
})

test('Git compares merge-base to head, preserves unusual paths, and includes both rename sides and deletions', async t => {
  const { root, git, write, commit } = await repository(t)
  await write('packages/old/file.txt')
  await write('packages/deleted/gone.txt')
  const base = commit()
  git('checkout', '-b', 'feature')
  await mkdir(join(root, 'packages/new'), { recursive: true })
  await rename(join(root, 'packages/old/file.txt'), join(root, 'packages/new/file.txt'))
  await rm(join(root, 'packages/deleted/gone.txt'))
  await write('packages/new/space and\nnewline.txt')
  const head = commit()
  git('checkout', 'main')
  await write('unrelated-main.txt')
  commit()
  git('checkout', 'feature')
  const changes = await getGitChanges(root, { base: 'main', head: 'feature' })
  assert.equal(changes.mergeBase, base)
  assert.equal(changes.head, head)
  assert.deepEqual(changes.files, ['packages/deleted/gone.txt', 'packages/new/file.txt', 'packages/new/space and\nnewline.txt', 'packages/old/file.txt'])
})

test('Git local changes are opt-in and ignored files are excluded', async t => {
  const { root, git, write, commit } = await repository(t)
  await write('.gitignore', 'ignored\n')
  await write('staged.txt')
  await write('unstaged.txt')
  const base = commit()
  await write('staged.txt', 'changed')
  git('add', 'staged.txt')
  await write('unstaged.txt', 'changed')
  await write('untracked.txt')
  await write('ignored')
  assert.deepEqual((await getGitChanges(root, { base })).files, [])
  assert.deepEqual((await getGitChanges(root, { base, uncommitted: true })).files, ['staged.txt', 'unstaged.txt'])
  assert.deepEqual((await getGitChanges(root, { base, untracked: true })).files, ['untracked.txt'])
})

test('Git supports a workspace inside a repository and reports missing refs without interpreting shell syntax', async t => {
  const { root, write, commit } = await repository(t)
  await write('nested/isox.json', '{}')
  await write('elsewhere.txt')
  const base = commit()
  await write('nested/packages/app/file.ts')
  await write('elsewhere.txt', 'changed')
  commit()
  assert.deepEqual((await getGitChanges(join(root, 'nested'), { base })).files, ['packages/app/file.ts'])
  await write('nested/packages/app/untracked.ts')
  await write('outside-untracked.ts')
  assert.deepEqual((await getGitChanges(join(root, 'nested'), { base, untracked: true })).files, ['packages/app/file.ts', 'packages/app/untracked.ts'])
  await assert.rejects(getGitChanges(root, { base: 'missing; echo malicious' }), /Check the base\/head refs.*fetch-depth: 0/)
  await assert.rejects(getGitChanges(root, { base: '--help' }), /Git rev-parse failed/)
})

test('shallow history failures explain how to fetch the missing base', async t => {
  const { root, write, commit } = await repository(t)
  await write('first.txt')
  const base = commit()
  await write('second.txt')
  commit()
  const clone = await mkdtemp(join(tmpdir(), 'isox-shallow-'))
  t.onTestFinished(() => rm(clone, { recursive: true, force: true }))
  execFileSync('git', ['clone', '--depth=1', `file://${root}`, clone], { stdio: 'pipe' })
  await assert.rejects(getGitChanges(clone, { base }), /fetch full history.*fetch-depth: 0/)
})
