import * as React from "react"
import { CircleHelpIcon, CpuIcon, FolderIcon, RotateCwIcon, ZapIcon } from "lucide-react"
import { toast } from "sonner"

import { AppSidebar, type View } from "@/components/app-sidebar"
import { ChartPostStop } from "@/components/chart-post-stop"
import { DataTable } from "@/components/data-table"
import { SectionCards } from "@/components/section-cards"
import { SiteHeader } from "@/components/site-header"
import { JobBanner } from "@/components/stopcheck/job-banner"
import { RunsView } from "@/components/stopcheck/runs-view"
import { TrialDrawer } from "@/components/stopcheck/trial-drawer"
import { FixtureBadge } from "@/components/stopcheck/verdict-badge"
import { Button } from "@/components/ui/button"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api, type Job, type Meta, type RunDetail, type RunInfo } from "@/lib/api"
import { formatUtc, runName } from "@/lib/labels"

function readHash() {
  const p = new URLSearchParams(window.location.hash.slice(1))
  return { view: (p.get("view") === "runs" ? "runs" : "overview") as View, run: p.get("run"), trial: p.get("trial") }
}

export default function App() {
  const initial = React.useRef(readHash())
  const [view, setView] = React.useState<View>(initial.current.view)
  const [meta, setMeta] = React.useState<Meta | null>(null)
  const [runs, setRuns] = React.useState<RunInfo[] | null>(null)
  const [runId, setRunId] = React.useState<string | null>(initial.current.run)
  const [detail, setDetail] = React.useState<RunDetail | null>(null)
  const [detailError, setDetailError] = React.useState<string | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [trial, setTrial] = React.useState<string | null>(initial.current.trial)
  const [job, setJob] = React.useState<Job | null>(null)
  const [repeat, setRepeat] = React.useState(1)
  const [launching, setLaunching] = React.useState(false)

  const loadRuns = React.useCallback(async () => {
    try {
      const list = await api.runs()
      setRuns(list)
      setLoadError(null)
      setRunId((current) => current && list.some((r) => r.id === current) ? current : (list.find((r) => r.bundled) ?? list[0])?.id ?? null)
      return list
    } catch (e) {
      setLoadError((e as Error).message)
      return null
    }
  }, [])

  const loadDetail = React.useCallback(async (id: string, quiet = false) => {
    if (!quiet) setDetail(null)
    try {
      const d = await api.run(id)
      setDetail((prev) => (prev && prev.run.id !== id && quiet ? prev : d))
      setDetailError(null)
    } catch (e) {
      setDetailError((e as Error).message)
    }
  }, [])

  // Initial load: metadata, runs and any job already running on the server.
  React.useEffect(() => {
    api.meta().then(setMeta).catch(() => undefined)
    loadRuns()
    api.jobs().then((jobs) => setJob(jobs.find((j) => j.state === "running") ?? null)).catch(() => undefined)
  }, [loadRuns])

  React.useEffect(() => { if (runId) loadDetail(runId) }, [runId, loadDetail])

  React.useEffect(() => {
    const p = new URLSearchParams()
    if (view !== "overview") p.set("view", view)
    if (runId) p.set("run", runId)
    if (trial) p.set("trial", trial)
    window.history.replaceState(null, "", `#${p.toString()}`)
  }, [view, runId, trial])

  // Poll the background run for real progress; refresh runs as trials finish.
  const jobId = job?.id
  const jobRunning = job?.state === "running"
  React.useEffect(() => {
    if (!jobId || !jobRunning) return
    let last = -1
    const timer = window.setInterval(async () => {
      try {
        const next = await api.job(jobId)
        setJob(next)
        if (next.completed !== last || next.state !== "running") {
          last = next.completed
          await loadRuns()
          setRunId((current) => { if (current === next.run_id) loadDetail(next.run_id, true); return current })
        }
        if (next.state === "completed") toast.success("Fixture run completed", { description: `${next.completed} trials in runs/${next.run_id}` })
        if (next.state === "completed_with_invalid") toast.warning("Fixture run completed with invalid trials", { description: `runs/${next.run_id}` })
        if (next.state === "failed") toast.error("Fixture run failed to execute", { description: next.error?.split("\n").at(-1) })
      } catch (e) {
        toast.error("Lost contact with the fixture run", { description: (e as Error).message })
      }
    }, 1000)
    return () => window.clearInterval(timer)
  }, [jobId, jobRunning, loadRuns, loadDetail])

  const launch = async () => {
    setLaunching(true)
    try {
      const started = await api.startJob(repeat)
      setJob(started)
      toast.info("Fixture run started", { description: `Writing to runs/${started.run_id}` })
      loadRuns()
    } catch (e) {
      toast.error("Could not start the fixture run", { description: (e as Error).message })
    } finally {
      setLaunching(false)
    }
  }

  const openRun = (id: string) => {
    setTrial(null)
    setRunId(id)
    setView("overview")
  }

  const run = detail?.run ?? runs?.find((r) => r.id === runId) ?? null
  const title = view === "runs" ? "Runs" : "Overview"

  return (
    <SidebarProvider style={{ "--sidebar-width": "calc(var(--spacing) * 68)", "--header-height": "calc(var(--spacing) * 12)" } as React.CSSProperties}>
      <AppSidebar variant="inset" view={view} onView={setView} runs={runs} runId={runId} onRun={openRun} />
      <SidebarInset>
        <SiteHeader title={title} runs={runs} run={run} onRun={openRun} job={job} repeat={repeat}
          maxRepeat={meta?.max_repeat ?? 5} perRepeat={meta?.trials_per_repeat ?? 54}
          onRepeat={setRepeat} onLaunch={launch} launching={launching} />
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
              {loadError && (
                <div role="alert" className="mx-4 flex flex-wrap items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive lg:mx-6">
                  Could not reach the StopCheck backend: {loadError}
                  <Button size="sm" variant="outline" className="ml-auto" onClick={loadRuns}><RotateCwIcon data-icon="inline-start" />Retry</Button>
                </div>
              )}
              {job && <JobBanner job={job} onOpen={openRun} onDismiss={() => setJob(null)} />}

              <div className="flex flex-wrap items-end justify-between gap-3 px-4 lg:px-6">
                <div className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-2xl font-semibold tracking-tight">
                      {view === "runs" ? "All runs" : run ? (run.bundled ? "Bundled pilot run" : runName(run)) : <Skeleton className="h-8 w-56" />}
                    </h2>
                    <FixtureBadge />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label="What “Scripted fixture” means"><CircleHelpIcon /></Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-sm text-left leading-relaxed">
                        Deliberately constructed fixtures, not deployed-agent failure rates. App cancellation and agent stop
                        messages are separate channels. Message-channel behavior is scripted. The authority gate is a reference control.
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  {view === "overview" && detail && (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                      {detail.meta.generated_utc && <span>Generated {formatUtc(detail.meta.generated_utc, 19)}</span>}
                      {detail.meta.python && <span className="inline-flex items-center gap-1"><CpuIcon className="size-3.5" />Python {detail.meta.python}</span>}
                      {detail.meta.live_model_calls !== undefined && (
                        <span className="inline-flex items-center gap-1"><ZapIcon className="size-3.5" />{detail.meta.live_model_calls} live-model calls</span>
                      )}
                      <span className="inline-flex items-center gap-1 font-mono text-xs"><FolderIcon className="size-3.5" />runs/{detail.run.id}</span>
                    </div>
                  )}
                </div>
                {view === "overview" && detail && <p className="text-xs text-muted-foreground">Verdicts from {detail.source}</p>}
              </div>

              {view === "runs" ? (
                <RunsView runs={runs} runId={runId} onOpen={openRun} runsRoot={meta?.runs_root ?? ""} />
              ) : detailError ? (
                <div role="alert" className="mx-4 flex flex-wrap items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive lg:mx-6">
                  Could not load run {runId}: {detailError}
                  <Button size="sm" variant="outline" className="ml-auto" onClick={() => runId && loadDetail(runId)}><RotateCwIcon data-icon="inline-start" />Retry</Button>
                </div>
              ) : runs?.length === 0 ? (
                <div className="mx-4 rounded-xl border border-dashed p-10 text-center text-muted-foreground lg:mx-6">
                  No runs found. Use “Run fixture suite” to create the first one.
                </div>
              ) : (
                <>
                  <SectionCards summary={detail?.summary ?? null} />
                  <div className="px-4 lg:px-6"><ChartPostStop controls={detail?.summary.controls ?? null} /></div>
                  <DataTable data={detail?.trials ?? null} loading={!detail} onOpen={setTrial} selected={trial} />
                </>
              )}
            </div>
          </div>
        </div>
      </SidebarInset>
      <TrialDrawer runId={runId} trial={trial} onClose={() => setTrial(null)} />
    </SidebarProvider>
  )
}
