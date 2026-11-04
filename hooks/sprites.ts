// 像素小鸡：每个字符格用 ▀ 画上下两个像素，打包成 Raster 的 cells
export const W = 21 // 2 左翼留白 + 14 身体 + 5 道具

const PAL: Record<string, number> = {
  D: 0xaa6e14, // 描边
  Y: 0xffd43c, // 黄
  L: 0xfff0a0, // 高光
  E: 0xebaf23, // 翅膀
  K: 0x1e1919, // 黑
  H: 0xffffff, // 眼高光
  A: 0xf57d28, // 喙 / 脚
  P: 0xfa968c, // 腮红
  B: 0x5aa0ff, // 泪
  Z: 0x96afff, // zzZ
  F: 0x46c86e, // 旗
  M: 0xaf6eeb, // 紫屑
  C: 0xff78c8, // 粉屑
  R: 0xeb5050, // 红屑
  S: 0xffc828, // 星星
}
const DEFAULT = 0x01000000

const BASE = [
  '.....D.D......', // 0 呆毛
  '...DDDDDDDD...', // 1
  '..DYYYYYLLYD..', // 2
  '.DYYYYYYYLLYD.', // 3
  '.DYHKYYYYHKYD.', // 4 眼
  '.DYKKYAAYKKYD.', // 5 眼 + 喙
  'DYPPYYAAYYPPYD', // 6 腮红
  'DEYYYYYYYYYYED', // 7 翅膀
  'DEEYYYYYYYYEED', // 8
  '.DEYYYYYYYYED.', // 9
  '..DDDDDDDDDD..', // 10
  '...AAA..AAA...', // 11 脚
]

type Rows = Record<number, string>
type Extra = Array<[number, number, string]>

function build(rows: Rows = {}, extra: Extra = [], base: string[] = BASE): string[] {
  const g = base.map((r, i) => ('..' + (rows[i] ?? r)).padEnd(W, '.'))
  for (const [r, c, ch] of extra) {
    const x = c + 2
    const row = g[r] ?? ''
    g[r] = row.slice(0, x) + ch + row.slice(x + 1)
  }
  return g
}

const BLINK: Rows = { 4: '.DYYYYYYYYYYD.', 5: '.DYKKYAAYKKYD.' }
const HAPPY: Rows = { 4: '.DYKKYYYYKKYD.', 5: '.DKYYKAAKYYKD.' }
const WING_UP: Rows = {
  5: '.DEKKYAAYKKED.', 6: 'DEPPYYAAYYPPED', 7: 'DYYYYYYYYYYYYD',
  8: 'DYYYYYYYYYYYYD', 9: '.DYYYYYYYYYYD.',
}
const SAD: Rows = { 0: '......DD......', 4: '.DYYKYYYYKYYD.', 5: '.DKKYYAAYYKKD.' }

const range = (a: number, b: number) => Array.from({ length: b - a }, (_, i) => a + i)
const FLAG: Extra = [
  ...range(0, 11).map(r => [r, 14, 'D'] as [number, number, string]),
  ...range(0, 3).flatMap(r => range(15, 19).map(c => [r, c, 'F'] as [number, number, string])),
]
const ZZZ: Extra = [
  ...range(15, 19).map(c => [0, c, 'Z'] as [number, number, string]),
  [1, 17, 'Z'], [2, 16, 'Z'],
  ...range(15, 19).map(c => [3, c, 'Z'] as [number, number, string]),
  [5, 14, 'Z'], [5, 15, 'Z'], [5, 16, 'Z'], [6, 15, 'Z'], [7, 14, 'Z'],
  [8, 14, 'Z'], [8, 15, 'Z'], [8, 16, 'Z'],
]
const CONFETTI: Extra = [
  [0, 1, 'M'], [0, 10, 'C'], [0, 13, 'S'], [1, 15, 'R'], [2, 18, 'M'],
  [3, 14, 'S'], [4, 17, 'C'], [6, 15, 'R'], [0, 17, 'S'],
]
const SPARKLE: Extra = [[1, 15, 'S'], [2, 14, 'S'], [2, 16, 'S'], [3, 15, 'S']]
const WINGS_OUT: Extra = [
  [4, -2, 'D'], [5, -2, 'E'], [5, -1, 'D'], [6, -2, 'D'], [6, -1, 'E'], [7, -1, 'E'],
  [4, 15, 'D'], [5, 15, 'E'], [5, 14, 'D'], [6, 15, 'D'], [6, 14, 'E'], [7, 14, 'E'],
]

// 迷你版：只露出呆毛、闭眼和小 z，2 行
const MINI_BASE = [
  '.....D.D......',
  '..DDDDDDDDDD..',
  '.DYKKYAAYKKYD.',
  'DYPPYYAAYYPPYD',
]

export type Pose =
  | 'work1' | 'work2' | 'done' | 'sleep' | 'open' | 'merged' | 'closed' | 'mini'

const GRIDS: Record<Pose, string[]> = {
  work1: build(),
  work2: build(
    { 4: BLINK[4] ?? '', 5: BLINK[5] ?? '', 7: 'DYYYYYYYYYYYYD', 8: 'DYYYYYYYYYYYYD', 9: '.DYYYYYYYYYYD.' },
    WINGS_OUT,
  ),
  done: build(HAPPY, SPARKLE),
  sleep: build(BLINK, ZZZ),
  open: build({ 6: 'DYPPYYAAYYPPEE', 7: 'DEYYYYYYYYYYYD' }, FLAG),
  merged: build({ ...HAPPY, ...WING_UP, 5: '.DKYYKAAKYYKD.' }, CONFETTI),
  closed: build(SAD, [[6, 3, 'B'], [7, 3, 'B']]),
  mini: build({}, [[0, 15, 'Z'], [0, 16, 'Z'], [1, 16, 'Z'], [2, 15, 'Z'], [2, 16, 'Z']], MINI_BASE),
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function toBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0, b = bytes[i + 1], c = bytes[i + 2]
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    out += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63)
    out += i + 1 < bytes.length ? B64.charAt((n >> 6) & 63) : '='
    out += i + 2 < bytes.length ? B64.charAt(n & 63) : '='
  }
  return out
}

const UPPER = 0x2580 // ▀
const LOWER = 0x2584 // ▄
const SPACE = 0x20

function pack(grid: string[]): { columns: number; rows: number; cells: string } {
  const g = grid.length % 2 ? [...grid, '.'.repeat(W)] : grid
  const rows = g.length / 2
  const words = new Uint32Array(W * rows * 3)
  let k = 0
  for (let r = 0; r < rows; r++) {
    const top = g[r * 2] ?? '', bot = g[r * 2 + 1] ?? ''
    for (let c = 0; c < W; c++) {
      const t = PAL[top.charAt(c)], b = PAL[bot.charAt(c)]
      if (t !== undefined && b !== undefined) words.set([UPPER, t, b], k)
      else if (t !== undefined) words.set([UPPER, t, DEFAULT], k)
      else if (b !== undefined) words.set([LOWER, b, DEFAULT], k)
      else words.set([SPACE, DEFAULT, DEFAULT], k)
      k += 3
    }
  }
  return { columns: W, rows, cells: toBase64(new Uint8Array(words.buffer)) }
}

export const SPRITES: Record<Pose, { columns: number; rows: number; cells: string }> =
  Object.fromEntries(Object.entries(GRIDS).map(([k, v]) => [k, pack(v)])) as never
