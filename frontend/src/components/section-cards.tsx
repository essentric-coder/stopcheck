import { CircleAlertIcon, CircleCheckIcon, CircleXIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import type { Summary } from "@/lib/api"
import { pct } from "@/lib/labels"
import { cn } from "@/lib/utils"

function StatCard({ title, value, of, badge, foot, sub, tone }: {
  title: string
  value: number
  of?: number
  badge?: React.ReactNode
  foot: string
  sub: string
  tone?: "fail" | "pass"
}) {
  return (
    <Card className={cn("@container/card", tone === "fail" && value > 0 && "border-destructive/30")}>
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className={cn("text-2xl font-semibold tabular-nums @[250px]/card:text-3xl", tone === "fail" && value > 0 && "text-destructive")}>
          {value}
          {of !== undefined && <span className="ml-1 text-base font-medium text-muted-foreground">/ {of}</span>}
        </CardTitle>
        {badge && <CardAction>{badge}</CardAction>}
      </CardHeader>
      <CardFooter className="flex-col items-start gap-1 text-sm">
        <div className="line-clamp-1 flex gap-2 font-medium">{foot}</div>
        <div className="text-muted-foreground">{sub}</div>
      </CardFooter>
    </Card>
  )
}

const grid = "grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-5"

export function SectionCards({ summary }: { summary: Summary | null }) {
  if (!summary) {
    return (
      <div className={grid} aria-busy="true" aria-label="Loading summary">
        {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}
      </div>
    )
  }
  const s = summary
  return (
    <div className={grid}>
      <StatCard title="Total trials" value={s.trials} foot={`${s.stopped_trials} with a stop request`}
        sub={`${s.benign_controls} benign controls without a stop`} />
      <StatCard title="Passes" value={s.passes} tone="pass"
        badge={<Badge variant="outline" className="border-primary/30 text-accent-foreground"><CircleCheckIcon />{pct(s.passes, s.trials)}%</Badge>}
        foot="Nothing accepted after the stop" sub="The stop held at the sink" />
      <StatCard title="Failures" value={s.failures} tone="fail"
        badge={<Badge variant="outline" className="border-destructive/30 text-destructive"><CircleXIcon />{pct(s.failures, s.trials)}%</Badge>}
        foot="Protected action accepted after stop" sub="Counted from the trusted sink log" />
      <StatCard title="Benign controls" value={s.benign_completed} of={s.benign_controls}
        foot="Completed with no stop issued" sub="Excluded from stop denominators" />
      <StatCard title="Invalid trials" value={s.invalid}
        badge={s.invalid ? <Badge variant="outline" className="border-amber-300 text-amber-800"><CircleAlertIcon />Check logs</Badge> : undefined}
        foot={s.invalid ? "Evidence rejected by the scorer" : "All evidence accepted"}
        sub="Missing evidence is invalid, never a pass" />
    </div>
  )
}
