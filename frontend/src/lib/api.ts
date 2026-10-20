// Typed client for the FastAPI backend in stopcheck/web/app.py.

export type Verdict = "pass" | "fail" | "not_challenged" | "invalid"

export interface TrialRow {
  trial: string
  channel?: string
  policy?: string
  control?: string
  scenario?: string
  repeat?: number
  valid: boolean
  errors: string[]
  safety: Verdict
  post_stop_commits?: number
  post_stop_worker_attempts?: number
  pre_stop_commits?: number
  pre_stop_effects_settled_late?: number
  gate_blocks?: number
  cancelled_workers?: number
  scripted_continuation?: boolean | null
  model_noncompliance?: boolean | null
  false_stopped_ui?: boolean
  benign_task_completed?: boolean | null
  event_count?: number
}

export interface ChannelCount {
  channel: string
  policy: string
  trials_with_post_stop_commit: number
  valid_stopped_trials: number
}

export interface ControlSummary {
  control: string
  trials_with_post_stop_commit: number
  post_stop_commits: number
  valid_stopped_trials: number
  by_channel: ChannelCount[]
}

export interface Summary {
  trials: number
  passes: number
  failures: number
  benign_controls: number
  benign_completed: number
  invalid: number
  stopped_trials: number
  controls: ControlSummary[]
}

export type JobState = "running" | "completed" | "completed_with_invalid" | "failed"

export interface Job {
  id: string
  run_id: string
  state: JobState
  repeat: number
  total: number
  completed: number
  verdicts: Record<string, number>
  last_trial: string | null
  started_utc: string
  finished_utc: string | null
  returncode: number | null
  error: string | null
  output_tail: string[]
}

export type RunStatus = "complete" | "running" | "failed" | "incomplete" | "unreadable"

export interface RunInfo {
  id: string
  bundled: boolean
  has_summary: boolean
  trial_dirs: number
  generated_utc: string | null
  status: RunStatus
  job: Job | null
}

export interface RunDetail {
  run: RunInfo
  meta: { generated_utc?: string; python?: string; evidence_kind?: string; live_model_calls?: number }
  source: string
  summary: Summary
  trials: TrialRow[]
}

export interface TraceEvent {
  seq: number
  utc?: string
  monotonic_ns?: number
  event: string
  actor: string
  data: Record<string, unknown>
}

export interface TrialDetail {
  run_id: string
  trial: string
  verdict: TrialRow
  verdict_source: string
  events: TraceEvent[]
  sqlite: Record<"authority" | "jobs" | "effects", Record<string, unknown>[]> | null
}

export interface RescoreResult {
  trial: string
  rescored: TrialRow
  saved_available: boolean
  matches_saved: boolean | null
  differences: { field: string; saved: unknown; rescored: unknown }[]
  scored_utc: string
}

export interface Meta {
  trials_per_repeat: number
  max_repeat: number
  runs_root: string
  python: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  const type = res.headers.get("content-type") ?? ""
  const body = type.includes("application/json") ? await res.json() : await res.text()
  if (!res.ok) {
    const message = typeof body === "object" && body && "error" in body ? String(body.error) : `${res.status} ${res.statusText}`
    throw new Error(message)
  }
  return body as T
}

const enc = encodeURIComponent
const post = { method: "POST", headers: { "Content-Type": "application/json" } }

export const api = {
  meta: () => request<Meta>("/api/meta"),
  runs: () => request<{ runs: RunInfo[] }>("/api/runs").then((r) => r.runs),
  run: (id: string) => request<RunDetail>(`/api/runs/${enc(id)}`),
  trial: (run: string, trial: string) => request<TrialDetail>(`/api/runs/${enc(run)}/trials/${enc(trial)}`),
  rawLog: (run: string, trial: string) => request<string>(`/api/runs/${enc(run)}/trials/${enc(trial)}/events.jsonl`),
  rescore: (run: string, trial: string) =>
    request<RescoreResult>(`/api/runs/${enc(run)}/trials/${enc(trial)}/rescore`, { ...post, body: "{}" }),
  jobs: () => request<{ jobs: Job[] }>("/api/jobs").then((r) => r.jobs),
  job: (id: string) => request<Job>(`/api/jobs/${enc(id)}`),
  startJob: (repeat: number, label = "") =>
    request<Job>("/api/jobs", { ...post, body: JSON.stringify({ repeat, label }) }),
}

export const fileUrl = (run: string, name: string) => `/api/runs/${enc(run)}/files/${name}`
export const archiveUrl = (run: string) => `/api/runs/${enc(run)}/archive.zip`
export const logUrl = (run: string, trial: string) => `/api/runs/${enc(run)}/trials/${enc(trial)}/events.jsonl`
