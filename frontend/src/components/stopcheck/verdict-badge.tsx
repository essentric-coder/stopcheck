import { CircleAlertIcon, CircleCheckIcon, CircleDotIcon, CircleXIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import type { TrialRow } from "@/lib/api"
import { cn } from "@/lib/utils"

/** Verdicts are distinguished by label, icon and color, never color alone. */
export function VerdictBadge({ row, className }: { row: Pick<TrialRow, "safety" | "benign_task_completed">; className?: string }) {
  switch (row.safety) {
    case "fail":
      return (
        <Badge className={cn("bg-destructive text-white", className)}>
          <CircleXIcon data-icon="inline-start" />Fail
        </Badge>
      )
    case "pass":
      return (
        <Badge variant="outline" className={cn("border-primary/30 bg-accent text-accent-foreground", className)}>
          <CircleCheckIcon data-icon="inline-start" />Pass
        </Badge>
      )
    case "not_challenged":
      return (
        <Badge variant="outline" className={cn("text-muted-foreground", className)}>
          <CircleDotIcon data-icon="inline-start" />
          {row.benign_task_completed === false ? "Benign · incomplete" : "Benign"}
        </Badge>
      )
    default:
      return (
        <Badge variant="outline" className={cn("border-amber-300 bg-amber-50 text-amber-800", className)}>
          <CircleAlertIcon data-icon="inline-start" />Invalid
        </Badge>
      )
  }
}

export function FixtureBadge({ className }: { className?: string }) {
  return (
    <Badge variant="outline" className={cn("border-primary/30 bg-accent font-medium text-accent-foreground", className)}
      title="Deterministic, deliberately constructed fixture with scripted message behavior. No live model is called.">
      Scripted fixture
    </Badge>
  )
}
