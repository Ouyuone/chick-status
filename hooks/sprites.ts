// 像素宠物：每个字符格用 ▀ 画上下两个像素，打包成 Raster 的 cells
import type { Pet } from '../types'

export const W = 21 // 2 左翼留白 + 14 身体 + 5 道具

// 所有宠物共用的颜色（眼睛、道具）；各宠物的身体颜色在 SPECIES 里
const SHARED: Record<string, number> = {
  K: 0x1e1919, // 黑
  H: 0xffffff, // 眼高光
  B: 0x5aa0ff, // 泪
  Z: 0x96afff, // zzZ
  F: 0x46c86e, // 旗
  M: 0xaf6eeb, // 紫屑
  C: 0xff78c8, // 粉屑
  R: 0xeb5050, // 红屑
  S: 0xffc828, // 星星
}
const DEFAULT = 0x01000000

/**
 * 一种宠物。底图 12 行 × 14 列，各姿势按固定坐标改像素，所以底图要守同一套布局：
 * - 眼睛在第 4、5 行的第 3–4 列和第 9–10 列（第 4 行是 `HK`，第 5 行是 `KK`）
 * - 翅膀只用 `E`，在第 7–9 行左右两侧
 * - `face` 是眼睛周围的颜色（眨眼、表情用它填），`body` 是收起翅膀后补的颜色
 */
type Species = {
  name: string
  base: string[]
  /** 睡觉时的迷你版，4 行 */
  mini: string[]
  face: string
  body: string
  /** 难过时替换第 0 行（呆毛耷拉） */
  sadTop?: string
  palette: Record<string, number>
}

export const SPECIES = {
  chick: {
    name: '小鸡',
    face: 'Y',
    body: 'Y',
    sadTop: '......DD......',
    palette: {
      D: 0xaa6e14, // 描边
      Y: 0xffd43c, // 黄
      L: 0xfff0a0, // 高光
      E: 0xebaf23, // 翅膀
      A: 0xf57d28, // 喙 / 脚
      P: 0xfa968c, // 腮红
    },
    base: [
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
    ],
    mini: [
      '.....D.D......',
      '..DDDDDDDDDD..',
      '.DYKKYAAYKKYD.',
      'DYPPYYAAYYPPYD',
    ],
  },
  duck: {
    name: '小鸭',
    face: 'Y',
    body: 'Y',
    sadTop: '.....DD.......',
    palette: {
      D: 0x9a7a1e,
      Y: 0xfff06e, // 柠檬黄
      L: 0xffffd2,
      E: 0xe6cd46,
      A: 0xff8c1e, // 扁嘴 / 脚蹼
      O: 0xd25a14, // 下嘴
      P: 0xffaa96,
    },
    base: [
      '.......DD.....', // 0 卷毛
      '...DDDDDDDD...',
      '..DYYYYYLLYD..',
      '.DYYYYYYYLLYD.',
      '.DYHKYYYYHKYD.',
      '.DYKKYAAYKKYD.',
      'DYPPAAAAAAPPYD', // 6 扁扁的嘴
      'DEYYYOOOOYYYED',
      'DEEYYYYYYYYEED',
      '.DEYYYYYYYYED.',
      '..DDDDDDDDDD..',
      '..AAAA..AAAA..', // 11 脚蹼
    ],
    mini: [
      '.......DD.....',
      '..DDDDDDDDDD..',
      '.DYKKYAAYKKYD.',
      'DYPPAAAAAAPPYD',
    ],
  },
  penguin: {
    name: '企鹅',
    face: 'W',
    body: 'N',
    palette: {
      D: 0x5a6482,
      N: 0x2d3348, // 黑背
      L: 0x7a86a8,
      W: 0xf5f5fa, // 白肚皮
      E: 0x1e2234, // 鳍
      A: 0xffa028,
      P: 0xfa968c,
    },
    base: [
      '..............',
      '...DDDDDDDD...',
      '..DNNNNNNLND..',
      '.DNWWWNNWWWND.',
      '.DNHKWWWWHKND.',
      '.DNKKWAAWKKND.',
      'DNNPWWAAWWPNND',
      'DENWWWWWWWWNED',
      'DEENWWWWWWNEED',
      '.DENWWWWWWNED.',
      '..DDDDDDDDDD..',
      '...AAA..AAA...',
    ],
    mini: [
      '..............',
      '..DDDDDDDDDD..',
      '.DNKKWAAWKKND.',
      'DNNPWWAAWWPNND',
    ],
  },
  owl: {
    name: '猫头鹰',
    face: 'T',
    body: 'G',
    sadTop: '..D........D..',
    palette: {
      D: 0x4b2d14,
      G: 0x8c5a2d, // 棕
      L: 0xb4825a,
      T: 0xebd2a5, // 脸盘
      V: 0xc89b6e, // 胸前斑点
      E: 0x6e4120,
      A: 0xffbe32,
    },
    base: [
      '.DD........DD.', // 0 耳羽
      '.DGDDDDDDDDGD.',
      '.DGGGGGGGGLGD.',
      '.DGTTTGGTTTGD.',
      '.DTHKTGGTHKTD.',
      '.DTKKTAATKKTD.',
      'DGGTTTAATTTGGD',
      'DEGVGVGGVGVGED',
      'DEEGVGVVGVGEED',
      '.DEGGGGGGGGED.',
      '..DDDDDDDDDD..',
      '...AAA..AAA...',
    ],
    mini: [
      '.DD........DD.',
      '.DDDDDDDDDDDD.',
      '.DTKKTAATKKTD.',
      'DGGTTTAATTTGGD',
    ],
  },
  parrot: {
    name: '鹦鹉',
    face: 'G',
    body: 'G',
    sadTop: '.......QQ.....',
    palette: {
      D: 0x1e6432,
      G: 0x50c85a, // 绿
      L: 0xb4f0a0,
      Q: 0xe63c3c, // 红冠
      E: 0x2d8cdc, // 蓝翅
      A: 0xf5dc8c, // 弯钩嘴
      O: 0xc8a050,
      P: 0xffd23c, // 黄腮
      X: 0x969696, // 灰脚
    },
    base: [
      '.....QQQ......', // 0 红冠
      '...DDQQDDDD...',
      '..DGGGGGLLGD..',
      '.DGGGGGGGLLGD.',
      '.DGHKGGGGHKGD.',
      '.DGKKGAAGKKGD.',
      'DGPPGGAAGGPPGD',
      'DEGGGGGOGGGGED', // 7 嘴尖下钩
      'DEEGGGGGGGGEED',
      '.DEGGGGGGGGED.',
      '..DDDDDDDDDD..',
      '...XXX..XXX...',
    ],
    mini: [
      '.....QQQ......',
      '..DDDDDDDDDD..',
      '.DGKKGAAGKKGD.',
      'DGPPGGAAGGPPGD',
    ],
  },
} satisfies Record<Pet, Species>

export const PETS = Object.keys(SPECIES) as Pet[]

type Rows = Record<number, string>
type Px = [number, number, string]

function build(base: string[], extra: Px[] = [], rows: Rows = {}): string[] {
  const g = base.map((r, i) => ('..' + (rows[i] ?? r)).padEnd(W, '.'))
  for (const [r, c, ch] of extra) {
    const x = c + 2
    const row = g[r] ?? ''
    g[r] = row.slice(0, x) + ch + row.slice(x + 1)
  }
  return g
}

// ---------- 表情、翅膀：按固定坐标改像素 ----------

const range = (a: number, b: number) => Array.from({ length: b - a }, (_, i) => a + i)

const blink = (f: string): Px[] => [[4, 3, f], [4, 4, f], [4, 9, f], [4, 10, f]]
const happy = (f: string): Px[] => [
  [4, 3, 'K'], [4, 4, 'K'], [4, 9, 'K'], [4, 10, 'K'],
  [5, 2, 'K'], [5, 3, f], [5, 4, f], [5, 5, 'K'], [5, 8, 'K'], [5, 9, f], [5, 10, f], [5, 11, 'K'],
]
const sad = (f: string): Px[] => [
  [4, 3, f], [4, 4, 'K'], [4, 9, 'K'], [4, 10, f],
  [5, 2, 'K'], [5, 3, 'K'], [5, 4, f], [5, 5, f], [5, 8, f], [5, 9, f], [5, 10, 'K'], [5, 11, 'K'],
]
// 收起翅膀：第 7–9 行的 E 换成身体色
const hideWings = (s: Species): Px[] =>
  [7, 8, 9].flatMap(r =>
    [...(s.base[r] ?? '')].flatMap((ch, c): Px[] => (ch === 'E' ? [[r, c, s.body]] : [])),
  )
const WING_UP: Px[] = [[5, 2, 'E'], [5, 11, 'E'], [6, 1, 'E'], [6, 12, 'E']]
// 右翅举起来握旗杆
const holdFlag = (s: Species): Px[] => [[6, 12, 'E'], [6, 13, 'E'], [7, 12, s.body]]
const TEARS: Px[] = [[6, 3, 'B'], [7, 3, 'B']]
// 走路时左右脚轮流抬起，飞的时候脚收起来
const clearFeet = (from: number, to: number): Px[] => range(from, to).map((c): Px => [11, c, '.'])
const LIFT_LEFT = clearFeet(0, 7)
const LIFT_RIGHT = clearFeet(7, 14)
const TUCK_FEET = clearFeet(0, 14)

// ---------- 道具 ----------

const FLAG: Px[] = [
  ...range(0, 11).map((r): Px => [r, 14, 'D']),
  ...range(0, 3).flatMap(r => range(15, 19).map((c): Px => [r, c, 'F'])),
]
const ZZZ: Px[] = [
  ...range(15, 19).map((c): Px => [0, c, 'Z']),
  [1, 17, 'Z'], [2, 16, 'Z'],
  ...range(15, 19).map((c): Px => [3, c, 'Z']),
  [5, 14, 'Z'], [5, 15, 'Z'], [5, 16, 'Z'], [6, 15, 'Z'], [7, 14, 'Z'],
  [8, 14, 'Z'], [8, 15, 'Z'], [8, 16, 'Z'],
]
const CONFETTI: Px[] = [
  [0, 1, 'M'], [0, 10, 'C'], [0, 13, 'S'], [1, 15, 'R'], [2, 18, 'M'],
  [3, 14, 'S'], [4, 17, 'C'], [6, 15, 'R'], [0, 17, 'S'],
]
const SPARKLE: Px[] = [[1, 15, 'S'], [2, 14, 'S'], [2, 16, 'S'], [3, 15, 'S']]
const WINGS_OUT: Px[] = [
  [4, -2, 'D'], [5, -2, 'E'], [5, -1, 'D'], [6, -2, 'D'], [6, -1, 'E'], [7, -1, 'E'],
  [4, 15, 'D'], [5, 15, 'E'], [5, 14, 'D'], [6, 15, 'D'], [6, 14, 'E'], [7, 14, 'E'],
]
const MINI_Z: Px[] = [[0, 15, 'Z'], [0, 16, 'Z'], [1, 16, 'Z'], [2, 15, 'Z'], [2, 16, 'Z']]

export type Pose =
  | 'walkL' | 'walkR' | 'walkLFlap' | 'walkRFlap' | 'fly1' | 'fly2'
  | 'done' | 'sleep' | 'open' | 'merged' | 'closed' | 'mini'

function grids(s: Species): Record<Pose, string[]> {
  const sadTop: Rows = s.sadTop ? { 0: s.sadTop } : {}
  return {
    // 边走边扇翅膀：抬左脚 / 抬右脚 × 翅膀收起 / 张开
    walkL: build(s.base, LIFT_LEFT),
    walkR: build(s.base, LIFT_RIGHT),
    walkLFlap: build(s.base, [...blink(s.face), ...hideWings(s), ...WINGS_OUT, ...LIFT_LEFT]),
    walkRFlap: build(s.base, [...blink(s.face), ...hideWings(s), ...WINGS_OUT, ...LIFT_RIGHT]),
    fly1: build(s.base, [...hideWings(s), ...WING_UP, ...TUCK_FEET]),
    fly2: build(s.base, [...blink(s.face), ...hideWings(s), ...WINGS_OUT, ...TUCK_FEET]),
    done: build(s.base, [...happy(s.face), ...SPARKLE]),
    sleep: build(s.base, [...blink(s.face), ...ZZZ]),
    open: build(s.base, [...holdFlag(s), ...FLAG]),
    merged: build(s.base, [...hideWings(s), ...WING_UP, ...happy(s.face), ...CONFETTI]),
    closed: build(s.base, [...sad(s.face), ...TEARS], sadTop),
    mini: build(s.mini, MINI_Z),
  }
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

type Sprite = { columns: number; rows: number; cells: string }

function pack(grid: string[], pal: Record<string, number>): Sprite {
  const g = grid.length % 2 ? [...grid, '.'.repeat(W)] : grid
  const rows = g.length / 2
  const words = new Uint32Array(W * rows * 3)
  let k = 0
  for (let r = 0; r < rows; r++) {
    const top = g[r * 2] ?? '', bot = g[r * 2 + 1] ?? ''
    for (let c = 0; c < W; c++) {
      const t = pal[top.charAt(c)], b = pal[bot.charAt(c)]
      if (t !== undefined && b !== undefined) words.set([UPPER, t, b], k)
      else if (t !== undefined) words.set([UPPER, t, DEFAULT], k)
      else if (b !== undefined) words.set([LOWER, b, DEFAULT], k)
      else words.set([SPACE, DEFAULT, DEFAULT], k)
      k += 3
    }
  }
  return { columns: W, rows, cells: toBase64(new Uint8Array(words.buffer)) }
}

export const SPRITES: Record<Pet, Record<Pose, Sprite>> = Object.fromEntries(
  PETS.map(pet => {
    const s: Species = SPECIES[pet]
    const pal = { ...SHARED, ...s.palette }
    const poses = Object.entries(grids(s)).map(([pose, g]) => [pose, pack(g, pal)])
    return [pet, Object.fromEntries(poses)]
  }),
) as never
