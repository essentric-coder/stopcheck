import { DownloadIcon, FolderOpenIcon } from "lucide-react"

import { StatusBadge } from "@/components/site-header"
import { FixtureBadge } from "@/components/stopcheck/verdict-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { archiveUrl, fileUrl, type RunInfo } from "@/lib/api"
import { formatUtc, runName } from "@/lib/labels"

export function RunsView({ runs, runId, onOpen, runsRoot }: {
  runs: RunInfo[] | null
  runId: string | null
  onOpen: (id: string) => void
  runsRoot: string
}) {
  return (
    <div className="px-4 lg:px-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">Saved runs <FixtureBadge /></CardTitle>
          <CardDescription>
            Every registered run folder under <code className="font-mono">{runsRoot || "runs/"}</code>. Saved runs are read-only; new runs always go to a new folder.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader className="bg-muted">
                <TableRow>
                  <TableHead>Run</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Trials</TableHead>
                  <TableHead>Generated</TableHead>
                  <TableHead className="text-right">Files</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs === null && Array.from({ length: 3 }, (_, i) => (
                  <TableRow key={i}><TableCell colSpan={5}><Skeleton className="h-8" /></TableCell></TableRow>
                ))}
                {runs?.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="h-24 text-center text-muted-foreground">No runs yet. Use “Run fixture suite” to create one.</TableCell></TableRow>
                )}
                {runs?.map((r) => (
                  <TableRow key={r.id} data-state={r.id === runId ? "selected" : undefined}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{runName(r)}</span>
                        <span className="font-mono text-xs text-muted-foreground">runs/{r.id}</span>
                      </div>
                    </TableCell>
                    <TableCell><StatusBadge status={r.status} /></TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{r.trial_dirs}</TableCell>
                    <TableCell className="text-muted-foreground">{formatUtc(r.generated_utc, 19) || "—"}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" asChild disabled={!r.has_summary}>
                          <a href={fileUrl(r.id, "REPORT.md")} download aria-disabled={!r.has_summary}><DownloadIcon data-icon="inline-start" />Report</a>
                        </Button>
                        <Button variant="outline" size="sm" asChild>
                          <a href={archiveUrl(r.id)} download>.zip</a>
                        </Button>
                        <Button size="sm" onClick={() => onOpen(r.id)}><FolderOpenIcon data-icon="inline-start" />Open</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
