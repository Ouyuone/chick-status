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

// 原位在最右边：band 宽 100，宠物 21 列（左边留白 2 列 + 身体 14 列 + 道具 5 列），尘土 4 列
const HOME_X = 100 - 21

type Found = { find: (q: never) => Promise<{ props: Record<string, unknown> } | undefined> }

// 某一行离左边多少列；没有这一行时返回 undefined
async function trackX(ui: Found, key = 'pet-track') {
  const track = await ui.find({ key } as never)
  return track ? Number(track.props.marginLeft) : undefined
}

// 小鸡现在是哪个走路造型（尘土也是 Raster，不能只找第一个）
async function walkPoseOf(ui: Found) {
  for (const pose of ['walkL', 'walkR']) {
    if (await ui.find({ type: 'Raster', key: `chick-${pose}` } as never)) return pose
  }
  return undefined
}

async function dustSide(ui: Found) {
  for (const side of ['left', 'right']) {
    if (await ui.find({ type: 'Raster', key: `dust-${side}` } as never)) return side
  }
  return undefined
}

test('处理中在屏幕上走来走去，到头折返，尘土扬在身后', async ($, on) => {
  const clock = engine(on, { branch: null, gh: '[]', mergedIntoDev: false })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  await $.turn.start({ text: 'hi', turnId: 't1' })
  await clock.advance(2000) // 每 200ms 走一列：往左走了 10 列
  let ui = await $.ui.mount(BAND)
  expect(await walkPoseOf(ui)).toBeDefined()
  expect(await dustSide(ui)).toBe('right') // 往左走，尘土在右边
  expect(await trackX(ui)).toBe(HOME_X - 10 + 2) // 走路时这一行从身体开始
  expect(await text(ui)).toContain('处理中')
  await ui.unmount()

  // 走到最左边（79 列，15.8 秒）再往回走 5 列
  await clock.advance((HOME_X + 5) * 200 - 2000)
  ui = await $.ui.mount(BAND)
  expect(await dustSide(ui)).toBe('left') // 往右走，尘土在左边
  expect(await trackX(ui)).toBe(5 + 2 - 4) // 这一行从尘土开始
  await ui.unmount()
})

test('贴着左边往回走时，左边放不下尘土就不画', async ($, on) => {
  const clock = engine(on, { branch: null, gh: '[]', mergedIntoDev: false })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  await $.turn.start({ text: 'hi', turnId: 't1' })
  await clock.advance((HOME_X + 1) * 200) // 离左边 1 列，正往右走
  const ui = await $.ui.mount(BAND)
  expect(await dustSide(ui)).toBeUndefined()
  expect(await walkPoseOf(ui)).toBeDefined()
  expect(await trackX(ui)).toBe(1 + 2)
  await ui.unmount()
})

test('走路只换脚，不扇翅膀', async ($, on) => {
  const clock = engine(on, { branch: null, gh: '[]', mergedIntoDev: false })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'hi', turnId: 't1' })

  const seen: Array<string | undefined> = []
  let prev = 0
  for (const at of [0, 200, 400, 600]) {
    await clock.advance(at - prev)
    prev = at
    const ui = await $.ui.mount(BAND)
    seen.push(await walkPoseOf(ui))
    await ui.unmount()
  }
  expect(seen).toEqual(['walkL', 'walkR', 'walkL', 'walkR'])
})

test('气泡固定在右边，不跟着宠物走', async ($, on) => {
  const clock = engine(on, { branch: null, gh: '[]', mergedIntoDev: false })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  await $.turn.start({ text: 'hi', turnId: 't1' })
  await clock.advance(6000)
  const ui = await $.ui.mount(BAND)
  const row = await ui.find({ key: 'bubble-row' } as never)
  expect(row?.props.justifyContent).toBe('flex-end')
  expect(row?.props.marginLeft).toBeUndefined()
  await ui.unmount()
})

test('完成时从当前位置飞回原位，落地后才开心', async ($, on) => {
  const clock = engine(on, { branch: null, gh: '[]', mergedIntoDev: false })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  await $.turn.start({ text: 'hi', turnId: 't1' })
  await clock.advance(8000) // 走到 HOME_X - 40
  await $.turn.complete({
    answer: 'ok', durationMs: 8000, isAborted: false, turnId: 't1', reason: 'answer',
  })

  let ui = await $.ui.mount(BAND)
  expect((await rasterKey(ui)).split('-')[1]).toMatch(/^fly[12]$/)
  expect(await dustSide(ui)).toBeUndefined() // 飞的时候没有尘土
  expect(await trackX(ui)).toBe(HOME_X - 40)
  await ui.unmount()

  await clock.advance(500) // 离原位 40 列，每秒 40 列：飞 1 秒，现在飞到一半多（先快后慢）
  ui = await $.ui.mount(BAND)
  const mid = await trackX(ui) ?? 0
  expect(mid).toBeGreaterThan(HOME_X - 40)
  expect(mid).toBeLessThan(HOME_X)
  await ui.unmount()

  await clock.advance(600) // 落地：回到原来的布局
  ui = await $.ui.mount(BAND)
  expect(await trackX(ui)).toBeUndefined()
  expect(await ui.find({ type: 'Raster', key: 'chick-done' })).toBeDefined()
  expect(await text(ui)).toContain('完成 8s')
  await ui.unmount()
})

test('中途打断也飞回原位，然后睡觉', async ($, on) => {
  const clock = engine(on, { branch: null, gh: '[]', mergedIntoDev: false })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  await $.turn.start({ text: 'hi', turnId: 't1' })
  await clock.advance(3000)
  await $.turn.complete({
    answer: '', durationMs: 3000, isAborted: true, turnId: 't1', reason: 'aborted',
  } as never)
  let ui = await $.ui.mount(BAND)
  expect((await rasterKey(ui)).split('-')[1]).toMatch(/^fly[12]$/)
  await ui.unmount()

  await clock.advance(1100)
  ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Raster', key: 'chick-mini' })).toBeDefined()
  await ui.unmount()
})

type Band = Parameters<Parameters<TestBody>[0]['ui']['mount']>[0]

async function walkThenComplete(
  $: Parameters<TestBody>[0], clock: { advance: (ms: number) => Promise<void> }, walkMs: number,
  band: Band = BAND,
) {
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await clock.advance(walkMs)
  const ui = await $.ui.mount(band) // 让插件知道这一行有多宽
  await ui.unmount()
  await $.turn.complete({
    answer: 'ok', durationMs: walkMs, isAborted: false, turnId: 't1', reason: 'answer',
  })
}

async function isFlying($: Parameters<TestBody>[0], band: Band = BAND) {
  const ui = await $.ui.mount(band)
  const flying = /^fly[12]$/.test((await rasterKey(ui)).split('-')[1] ?? '')
  await ui.unmount()
  return flying
}

test('飞回时间按距离算：离得近也至少飞 0.5 秒', async ($, on) => {
  const clock = engine(on, { branch: null, gh: '[]', mergedIntoDev: false })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  await walkThenComplete($, clock, 1000) // 离原位 5 列：按速度只要 0.125 秒
  await clock.advance(400)
  expect(await isFlying($)).toBe(true)
  await clock.advance(200)
  expect(await isFlying($)).toBe(false)
})

test('飞回时间按距离算：再远也最多飞 2.5 秒', async ($, on) => {
  const WIDE = { ...BAND, props: { ...BAND.props, bodyColumns: 300 } }
  const clock = engine(on, { branch: null, gh: '[]', mergedIntoDev: false })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  await walkThenComplete($, clock, 279 * 200, WIDE) // 走到最左边：离原位 279 列，按速度要 7 秒
  await clock.advance(2400)
  expect(await isFlying($, WIDE)).toBe(true)
  await clock.advance(200)
  expect(await isFlying($, WIDE)).toBe(false)
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
