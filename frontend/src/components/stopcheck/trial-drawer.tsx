import * as React from "react"
import { CircleAlertIcon, CircleCheckIcon, CircleXIcon, DownloadIcon, InfoIcon, LoaderCircleIcon, RefreshCwIcon } from "lucide-react"

import { FixtureBadge, VerdictBadge } from "@/components/stopcheck/verdict-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useIsMobile } from "@/hooks/use-mobile"
import { api, logUrl, type RescoreResult, type TrialDetail, type TrialRow } from "@/lib/api"
import { describe, label, stopDelivery, type EventKind } from "@/lib/labels"
import { cn } from "@/lib/utils"

const DOT: Record<EventKind, string> = {
  setup: "bg-muted text-muted-foreground",
  stop: "bg-navy text-white",
  cancel: "bg-background text-muted-foreground ring-1 ring-border",
  attempt: "bg-background text-foreground ring-1 ring-input",
  "accept-pre": "bg-muted-foreground text-white",
  "accept-post": "bg-destructive text-white ring-4 ring-destructive/15",
  block: "bg-primary text-primary-foreground ring-4 ring-primary/15",
  error: "bg-amber-500 text-white",
}
const TAG: Record<EventKind, string> = {
  setup: "bg-muted text-muted-foreground",
  stop: "bg-navy text-white",
  cancel: "bg-muted text-foreground",
  attempt: "bg-muted text-foreground",
  "accept-pre": "bg-muted text-foreground",
  "accept-post": "bg-destructive text-white",
  block: "bg-primary text-primary-foreground",
  error: "bg-amber-100 text-amber-900",
}

function Outcome({ v }: { v: TrialRow }) {
  const box = (cls: string, icon: React.ReactNode, title: string, text: string) => (
    <div className={cn("flex gap-3 rounded-lg border p-3 text-sm", cls)}>
      <span className="mt-0.5 [&_svg]:size-4">{icon}</span>
      <div><p className="font-medium">{title}</p><p className="opacity-90">{text}</p></div>
    </div>
  )
  const n = v.post_stop_commits ?? 0
  if (v.safety === "fail") return box("border-destructive/30 bg-destructive/5 text-destructive", <CircleXIcon />,
    "A protected action was accepted after the stop", `${n} post-stop commit${n === 1 ? "" : "s"}${v.false_stopped_ui ? ", after the UI already showed “stopped”" : ""}.`)
  if (v.safety === "pass") return box("border-primary/30 bg-accent text-accent-foreground", <CircleCheckIcon />,
    "Nothing was accepted after the stop", v.gate_blocks ? `The authority gate rejected ${v.gate_blocks} late attempt${v.gate_blocks === 1 ? "" : "s"}.` : "No late commit reached the sink.")
  if (v.safety === "not_challenged") return box("bg-muted/50 text-muted-foreground", <InfoIcon />,
    "Benign control: no stop issued", v.benign_task_completed ? "The task completed with exactly one accepted effect." : "The task did not complete.")
  return box("border-amber-300 bg-amber-50 text-amber-900", <CircleAlertIcon />, "Invalid trial", v.errors?.join("; ") || "The scorer rejected this evidence.")
}

const yesNo = (v: boolean | null | undefined) => (v === true ? "Yes" : v === false ? "No" : "n/a")

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="flex flex-col gap-2"><h3 className="text-sm font-semibold">{title}</h3>{children}</section>
}

export function TrialDrawer({ runId, trial, onClose }: { runId: string | null; trial: string | null; onClose: () => void }) {
  const isMobile = useIsMobile()
  const [data, setData] = React.useState<TrialDetail | null>(null)
  const [raw, setRaw] = React.useState<string>("")
  const [error, setError] = React.useState<string | null>(null)
  const [rescore, setRescore] = React.useState<{ busy: boolean; result?: RescoreResult; error?: string }>({ busy: false })

  React.useEffect(() => {
    if (!runId || !trial) return
    let live = true
    setData(null)
    setError(null)
    setRescore({ busy: false })
    Promise.all([api.trial(runId, trial), api.rawLog(runId, trial)])
      .then(([d, r]) => { if (live) { setData(d); setRaw(r) } })
      .catch((e: Error) => live && setError(e.message))
    return () => { live = false }
  }, [runId, trial])

  const doRescore = async () => {
    if (!runId || !trial) return
    setRescore({ busy: true })
    try {
      setRescore({ busy: false, result: await api.rescore(runId, trial) })
    } catch (e) {
      setRescore({ busy: false, error: (e as Error).message })
    }
  }

  const v = data?.verdict
  const events = data?.events ?? []
  const fence = events.find((e) => e.event === "stop_fence")?.seq ?? null
  const pre = events.filter((e) => e.event === "action_committed" && fence !== null && e.seq < fence)

  return (
    <Drawer open={!!trial} onOpenChange={(o) => !o && onClose()} direction={isMobile ? "bottom" : "right"}>
      <DrawerContent className="outline-none data-[vaul-drawer-direction=right]:sm:max-w-xl data-[vaul-drawer-direction=bottom]:max-h-[92vh]">
        <DrawerHeader className="gap-1 border-b">
          <DrawerTitle className="flex flex-wrap items-center gap-2 text-lg">
            {v ? label("scenario", v.scenario) : "Loading trial…"}
            {v && <VerdictBadge row={v} />}
          </DrawerTitle>
          <DrawerDescription className="font-mono text-xs break-all">{trial}</DrawerDescription>
        </DrawerHeader>

        <div className="flex flex-col gap-6 overflow-y-auto px-4 py-4 text-sm">
          {error && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-destructive">Could not load this trial: {error}</div>}
          {!data && !error && (
            <div className="flex flex-col gap-3" aria-busy="true">
              <Skeleton className="h-16" /><Skeleton className="h-40" /><Skeleton className="h-72" />
            </div>
          )}
          {v && data && (
            <>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="outline"><span className="text-muted-foreground">Channel</span>{label("channel", v.channel)}</Badge>
                <Badge variant="outline"><span className="text-muted-foreground">Policy</span>{label("policy", v.policy)}</Badge>
                <Badge variant="outline"><span className="text-muted-foreground">Control</span>{label("control", v.control)}</Badge>
                <FixtureBadge />
              </div>
              <Outcome v={v} />

              <Section title="Counters">
                <dl className="grid grid-cols-2 overflow-hidden rounded-lg border sm:grid-cols-3 [&>div]:-mt-px [&>div]:-ml-px [&>div]:border-t [&>div]:border-l [&>div]:p-3">
                  {([
                    ["Post-stop commits", v.post_stop_commits ?? "—", (v.post_stop_commits ?? 0) > 0],
                    ["Post-stop attempts", v.post_stop_worker_attempts ?? "—", false],
                    ["Gate rejections", v.gate_blocks ?? "—", false],
                    ["Accepted before stop", v.pre_stop_commits ?? "—", false],
                    ["Settled late (pre-stop)", v.pre_stop_effects_settled_late ?? "—", false],
                    ["Cancelled workers", v.cancelled_workers ?? "—", false],
                    ["UI said stopped, then commit", yesNo(v.false_stopped_ui), v.false_stopped_ui === true],
                    ["Scripted continuation", yesNo(v.scripted_continuation), false],
                    ["Events in log", v.event_count ?? events.length, false],
                  ] as const).map(([name, value, hot]) => (
                    <div key={name} className={cn(hot && "bg-destructive/5")}>
                      <dt className="text-xs text-muted-foreground">{name}</dt>
                      <dd className={cn("mt-0.5 text-lg font-semibold tabular-nums", hot && "text-destructive")}>{value}</dd>
                    </div>
                  ))}
                </dl>
              </Section>

              <Section title="Stop delivery">
                <p className="rounded-lg border p-3 text-muted-foreground">{stopDelivery(events, v)}</p>
              </Section>

              <Section title="Accepted before the stop">
                <div className="rounded-lg border p-3 text-muted-foreground">
                  {pre.length ? (
                    <>
                      <p>Accepted before the trusted stop fence, so not counted as post-stop commits.</p>
                      <ul className="mt-1 list-disc pl-5 font-mono text-xs">
                        {pre.map((e) => <li key={e.seq}>#{e.seq} {String(e.data.job_id)} accepted by {e.actor}</li>)}
                      </ul>
                    </>
                  ) : fence === null ? "Not applicable: this trial has no stop." : "None."}
                </div>
              </Section>

              <Section title="Event timeline">
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-hidden>
                  {([["bg-navy", "Stop delivery"], ["bg-background ring-1 ring-input", "Worker attempt"], ["bg-destructive", "Accepted after stop"],
                    ["bg-muted-foreground", "Accepted before stop"], ["bg-primary", "Gate rejected"]] as const).map(([c, t]) => (
                    <span key={t} className="inline-flex items-center gap-1.5"><span className={cn("size-2 rounded-full", c)} />{t}</span>
                  ))}
                </div>
                <ol className="mt-2 flex flex-col" aria-label="Event timeline in log order">
                  {events.map((e, i) => {
                    const d = describe(e, fence)
                    return (
                      <React.Fragment key={e.seq}>
                        {e.seq === fence && (
                          <li className="my-2 flex items-center gap-2" aria-label="Stop fence">
                            <span className="h-px flex-1 border-t border-dashed border-navy" />
                            <span className="rounded-full border border-navy px-2.5 py-0.5 text-[11px] font-semibold tracking-wide text-navy uppercase">Stop fence</span>
                            <span className="h-px flex-1 border-t border-dashed border-navy" />
                          </li>
                        )}
                        <li className="relative grid grid-cols-[1.75rem_1fr_auto] gap-3 pb-3">
                          {i < events.length - 1 && <span aria-hidden className="absolute top-7 bottom-0 left-[0.85rem] w-px bg-border" />}
                          <span aria-hidden className={cn("relative z-10 flex size-7 items-center justify-center rounded-full font-mono text-[10px]", DOT[d.kind])}>{e.seq}</span>
                          <div className="min-w-0 pt-1">
                            <p className={cn("leading-snug", d.kind === "accept-post" && "font-medium text-destructive", d.kind === "setup" && "text-muted-foreground")}>
                              <span className={cn("mr-1.5 rounded px-1.5 py-0.5 text-[11px] font-medium", TAG[d.kind])}>{d.tag}</span>
                              {d.text}
                            </p>
                            <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">#{e.seq} · {e.event} · {e.actor}</p>
                          </div>
                          <span className="hidden pt-1.5 font-mono text-[11px] text-muted-foreground sm:block">{e.utc?.slice(11, 23)}</span>
                        </li>
                      </React.Fragment>
                    )
                  })}
                </ol>
              </Section>

              {data.sqlite && (
                <details className="group rounded-lg border">
                  <summary className="cursor-pointer px-3 py-2.5 font-medium">SQLite ledger evidence</summary>
                  <div className="flex flex-col gap-3 border-t p-3">
                    {(["authority", "jobs", "effects"] as const).map((t) => {
                      const rows = data.sqlite![t]
                      const cols = rows.length ? Object.keys(rows[0]) : []
                      return (
                        <div key={t} className="flex flex-col gap-1.5">
                          <p className="text-xs font-medium text-muted-foreground">{t} · {rows.length} row{rows.length === 1 ? "" : "s"}</p>
                          {rows.length ? (
                            <div className="overflow-hidden rounded-md border">
                              <Table>
                                <TableHeader className="bg-muted"><TableRow>{cols.map((c) => <TableHead key={c} className="h-8 text-xs">{c}</TableHead>)}</TableRow></TableHeader>
                                <TableBody>
                                  {rows.map((r, j) => <TableRow key={j}>{cols.map((c) => <TableCell key={c} className="py-1.5 font-mono text-xs">{String(r[c] ?? "null")}</TableCell>)}</TableRow>)}
                                </TableBody>
                              </Table>
                            </div>
                          ) : <p className="text-xs text-muted-foreground">No rows.</p>}
                        </div>
                      )
                    })}
                  </div>
                </details>
              )}

              <details className="rounded-lg border">
                <summary className="cursor-pointer px-3 py-2.5 font-medium">Raw log · events.jsonl · {events.length} lines</summary>
                <pre tabIndex={0} className="max-h-96 overflow-auto border-t bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">{raw}</pre>
              </details>

              {(rescore.result || rescore.error) && (
                <div role="status" className={cn("rounded-lg border p-3",
                  rescore.error || rescore.result?.matches_saved === false ? "border-destructive/30 bg-destructive/5 text-destructive" : "border-primary/30 bg-accent text-accent-foreground")}>
                  {rescore.error ? `Rescore failed: ${rescore.error}` : rescore.result!.matches_saved === false ? (
                    <>
                      <p>Rescored as {label("safety", rescore.result!.rescored.safety)}, which differs from the saved verdict:</p>
                      <ul className="mt-1 list-disc pl-5 font-mono text-xs">
                        {rescore.result!.differences.map((d) => <li key={d.field}>{d.field}: saved {JSON.stringify(d.saved)}, rescored {JSON.stringify(d.rescored)}</li>)}
                      </ul>
                    </>
                  ) : rescore.result!.matches_saved === true
                    ? `Rescored from the saved log with stopcheck.scoring: ${label("safety", rescore.result!.rescored.safety)}, ${rescore.result!.rescored.post_stop_commits ?? 0} post-stop commit${(rescore.result!.rescored.post_stop_commits ?? 0) === 1 ? "" : "s"}. Matches the saved verdict in every field.`
                    : `Rescored: ${label("safety", rescore.result!.rescored.safety)}. This run has no saved summary to compare against.`}
                </div>
              )}
            </>
          )}
        </div>
        <Separator />
        <DrawerFooter className="flex-row flex-wrap">
          <Button onClick={doRescore} disabled={!data || rescore.busy}>
            {rescore.busy ? <LoaderCircleIcon className="animate-spin" data-icon="inline-start" /> : <RefreshCwIcon data-icon="inline-start" />}
            Rescore trace
          </Button>
          <Button variant="outline" asChild disabled={!runId || !trial}>
            <a href={runId && trial ? logUrl(runId, trial) : "#"} download><DownloadIcon data-icon="inline-start" />Download log</a>
          </Button>
          <DrawerClose asChild><Button variant="ghost" className="ml-auto">Close</Button></DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
