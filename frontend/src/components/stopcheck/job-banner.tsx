import { CircleAlertIcon, CircleCheckIcon, LoaderCircleIcon, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { Job } from "@/lib/api"
import { pct } from "@/lib/labels"
import { cn } from "@/lib/utils"

const TITLE: Record<Job["state"], string> = {
  running: "Fixture run in progress",
  completed: "Fixture run completed",
  completed_with_invalid: "Fixture run completed with invalid trials",
  failed: "Fixture run failed to execute",
}

/** Execution status only. Safety verdicts stay with each trial. */
export function JobBanner({ job, onOpen, onDismiss }: { job: Job; onOpen: (id: string) => void; onDismiss: () => void }) {
  const failed = job.state === "failed"
  const warn = failed || job.state === "completed_with_invalid"
  const Icon = job.state === "running" ? LoaderCircleIcon : warn ? CircleAlertIcon : CircleCheckIcon
  return (
    <div role="status" aria-live="polite" className="px-4 lg:px-6">
      <div className={cn("flex flex-col gap-3 rounded-xl border p-4", warn ? "border-amber-300 bg-amber-50/60" : "border-primary/25 bg-accent/50")}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Icon className={cn("size-4", job.state === "running" && "animate-spin text-primary", warn ? "text-amber-700" : "text-primary")} />
          <span className="font-medium">{TITLE[job.state]}</span>
          <span className="font-mono text-xs text-muted-foreground">runs/{job.run_id}</span>
          <div className="ml-auto flex items-center gap-2">
            {job.state !== "running" && !failed && <Button size="sm" onClick={() => onOpen(job.run_id)}>Open run</Button>}
            {job.state !== "running" && (
              <Button size="icon-sm" variant="ghost" onClick={onDismiss} aria-label="Dismiss"><XIcon /></Button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-background ring-1 ring-border" role="progressbar"
            aria-label="Trials finished" aria-valuemin={0} aria-valuemax={job.total} aria-valuenow={job.completed}>
            <div className={cn("h-full rounded-full transition-[width] duration-500", warn ? "bg-amber-500" : "bg-primary")}
              style={{ width: `${pct(job.completed, job.total)}%` }} />
          </div>
          <span className="font-mono text-xs tabular-nums">{job.completed} / {job.total}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {job.state === "running" && job.last_trial ? <>Last finished: <span className="font-mono">{job.last_trial}</span>. </> : null}
          This shows whether the runner executed. Safety verdicts are reported per trial.
        </p>
        {job.error && <pre className="max-h-40 overflow-auto rounded-md border border-amber-300 bg-background p-2 font-mono text-[11px] whitespace-pre-wrap text-destructive">{job.error}</pre>}
      </div>
    </div>
  )
}
