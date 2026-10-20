import { ChevronDownIcon, DownloadIcon, LoaderCircleIcon, PlayIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { archiveUrl, fileUrl, type Job, type RunInfo } from "@/lib/api"
import { formatUtc, runName } from "@/lib/labels"
import { cn } from "@/lib/utils"

const STATUS: Record<string, { text: string; tone: "ok" | "busy" | "warn" }> = {
  complete: { text: "Complete", tone: "ok" },
  running: { text: "Running", tone: "busy" },
  failed: { text: "Execution failed", tone: "warn" },
  incomplete: { text: "Incomplete", tone: "warn" },
  unreadable: { text: "Unreadable", tone: "warn" },
}

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { text: status, tone: "warn" as const }
  return (
    <Badge variant="outline" className={cn("gap-1.5",
      s.tone === "ok" && "border-primary/30 text-accent-foreground",
      s.tone === "busy" && "border-primary/30 bg-accent text-accent-foreground",
      s.tone === "warn" && "border-amber-300 bg-amber-50 text-amber-800")}>
      {s.tone === "busy"
        ? <LoaderCircleIcon className="animate-spin" data-icon="inline-start" />
        : <span aria-hidden className={cn("size-1.5 rounded-full", s.tone === "ok" ? "bg-primary" : "bg-amber-500")} />}
      {s.text}
    </Badge>
  )
}

export function SiteHeader({ title, runs, run, onRun, job, repeat, maxRepeat, perRepeat, onRepeat, onLaunch, launching }: {
  title: string
  runs: RunInfo[] | null
  run: RunInfo | null
  onRun: (id: string) => void
  job: Job | null
  repeat: number
  maxRepeat: number
  perRepeat: number
  onRepeat: (n: number) => void
  onLaunch: () => void
  launching: boolean
}) {
  const busy = launching || job?.state === "running"
  return (
    <header className="sticky top-0 z-20 flex h-(--header-height) shrink-0 items-center gap-2 rounded-t-xl border-b bg-background/95 backdrop-blur transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-2 px-4 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-4" />
        <h1 className="hidden text-base font-medium lg:block">{title}</h1>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          <Select value={run?.id ?? ""} onValueChange={onRun} disabled={!runs?.length}>
            <SelectTrigger size="sm" className="w-36 sm:w-48 xl:w-64" aria-label="Select run">
              <SelectValue placeholder={runs ? "No runs" : "Loading runs…"} />
            </SelectTrigger>
            <SelectContent align="end">
              {runs?.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  <span className="truncate">{runName(r)}</span>
                  <span className="ml-auto pl-2 text-xs text-muted-foreground">
                    {r.status === "complete" ? (r.bundled ? "pilot" : formatUtc(r.generated_utc)) : r.status}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {run && <span className="hidden md:inline-flex"><StatusBadge status={run.status} /></span>}
          {run && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="hidden xl:inline-flex">
                  <DownloadIcon data-icon="inline-start" />Download
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Run files</DropdownMenuLabel>
                {[["REPORT.md", "Report"], ["results.csv", "Results table"], ["summary.json", "Summary"], ["SHA256SUMS.txt", "Checksums"]].map(([f, t]) => (
                  <DropdownMenuItem key={f} asChild disabled={!run.has_summary}>
                    <a href={fileUrl(run.id, f)} download>{t}<span className="ml-auto font-mono text-xs text-muted-foreground">{f}</span></a>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <a href={archiveUrl(run.id)} download>All run files<span className="ml-auto font-mono text-xs text-muted-foreground">.zip</span></a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <div className="flex items-center">
            <Button size="sm" onClick={onLaunch} disabled={busy} className="rounded-r-none">
              {busy ? <LoaderCircleIcon className="animate-spin" data-icon="inline-start" /> : <PlayIcon data-icon="inline-start" />}
              <span className="hidden sm:inline">Run fixture suite</span>
              <span className="sm:hidden">Run</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" disabled={busy} className="rounded-l-none border-l border-primary-foreground/25 px-1.5" aria-label="Run options">
                  <ChevronDownIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel>Repeats per run</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={String(repeat)} onValueChange={(v) => onRepeat(Number(v))}>
                  {Array.from({ length: maxRepeat }, (_, i) => (
                    <DropdownMenuRadioItem key={i} value={String(i + 1)}>
                      {i + 1} × {perRepeat} trials
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </header>
  )
}
