export interface TargetPlanOptions {
  target: string
  tag?: string
  maxJobs?: number
  parallel?: number
  config?: string
  preTargets?: string[]
  postTargets?: string[]
}

export interface MatrixEntry {
  target: string
  projects: string[]
  config: string
  parallel: number
  preTargets: string[]
  postTargets: string[]
  tag: string
  index: number
  count: number
  weight: number
}

export interface ProjectMatrix {
  include: MatrixEntry[]
}
