import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  plugin: 'chick-status',
  component: 'AbovePrompt',
  surface: 'terminal',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

type On = Parameters<Parameters<typeof test>[1]>[1]
type Run = { exitCode: number; stdout: string }

// 假仓库：分支名、gh 返回、本地是否已合并进 origin/dev 都可在测试中改
type Repo = { branch: string | null; gh: string; mergedIntoDev: boolean }

function engine(on: On, repo: Repo) {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('command.register', () => ({ value: { command: 'chick' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('process.run', (_, e) => {
    const a = e.argv.join(' ')
    const ok = (stdout: string): Run => ({ exitCode: 0, stdout })
    const fail: Run = { exitCode: 1, stdout: '' }
    let r: Run = fail
    if (a.includes('symbolic-ref')) r = repo.branch ? ok(`${repo.branch}\n`) : fail
    else if (a.includes('rev-parse --verify')) r = ok('t1\n')
    else if (a.includes('for-each-ref')) r = ok('dev\norigin/dev\nfeature/x\n')
    else if (a.includes('merge-base --is-ancestor')) r = repo.mergedIntoDev ? ok('') : fail
    else if (a.includes('rev-list')) r = ok('m1\n')
    else if (a.includes('rev-parse m1^1')) r = ok('p0\n')
    else if (a.startsWith('gh pr list')) r = ok(repo.gh)
    return {
      value: { ...r, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    }
  })
  return clock
}

async function text(ui: { find: (q: never) => Promise<{ text?: string } | undefined> }) {
  return (await ui.find({ type: 'Text' } as never))?.text ?? ''
}

test('空闲、不在 git 仓库：睡觉迷你版', async ($, on) => {
  const clock = engine(on, { branch: null, gh: '[]', mergedIntoDev: false })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.advance(20)

  const ui = await $.ui.mount(BAND)
  expect(await text(ui)).toContain('zzZ')
  expect(await ui.find({ type: 'Raster', key: 'chick-mini' })).toBeDefined()
  await ui.unmount()
})

test('轮询 gh：显示当前分支 PR，状态变化时演动画', async ($, on) => {
  const repo: Repo = {
    branch: 'feature/x', gh: '[{"state":"OPEN","number":12}]', mergedIntoDev: false,
  }
  const clock = engine(on, repo)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.advance(20)

  let ui = await $.ui.mount(BAND)
  expect(await text(ui)).toContain('#12 open')
  expect(await ui.find({ type: 'Raster', key: 'chick-mini' })).toBeDefined()
  await ui.unmount()

  // 网页上被合并：缓存 120 秒过期后、下一次 15 秒轮询看到变化
  repo.gh = '[{"state":"MERGED","number":12}]'
  await clock.advance(136_000) // 第 135 秒那次轮询发现变化，动画持续 3 秒
  ui = await $.ui.mount(BAND)
  expect(await text(ui)).toContain('#12 merged')
  expect(await ui.find({ type: 'Raster', key: 'chick-merged' })).toBeDefined()
  await ui.unmount()
})

test('本地已并入 dev：显示"已并入 dev"', async ($, on) => {
  const clock = engine(on, { branch: 'feature/x', gh: '[]', mergedIntoDev: true })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.advance(20)

  const ui = await $.ui.mount(BAND)
  expect(await text(ui)).toContain('已并入 dev')
  await ui.unmount()
})

test('gh pr merge 命令：立即演动画并强制刷新', async ($, on) => {
  const repo: Repo = {
    branch: 'feature/x', gh: '[{"state":"OPEN","number":12}]', mergedIntoDev: false,
  }
  const clock = engine(on, repo)
  on('tool.call', () => ({ result: {}, text: '✓ Merged pull request #12\n' }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.advance(20)

  repo.gh = '[{"state":"MERGED","number":12}]'
  await $.tool.call({ tool: 'Bash', command: 'gh pr merge 12 --squash' })
  let ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Raster', key: 'chick-merged' })).toBeDefined()
  await ui.unmount()

  // 不等 120 秒缓存：命令后 1.5 秒就强制刷新
  await clock.advance(2000)
  ui = await $.ui.mount(BAND)
  expect(await text(ui)).toContain('#12 merged')
  await ui.unmount()
})

test('处理中 → 完成 → /clear 清零会话状态', async ($, on) => {
  const clock = engine(on, { branch: null, gh: '[]', mergedIntoDev: false })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  await $.turn.start({ text: 'hi', turnId: 't1' })
  let ui = await $.ui.mount(BAND)
  expect(await text(ui)).toContain('处理中')
  await ui.unmount()

  await $.turn.complete({
    answer: 'ok', durationMs: 42000, isAborted: false, turnId: 't1', reason: 'answer',
  })
  ui = await $.ui.mount(BAND)
  expect(await text(ui)).toContain('完成 42s')
  expect(await ui.find({ type: 'Raster', key: 'chick-done' })).toBeDefined()
  await ui.unmount()

  await $.session.end({ reason: 'clear', sessionId: 's1', resume: {} as never })
  await clock.settle()
  ui = await $.ui.mount(BAND)
  expect(await text(ui)).not.toContain('上次')
  expect(await ui.find({ type: 'Raster', key: 'chick-mini' })).toBeDefined()
  await ui.unmount()
})

test('终端太窄只显示文字', async ($, on) => {
  engine(on, { branch: null, gh: '[]', mergedIntoDev: false })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 30 } })
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  expect(await text(ui)).toContain('zzZ')
  await ui.unmount()
})
