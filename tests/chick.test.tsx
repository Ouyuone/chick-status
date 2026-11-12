import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

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

type On = Parameters<TestBody>[1]
type Run = { exitCode: number; stdout: string }

// 假仓库：分支名、gh 返回、候选分支列表、本地是否已合并进候选分支都可在测试中改
// store 是跨会话存储的初始内容，默认固定成小鸡
type Repo = {
  branch: string | null; gh: string; mergedIntoDev: boolean; refs?: string
  store?: Record<string, unknown>
}

function engine(on: On, repo: Repo) {
  const clock = mock.clock(on, { now: 1_000_000 })
  // 跨会话存储放在 repo.store 里，测试直接检查写进去的值
  const store = (repo.store ??= { pet: 'chick' })
  on('store.get', (_, e) => ({ value: store[e.key] }))
  on('store.set', (_, e) => {
    store[e.key] = e.value
    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    delete store[e.key]
    return { value: undefined }
  })
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
    else if (a.includes('for-each-ref')) r = ok(repo.refs ?? 'dev\norigin/dev\nfeature/x\n')
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

test('只认 dev 本身和 release*：并入 devops 不算', async ($, on) => {
  const clock = engine(on, {
    branch: 'feature/x', gh: '[]', mergedIntoDev: true,
    refs: 'devops\norigin/devops\norigin/development\nfeature/x\n',
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.advance(20)

  const ui = await $.ui.mount(BAND)
  expect(await text(ui)).not.toContain('已并入')
  await ui.unmount()
})

test('release 开头的分支照常算', async ($, on) => {
  const clock = engine(on, {
    branch: 'feature/x', gh: '[]', mergedIntoDev: true,
    refs: 'origin/devops\norigin/release/1.2\nfeature/x\n',
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.advance(20)

  const ui = await $.ui.mount(BAND)
  expect(await text(ui)).toContain('已并入 release/1.2')
  await ui.unmount()
})

test('devops 分支上照常显示 PR 状态', async ($, on) => {
  const clock = engine(on, {
    branch: 'devops', gh: '[{"state":"OPEN","number":7}]', mergedIntoDev: false,
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.advance(20)

  const ui = await $.ui.mount(BAND)
  expect(await text(ui)).toContain('#7 open')
  await ui.unmount()
})

test('main、master、dev 本身和 release* 分支上不显示 PR 状态', async ($, on) => {
  const repo: Repo = { branch: 'dev', gh: '[{"state":"OPEN","number":7}]', mergedIntoDev: false }
  const clock = engine(on, repo)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  for (const branch of ['dev', 'main', 'master', 'release/1.2']) {
    repo.branch = branch
    await clock.advance(15_000)
    const ui = await $.ui.mount(BAND)
    expect(await text(ui)).not.toContain('#7')
    await ui.unmount()
  }
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
  await clock.advance(1100) // 先飞回原位
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

const PET_KEYS = ['chick', 'duck', 'penguin', 'owl', 'parrot', 'alphaq']

// 模拟在输入框里敲 /chick <args>
function chick($: Parameters<TestBody>[0], args: string) {
  return $.command.run({
    command: 'chick', args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 100 },
  })
}

async function rasterKey(ui: { find: (q: never) => Promise<{ key?: string } | undefined> }) {
  return (await ui.find({ type: 'Raster' } as never))?.key ?? ''
}

// 真实引擎里 /clear 会换成新会话：session.end(clear) 之后 $.state 变空，且不会再触发 session.start。
// 测试框架不会清空状态，这里自己接管状态读写，/clear 时手动清空。
function sessionState(on: On) {
  type Cell = { value: unknown; version: number }
  let cells = new Map<string, Cell>()
  const at = (e: { plugin: string; key: string; id?: string }) => `${e.plugin}/${e.key}/${e.id ?? ''}`
  on('state.get', (_, e) => ({ value: cells.get(at(e)) ?? { value: undefined, version: 0 } }))
  on('state.set', (_, e) => {
    const version = cells.get(at(e))?.version ?? 0
    if (e.ifVersion !== undefined && e.ifVersion !== version) {
      return { value: { isSet: false as const, version } }
    }
    cells.set(at(e), { value: e.value, version: version + 1 })
    return { value: { isSet: true as const, version: version + 1 } }
  })
  return { wipe: () => { cells = new Map() } }
}

async function clearSession($: Parameters<TestBody>[0], state: { wipe: () => void }) {
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: {} as never })
  state.wipe()
}

test('/clear 之后还是固定选的宠物，中间也不会闪成小鸡', async ($, on) => {
  const clock = engine(on, { branch: null, gh: '[]', mergedIntoDev: false, store: { pet: 'duck' } })
  const state = sessionState(on)
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.advance(20)
  let ui = await $.ui.mount(BAND)
  expect(await rasterKey(ui)).toBe('duck-mini')
  await ui.unmount()

  await clearSession($, state)
  ui = await $.ui.mount(BAND) // 设置还没读回来：先沿用刚才那只
  expect(await rasterKey(ui)).toBe('duck-mini')
  await ui.unmount()

  await clock.advance(600)
  ui = await $.ui.mount(BAND)
  expect(await rasterKey(ui)).toBe('duck-mini')
  await ui.unmount()
})

test('/clear 之后隐藏的宠物仍然隐藏', async ($, on) => {
  const clock = engine(on, {
    branch: null, gh: '[]', mergedIntoDev: false, store: { pet: 'duck', hidden: true },
  })
  const state = sessionState(on)
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clearSession($, state)
  await clock.advance(600)

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Raster' } as never)).toBeUndefined()
  await ui.unmount()
})

test('没设置过宠物：每次会话随机来一只', async ($, on) => {
  const clock = engine(on, { branch: null, gh: '[]', mergedIntoDev: false, store: {} })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.advance(20)

  const ui = await $.ui.mount(BAND)
  const [who, pose] = (await rasterKey(ui)).split('-')
  expect(PET_KEYS).toContain(who)
  expect(pose).toBe('mini')
  await ui.unmount()
})

test('/chick 企鹅：换成企鹅并记住，英文名也认', async ($, on) => {
  const repo: Repo = { branch: null, gh: '[]', mergedIntoDev: false }
  const clock = engine(on, repo)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.advance(20)

  let r = await chick($, '企鹅')
  expect(r.text).toContain('企鹅')
  let ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Raster', key: 'penguin-mini' })).toBeDefined()
  await ui.unmount()
  expect(repo.store?.pet).toBe('penguin')

  r = await chick($, 'Owl')
  expect(r.text).toContain('猫头鹰')
  ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Raster', key: 'owl-mini' })).toBeDefined()
  await ui.unmount()
})

test('/chick 随机：清掉固定的宠物', async ($, on) => {
  const repo: Repo = { branch: null, gh: '[]', mergedIntoDev: false, store: { pet: 'duck' } }
  const clock = engine(on, repo)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.advance(20)

  let ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Raster', key: 'duck-mini' })).toBeDefined()
  await ui.unmount()

  const r = await chick($, '随机')
  expect(r.text).toContain('随机')
  expect(repo.store?.pet).toBeUndefined()
  ui = await $.ui.mount(BAND)
  expect(PET_KEYS).toContain((await rasterKey(ui)).split('-')[0])
  await ui.unmount()
})

test('/chick 不认识的名字：列出可选项，不改设置', async ($, on) => {
  const repo: Repo = { branch: null, gh: '[]', mergedIntoDev: false }
  const clock = engine(on, repo)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.advance(20)

  const r = await chick($, '恐龙')
  expect(r.text).toContain('鹦鹉')
  expect(repo.store?.pet).toBe('chick')
})

test('隐藏时换宠物会让它重新出现', async ($, on) => {
  const repo: Repo = { branch: null, gh: '[]', mergedIntoDev: false }
  const clock = engine(on, repo)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.advance(20)

  const r = await chick($, '')
  expect(r.text).toContain('小鸡已隐藏')
  expect(repo.store?.hidden).toBe(true)

  await chick($, '鹦鹉')
  expect(repo.store?.hidden).toBe(false)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Raster', key: 'parrot-mini' })).toBeDefined()
  await ui.unmount()
})

type Rastered = { find: (q: never) => Promise<{ props: Record<string, unknown> } | undefined> }

async function sizeOf(ui: Rastered, key: string) {
  const r = await ui.find({ type: 'Raster', key } as never)
  return r ? `${String(r.props.rows)}x${String(r.props.columns)}` : undefined
}

test('处理中原地跳舞：4 个舞步每 0.25 秒换一个，循环', async ($, on) => {
  const clock = engine(on, { branch: null, gh: '[]', mergedIntoDev: false })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'hi', turnId: 't1' })

  const seen: string[] = []
  let prev = 0
  for (const at of [0, 250, 500, 750, 1000]) {
    await clock.advance(at - prev)
    prev = at
    const ui = await $.ui.mount(BAND)
    seen.push(await rasterKey(ui))
    expect(await text(ui)).toContain('处理中')
    await ui.unmount()
  }
  expect(seen).toEqual(['chick-dance1', 'chick-dance2', 'chick-dance3', 'chick-dance4', 'chick-dance1'])
})

test('跳舞和完成都是原尺寸，气泡在宠物左边并排', async ($, on) => {
  const clock = engine(on, { branch: null, gh: '[]', mergedIntoDev: false })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  await $.turn.start({ text: 'hi', turnId: 't1' })
  await clock.advance(2000)
  let ui = await $.ui.mount(BAND)
  expect(await sizeOf(ui, 'chick-dance1')).toBe('6x19')
  const row = await ui.find({ type: 'Box', props: { flexDirection: 'row' } } as never)
  expect(row?.props.alignItems).toBe('flex-end')
  await ui.unmount()

  await $.turn.complete({
    answer: 'ok', durationMs: 2000, isAborted: false, turnId: 't1', reason: 'answer',
  })
  ui = await $.ui.mount(BAND)
  expect(await sizeOf(ui, 'chick-done')).toBe('6x19') // 不用飞回，马上开心
  expect(await text(ui)).toContain('完成 2s')
  await ui.unmount()
})

test('中途打断直接睡觉', async ($, on) => {
  const clock = engine(on, { branch: null, gh: '[]', mergedIntoDev: false })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  await $.turn.start({ text: 'hi', turnId: 't1' })
  await clock.advance(3000)
  await $.turn.complete({
    answer: '', durationMs: 3000, isAborted: true, turnId: 't1', reason: 'aborted',
  } as never)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Raster', key: 'chick-mini' })).toBeDefined()
  await ui.unmount()
})

test('处理中途演 PR 动画，演完接着跳', async ($, on) => {
  const clock = engine(on, { branch: 'feature/x', gh: '[]', mergedIntoDev: false })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('tool.call', () => ({ result: {}, text: 'https://github.com/o/r/pull/3\n' }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' })
  let ui = await $.ui.mount(BAND)
  expect(await rasterKey(ui)).toBe('chick-open')
  await ui.unmount()

  await clock.advance(3100)
  ui = await $.ui.mount(BAND)
  expect(await rasterKey(ui)).toMatch(/^chick-dance[1-4]$/)
  await ui.unmount()
})

test('/chick alphaQ：换成 alphaQ，大小写都认', async ($, on) => {
  const repo: Repo = { branch: null, gh: '[]', mergedIntoDev: false }
  const clock = engine(on, repo)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.advance(20)

  for (const typed of ['alphaQ', 'ALPHAQ', 'alphaq']) {
    await chick($, '小鸡')
    const r = await chick($, typed)
    expect(r.text).toContain('alphaQ')
    expect(repo.store?.pet).toBe('alphaq')
  }
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Raster', key: 'alphaq-mini' })).toBeDefined()
  await ui.unmount()
})

test('不认识的名字：可选项里有 alphaQ，不重复写英文名', async ($, on) => {
  const clock = engine(on, { branch: null, gh: '[]', mergedIntoDev: false })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.advance(20)

  const r = await chick($, '恐龙')
  expect(r.text).toContain('、alphaQ')
  expect(r.text).not.toContain('alphaQ（alphaq）')
})
