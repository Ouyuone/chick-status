import { atom, read, update } from 'claude-code'
import type { EngineInterface, ProcessRunResult, Register, Timer } from 'claude-code'

import type { BranchPr, Flash, FlashKind, PrState } from '../types'
import { SPRITES, W } from './sprites'
import type { Pose } from './sprites'

const workingSince = atom({ plugin: 'chick-status', key: 'workingSince' } as const, null)
const lastSeconds = atom({ plugin: 'chick-status', key: 'lastSeconds' } as const, null)
const flash = atom({ plugin: 'chick-status', key: 'flash' } as const, null)
const branchPr = atom({ plugin: 'chick-status', key: 'branchPr' } as const, null)
const localMerge = atom({ plugin: 'chick-status', key: 'localMerge' } as const, null)
const tick = atom({ plugin: 'chick-status', key: 'tick' } as const, 0)
const isHidden = atom({ plugin: 'chick-status', key: 'isHidden' } as const, false)

const STORE_HIDDEN = 'hidden'
const FLASH_MS: Record<FlashKind, number> = { done: 5000, open: 3000, merged: 3000, closed: 3000 }
const MIN_COLUMNS = 40
const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'

/** 本地检查（git）的周期；GitHub 查询受 GH_TTL 限制 */
const POLL_MS = 15_000
const GH_TTL = 120_000
/** 命令触发后等 GitHub 落盘再查 */
const AFTER_CMD_MS = 1500
/** 合并目标：dev 或 release 开头的分支 */
const BASE_RE = /^(dev|release)/
/** 当前分支本身就是这些时不显示 PR 状态 */
const SKIP_RE = /^(main|master|dev|release)/

const PR_CMD = /\bgh\s+pr\s+(create|merge|close|reopen)\b([^;&|\n]*)/g
const PR_MCP = /^mcp__.*github.*__(create_pull_request|merge_pull_request|update_pull_request)$/i

type Dollar = EngineInterface

let ticker: Timer | undefined
let poller: Timer | undefined
let isRefreshing = false
let isForcePending = false

// ---------- 动画 ----------

// 处理中或有临时造型时每秒走一帧，否则停表
async function ensureTicker($: Dollar) {
  const busy = (await read($, workingSince)) !== null || (await read($, flash)) !== null
  if (busy && !ticker) {
    ticker = $.clock.every(1000, () => void onTick($))
  } else if (!busy && ticker) {
    ticker.cancel()
    ticker = undefined
  }
}

async function onTick($: Dollar) {
  const f = await read($, flash)
  if (f && (await $.clock.now()) >= f.until) await update($, flash, () => null)
  await update($, tick, n => n + 1)
  await ensureTicker($)
}

async function showFlash($: Dollar, kind: FlashKind) {
  const until = (await $.clock.now()) + FLASH_MS[kind]
  const next: Flash = { kind, until }
  await update($, flash, () => next)
  await ensureTicker($)
}

// 同类动画正在演就不重复演
async function flashUnlessShowing($: Dollar, kind: PrState) {
  const f = await read($, flash)
  if (f && f.kind === kind && (await $.clock.now()) < f.until) return
  await showFlash($, kind)
}

async function resetSession($: Dollar) {
  await update($, workingSince, () => null)
  await update($, lastSeconds, () => null)
  await update($, flash, () => null)
  await ensureTicker($)
}

// ---------- PR 真相：git 本地判断 + gh 轮询 ----------

async function git($: Dollar, cwd: string, args: string[]): Promise<ProcessRunResult> {
  return $.process.run(['git', '-C', cwd, ...args], {
    env: { GIT_OPTIONAL_LOCKS: '0' },
    timeoutMs: 10_000,
  })
}

async function currentBranch($: Dollar, cwd: string): Promise<string | null> {
  const r = await git($, cwd, ['symbolic-ref', '--short', 'HEAD'])
  return r.exitCode === 0 ? r.stdout.trim() || null : null
}

// 分支尖端是某个 dev*/release* 的祖先，且是经由合并提交进去的（不在其第一父链上），
// 才算真正合并；刚拉出来还没提交的新分支、或快进，都在第一父链上，不算。
async function findLocalMerge($: Dollar, cwd: string, branch: string): Promise<string | null> {
  const tipRun = await git($, cwd, ['rev-parse', '--verify', '--quiet', branch])
  const tip = tipRun.stdout.trim()
  if (tipRun.exitCode !== 0 || !tip) return null
  const refs = await git($, cwd, [
    'for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes/origin',
  ])
  if (refs.exitCode !== 0) return null
  const cands = refs.stdout
    .split('\n')
    .map(s => s.trim())
    .filter(r => r && r !== branch && BASE_RE.test(r.replace(/^origin\//, '')))
  for (const cand of cands) {
    const anc = await git($, cwd, ['merge-base', '--is-ancestor', tip, cand])
    if (anc.exitCode !== 0) continue
    const path = await git($, cwd, ['rev-list', '--first-parent', '--ancestry-path', `${tip}..${cand}`])
    const oldest = path.stdout.trim().split('\n').filter(Boolean).pop()
    if (!oldest) continue // 尖端就是 cand 的尖端：新分支
    const parent = await git($, cwd, ['rev-parse', `${oldest}^1`])
    if (parent.stdout.trim() === tip) continue // 在第一父链上：新分支或快进
    return cand.replace(/^origin\//, '')
  }
  return null
}

// undefined = 查询失败（保留旧值）；state null = 该分支没有 PR
async function fetchPr(
  $: Dollar,
  cwd: string,
  branch: string,
): Promise<{ state: PrState | null; number: number | null } | undefined> {
  try {
    const r = await $.process.run(
      ['gh', 'pr', 'list', '--search', `head:${branch}`, '--state', 'all',
        '--json', 'state,number', '--limit', '1'],
      { cwd, timeoutMs: 20_000 },
    )
    if (r.exitCode !== 0) return undefined
    const list = JSON.parse(r.stdout) as Array<{ state?: string; number?: number }>
    const first = list[0]
    if (!first) return { state: null, number: null }
    const s = String(first.state ?? '').toUpperCase()
    const state: PrState | null =
      s === 'MERGED' ? 'merged' : s === 'CLOSED' ? 'closed' : s === 'OPEN' ? 'open' : null
    return { state, number: typeof first.number === 'number' ? first.number : null }
  } catch {
    return undefined
  }
}

// 刷新一次；force 时无视 GitHub 缓存。同一时刻只跑一个，期间来的 force 排队补一次。
async function refresh($: Dollar, force: boolean) {
  if (isRefreshing) {
    if (force) isForcePending = true
    return
  }
  isRefreshing = true
  try {
    const cwd = await $.session.cwd()
    const branch = await currentBranch($, cwd).catch(() => null)
    if (!branch || SKIP_RE.test(branch)) {
      await update($, branchPr, () => null)
      await update($, localMerge, () => null)
      return
    }

    const prevLocal = await read($, localMerge)
    const into = await findLocalMerge($, cwd, branch).catch(() => null)
    await update($, localMerge, () => ({ branch, into }))
    if (into && prevLocal?.branch === branch && !prevLocal.into) await flashUnlessShowing($, 'merged')

    const prev = await read($, branchPr)
    const now = await $.clock.now()
    const isStale = !prev || prev.branch !== branch || now - prev.checkedAt >= GH_TTL
    if (!force && !isStale) return
    const got = await fetchPr($, cwd, branch)
    if (!got) return
    const next: BranchPr = { branch, ...got, checkedAt: now }
    await update($, branchPr, () => next)
    // 同一分支状态变了（例如在网页上被合并）→ 演一下
    if (prev?.branch === branch && got.state && got.state !== prev.state) {
      await flashUnlessShowing($, got.state)
    }
  } catch {
    // git / gh 不可用：保留上次结果
  } finally {
    isRefreshing = false
    if (isForcePending) {
      isForcePending = false
      void refresh($, true)
    }
  }
}

function startPoller($: Dollar) {
  if (poller) return
  poller = $.clock.every(POLL_MS, () => void refresh($, false))
  $.clock.after(10, () => void refresh($, false))
}

// 命令只负责：立刻演动画 + 稍后强制刷新真相
async function onPrAction($: Dollar, kind: PrState | null) {
  if (kind) await showFlash($, kind)
  $.clock.after(AFTER_CMD_MS, () => void refresh($, true))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'chick',
      description: '小鸡状态：/chick 显示或隐藏',
    })
    const hidden = (await $.store.get(STORE_HIDDEN)) === true
    await update($, isHidden, () => hidden)
    await ensureTicker($)
    startPoller($)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await resetSession($)
    return next(e)
  })

  on('command.run', { command: 'chick' }, async $ => {
    const hidden = !(await read($, isHidden))
    await update($, isHidden, () => hidden)
    await $.store.set(STORE_HIDDEN, hidden)
    return { text: hidden ? '小鸡已隐藏，/chick 再次显示。' : '小鸡回来了。' }
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      const now = await $.clock.now()
      await update($, workingSince, () => now)
      await ensureTicker($)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, workingSince, () => null)
      await update($, lastSeconds, () => Math.round(e.durationMs / 1000))
      if (e.reason === 'answer') await showFlash($, 'done')
      else await ensureTicker($)
    }
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    const matches = [...e.command.matchAll(PR_CMD)]
    if (matches.length === 0 || ran.deny !== undefined || ran.isError === true) return ran
    let kind: PrState | null = null
    for (const [, action = '', rest = ''] of matches) {
      if (action === 'merge') kind = /--auto\b/.test(rest) ? kind : 'merged' // 自动合并不代表已合并
      else if (action === 'close') kind = 'closed'
      else kind = 'open'
    }
    await onPrAction($, kind)
    return ran
  })

  // GitHub MCP 工具（若已连接）
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const name = String(e.tool)
    if (!PR_MCP.test(name) || ran.deny !== undefined || ran.isError === true) return ran
    const input = e as unknown as Record<string, unknown>
    const kind: PrState | null = /create_pull_request$/i.test(name)
      ? 'open'
      : /merge_pull_request$/i.test(name)
        ? 'merged'
        : input.state === 'closed'
          ? 'closed'
          : input.state === 'open'
            ? 'open'
            : null
    await onPrAction($, kind)
    return ran
  })

  // GitHub 推送（仅订阅了 PR 的会话会收到）
  on('session.receive', async ($, e, next) => {
    const ev = e.event
    if (ev?.source === 'github' && /pull_request/.test(ev.kind)) {
      const outcome = String(ev.data.outcome ?? ev.data.action ?? ev.kind)
      const kind: PrState | null = /merged/.test(outcome)
        ? 'merged'
        : /closed/.test(outcome)
          ? 'closed'
          : /opened|reopened/.test(outcome)
            ? 'open'
            : null
      await onPrAction($, kind)
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.hasSurvey || (await read($, isHidden))) return next(e)

    const frame = await read($, tick)
    const since = await read($, workingSince)
    const f = await read($, flash)
    const last = await read($, lastSeconds)
    const pr = await read($, branchPr)
    const lm = await read($, localMerge)
    const now = await $.clock.now()
    const activeFlash = f && now < f.until ? f.kind : null

    const pose: Pose = activeFlash
      ? activeFlash
      : since !== null
        ? frame % 2 === 0 ? 'work1' : 'work2'
        : 'mini'

    const head =
      since !== null
        ? `${SPIN[frame % SPIN.length]} 处理中 ${Math.max(0, Math.round((now - since) / 1000))}s`
        : activeFlash === 'done'
          ? `✓ 完成 ${last ?? 0}s`
          : activeFlash === 'open'
            ? '● PR 已创建'
            : activeFlash === 'merged'
              ? '◆ PR 已合并'
              : activeFlash === 'closed'
                ? '✕ PR 已关闭'
                : last !== null
                  ? `zzZ · 上次 ${last}s`
                  : 'zzZ'

    // 当前分支的 PR 真相 + 本地合并判断
    const tags: Array<[string, string]> = []
    const num = pr?.number ? `#${pr.number} ` : ''
    if (pr?.state === 'open') tags.push(['#46c86e', `● ${num}open`])
    else if (pr?.state === 'merged') tags.push(['#af6eeb', `◆ ${num}merged`])
    else if (pr?.state === 'closed') tags.push(['#eb5050', `✕ ${num}closed`])
    if (lm?.into && pr?.state !== 'merged') tags.push(['#af6eeb', `◆ 已并入 ${lm.into}`])

    const { Box, Text, Raster } = $.ui.resolve(e)
    const BG = '#3a3a3a'

    const bubble = (
      <Text backgroundColor={BG} color="#ffffff">
        {' '}
        {head}
        {tags.map(([color, label]) => (
          <Text backgroundColor={BG} color={color}>
            {' · '}
            {label}
          </Text>
        ))}{' '}
      </Text>
    )

    // 太窄：只留一行文字
    if (e.props.bodyColumns < MIN_COLUMNS) {
      return (
        <Box flexDirection="row" justifyContent="flex-end">
          {bubble}
        </Box>
      )
    }

    const sprite = SPRITES[pose]
    const art = <Raster key={`chick-${pose}`} columns={W} rows={sprite.rows} cells={sprite.cells} />

    if (pose === 'mini') {
      return (
        <Box flexDirection="row" justifyContent="flex-end" alignItems="flex-end">
          {bubble}
          {art}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" alignItems="flex-end">
        {bubble}
        {art}
      </Box>
    )
  })
}
