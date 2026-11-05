export type PrState = 'open' | 'merged' | 'closed'

/** 可选的宠物 */
export type Pet = 'chick' | 'duck' | 'penguin' | 'owl' | 'parrot'

export type FlashKind = 'done' | PrState

export type Flash = { kind: FlashKind; until: number }

/** 处理完成后飞回原位：起飞时已经走了多久（ms，用来算起点）、起飞时刻、要飞多久（ms） */
export type Flight = { walkedMs: number; at: number; ms: number }

/** 当前分支在 GitHub 上最新一个 PR 的状态（gh pr list 轮询所得） */
export type BranchPr = {
  branch: string
  state: PrState | null
  number: number | null
  checkedAt: number
}

/** 当前分支是否已真正合并进本地 / origin 上的 dev，或 release 开头的分支 */
export type LocalMerge = { branch: string; into: string | null }

declare module 'claude-code' {
  interface PluginState {
    'chick-status': {
      /** 主循环当前轮次开始的时间（ms），空闲为 null */
      workingSince: number | null
      /** 上一轮耗时（秒） */
      lastSeconds: number | null
      /** 临时造型（完成 / PR 事件），到期自动清除 */
      flash: Flash | null
      /** 正在飞回原位，飞到了清成 null */
      flight: Flight | null
      branchPr: BranchPr | null
      localMerge: LocalMerge | null
      /** 动画帧计数，每秒 +1 */
      tick: number
      isHidden: boolean
      /** 本次会话的宠物；null = 还没定（会话开始时按 /chick 的设置或随机选） */
      pet: Pet | null
    }
  }
}
