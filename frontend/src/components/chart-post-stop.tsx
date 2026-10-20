import * as React from "react"
import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts"

import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { ControlSummary } from "@/lib/api"
import { label, pct } from "@/lib/labels"

const chartConfig = {
  committed: { label: "Post-stop commit", color: "var(--chart-1)" },
  held: { label: "No post-stop commit", color: "var(--chart-2)" },
} satisfies ChartConfig

const CHANNELS = [
  { id: "all", text: "All channels" },
  { id: "hard_cancel/not_delivered", text: "App cancellation" },
  { id: "agent_message/comply", text: "Message · comply" },
  { id: "agent_message/continue", text: "Message · continue" },
]

export function ChartPostStop({ controls }: { controls: ControlSummary[] | null }) {
  const [channel, setChannel] = React.useState("all")

  const data = React.useMemo(() => (controls ?? []).map((c) => {
    let k = c.trials_with_post_stop_commit
    let n = c.valid_stopped_trials
    if (channel !== "all") {
      const [ch, po] = channel.split("/")
      const b = c.by_channel.find((x) => x.channel === ch && x.policy === po)
      k = b?.trials_with_post_stop_commit ?? 0
      n = b?.valid_stopped_trials ?? 0
    }
    return { control: label("control", c.control), id: c.control, committed: k, held: n - k, n, ratio: `${k} / ${n}` }
  }), [controls, channel])

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Post-stop commits by control</CardTitle>
        <CardDescription>
          <span className="hidden @[540px]/card:block">
            Stopped trials in which the sink accepted a protected action after the stop fence.
          </span>
          <span className="@[540px]/card:hidden">Stopped trials with a late commit</span>
        </CardDescription>
        <CardAction>
          <ToggleGroup type="single" value={channel} onValueChange={(v) => v && setChannel(v)} variant="outline"
            className="hidden *:data-[slot=toggle-group-item]:px-3! @[767px]/card:flex" aria-label="Stop channel">
            {CHANNELS.map((c) => <ToggleGroupItem key={c.id} value={c.id}>{c.text}</ToggleGroupItem>)}
          </ToggleGroup>
          <Select value={channel} onValueChange={setChannel}>
            <SelectTrigger size="sm" aria-label="Stop channel"
              className="flex w-44 **:data-[slot=select-value]:block **:data-[slot=select-value]:truncate @[767px]/card:hidden">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              {CHANNELS.map((c) => <SelectItem key={c.id} value={c.id} className="rounded-lg">{c.text}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>
      <CardContent className="px-2 pt-2 sm:px-6">
        {!controls ? <Skeleton className="h-[240px] w-full" /> : (
          <ChartContainer config={chartConfig} className="aspect-auto h-[240px] w-full">
            <BarChart accessibilityLayer data={data} layout="vertical" margin={{ left: 4, right: 64, top: 4 }} barSize={26}>
              <CartesianGrid horizontal={false} />
              <YAxis dataKey="control" type="category" tickLine={false} axisLine={false} width={108} tickMargin={8} />
              <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} domain={[0, "dataMax"]} />
              <ChartTooltip cursor={{ fill: "var(--muted)" }} content={
                <ChartTooltipContent indicator="dot" labelFormatter={(_, payload) => {
                  const d = payload?.[0]?.payload as { control: string; committed: number; n: number } | undefined
                  return d ? `${d.control} · ${d.committed} of ${d.n} stopped trials` : ""
                }} />
              } />
              <ChartLegend content={<ChartLegendContent />} />
              <Bar dataKey="committed" stackId="a" fill="var(--color-committed)" radius={[4, 0, 0, 4]} isAnimationActive={false} />
              <Bar dataKey="held" stackId="a" fill="var(--color-held)" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                <LabelList dataKey="ratio" position="right" offset={10} className="fill-foreground font-mono text-xs font-medium" />
              </Bar>
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
      {controls && (
        <CardFooter className="flex-col items-start gap-1 text-sm">
          <div className="flex flex-wrap gap-x-4 gap-y-1 font-medium">
            {data.map((d) => (
              <span key={d.id}>
                {d.control} <span className={d.committed ? "text-destructive" : "text-accent-foreground"}>{d.committed}/{d.n}</span>
                <span className="text-muted-foreground"> ({pct(d.committed, d.n)}%)</span>
              </span>
            ))}
          </div>
          <div className="text-muted-foreground">
            Denominator: valid stopped trials. Benign controls are excluded. The authority gate is a reference control.
          </div>
        </CardFooter>
      )}
    </Card>
  )
}
