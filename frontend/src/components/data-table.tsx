import * as React from "react"
import {
  columnVisibilityFeature,
  createColumnHelper,
  createPaginatedRowModel,
  createSortedRowModel,
  FlexRender,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type SortingState,
} from "@tanstack/react-table"
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  SearchIcon,
  XIcon,
} from "lucide-react"

import { VerdictBadge } from "@/components/stopcheck/verdict-badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { TrialRow } from "@/lib/api"
import { label, ORDER } from "@/lib/labels"
import { cn } from "@/lib/utils"

const features = tableFeatures({
  columnVisibilityFeature,
  rowPaginationFeature,
  rowSortingFeature,
  paginatedRowModel: createPaginatedRowModel(),
  sortedRowModel: createSortedRowModel(),
})

const columnHelper = createColumnHelper<typeof features, TrialRow>()

const FILTERS = [
  { key: "channel", text: "Stop channel" },
  { key: "policy", text: "Scripted policy" },
  { key: "control", text: "Control" },
  { key: "scenario", text: "Scenario" },
] as const

type FilterKey = (typeof FILTERS)[number]["key"]
const VERDICT_TABS = ["all", "fail", "pass", "not_challenged", "invalid"] as const

function SortHeader({ title, column, align }: { title: string; column: { getIsSorted: () => false | "asc" | "desc"; toggleSorting: (desc?: boolean) => void }; align?: "right" }) {
  const sorted = column.getIsSorted()
  const Icon = sorted === "asc" ? ArrowUpIcon : sorted === "desc" ? ArrowDownIcon : ArrowUpDownIcon
  return (
    <Button variant="ghost" size="sm" className={cn("-mx-2 h-7 font-medium", align === "right" && "ml-auto flex")}
      onClick={() => column.toggleSorting(sorted === "asc")}>
      {title}<Icon className="text-muted-foreground" data-icon="inline-end" />
    </Button>
  )
}

export function DataTable({ data, loading, onOpen, selected }: {
  data: TrialRow[] | null
  loading: boolean
  onOpen: (trial: string) => void
  selected: string | null
}) {
  const [query, setQuery] = React.useState("")
  const [verdict, setVerdict] = React.useState<string>("all")
  const [filters, setFilters] = React.useState<Record<FilterKey, string>>({ channel: "all", policy: "all", control: "all", scenario: "all" })
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [pagination, setPagination] = React.useState({ pageIndex: 0, pageSize: 20 })

  const rows = data ?? []
  const options = React.useMemo(() => Object.fromEntries(FILTERS.map(({ key }) => {
    const values = [...new Set(rows.map((r) => r[key]).filter(Boolean) as string[])]
    values.sort((a, b) => ORDER(key).indexOf(a) - ORDER(key).indexOf(b))
    return [key, values]
  })) as Record<FilterKey, string[]>, [rows])

  const counts = React.useMemo(() => Object.fromEntries(VERDICT_TABS.map((v) =>
    [v, v === "all" ? rows.length : rows.filter((r) => r.safety === v).length])), [rows])

  const filtered = React.useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return rows.filter((r) => {
      if (verdict !== "all" && r.safety !== verdict) return false
      if (FILTERS.some(({ key }) => filters[key] !== "all" && r[key] !== filters[key])) return false
      if (!words.length) return true
      const hay = [r.trial, ...FILTERS.flatMap(({ key }) => [r[key], label(key, r[key])]), label("safety", r.safety)].join(" ").toLowerCase()
      return words.every((w) => hay.includes(w))
    })
  }, [rows, query, verdict, filters])

  React.useEffect(() => setPagination((p) => ({ ...p, pageIndex: 0 })), [query, verdict, filters, data])

  const columns = React.useMemo(() => columnHelper.columns([
    columnHelper.accessor("safety", {
      header: ({ column }) => <SortHeader title="Verdict" column={column} />,
      cell: ({ row }) => <VerdictBadge row={row.original} />,
    }),
    columnHelper.accessor("trial", {
      header: ({ column }) => <SortHeader title="Trial" column={column} />,
      cell: ({ row }) => (
        <div className="flex min-w-0 flex-col">
          <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(row.original.trial) }}
            className="w-fit text-left font-medium text-foreground hover:text-primary hover:underline focus-visible:underline focus-visible:outline-none">
            {label("scenario", row.original.scenario)}
          </button>
          <span className="max-w-[18rem] truncate font-mono text-xs text-muted-foreground" title={row.original.trial}>{row.original.trial}</span>
        </div>
      ),
    }),
    columnHelper.accessor("channel", {
      header: ({ column }) => <SortHeader title="Stop channel" column={column} />,
      cell: ({ row }) => label("channel", row.original.channel),
    }),
    columnHelper.accessor("policy", {
      header: "Scripted policy",
      cell: ({ row }) => <span className={cn(row.original.policy === "not_delivered" && "text-muted-foreground")}>{label("policy", row.original.policy)}</span>,
    }),
    columnHelper.accessor("control", {
      header: ({ column }) => <SortHeader title="Control" column={column} />,
      cell: ({ row }) => label("control", row.original.control),
    }),
    columnHelper.accessor((r) => r.post_stop_commits ?? 0, {
      id: "post_stop_commits",
      header: ({ column }) => <SortHeader title="Post-stop" column={column} align="right" />,
      cell: ({ row }) => {
        const v = row.original.post_stop_commits ?? 0
        return <div className={cn("text-right font-mono tabular-nums", v > 0 ? "font-semibold text-destructive" : "text-muted-foreground/60")}>{v}</div>
      },
    }),
    columnHelper.accessor((r) => r.gate_blocks ?? 0, {
      id: "gate_blocks",
      header: ({ column }) => <SortHeader title="Gate blocks" column={column} align="right" />,
      cell: ({ row }) => {
        const v = row.original.gate_blocks ?? 0
        return <div className={cn("text-right font-mono tabular-nums", v > 0 ? "font-medium text-accent-foreground" : "text-muted-foreground/60")}>{v}</div>
      },
    }),
  ]), [onOpen])

  const table = useTable({
    features,
    data: filtered,
    columns,
    state: { sorting, pagination },
    getRowId: (row) => row.trial,
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
  })

  const active = query || verdict !== "all" || FILTERS.some(({ key }) => filters[key] !== "all")
  const clear = () => {
    setQuery("")
    setVerdict("all")
    setFilters({ channel: "all", policy: "all", control: "all", scenario: "all" })
  }

  return (
    <Tabs value={verdict} onValueChange={setVerdict} className="w-full flex-col justify-start gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 lg:px-6">
        <div>
          <h2 className="text-base font-semibold">Trials</h2>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {loading ? "Loading trials…" : filtered.length === rows.length ? `${rows.length} trials` : `Showing ${filtered.length} of ${rows.length} trials`}
          </p>
        </div>
        <Label htmlFor="verdict-selector" className="sr-only">Verdict</Label>
        <Select value={verdict} onValueChange={setVerdict}>
          <SelectTrigger className="flex w-fit @4xl/main:hidden" size="sm" id="verdict-selector">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {VERDICT_TABS.map((v) => <SelectItem key={v} value={v}>{v === "all" ? "All verdicts" : label("safety", v)} ({counts[v]})</SelectItem>)}
            </SelectGroup>
          </SelectContent>
        </Select>
        <TabsList className="hidden **:data-[slot=badge]:size-5 @4xl/main:flex" aria-label="Verdict">
          {VERDICT_TABS.map((v) => (
            <TabsTrigger key={v} value={v} disabled={!counts[v] && v !== "all"}>
              {v === "all" ? "All" : label("safety", v)}
              <span className={cn("ml-1 rounded-full px-1.5 text-xs tabular-nums",
                v === "fail" && counts[v] ? "bg-destructive/10 text-destructive" : "bg-muted-foreground/15 text-muted-foreground")}>
                {counts[v]}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      <div className="flex flex-wrap items-end gap-2 px-4 lg:px-6" role="search">
        <div className="relative min-w-52 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Label htmlFor="trial-search" className="sr-only">Search trials</Label>
          <Input id="trial-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search trials or IDs" className="h-8 pl-8" />
        </div>
        {FILTERS.map(({ key, text }) => (
          <div key={key} className="flex flex-col gap-1">
            <Label htmlFor={`filter-${key}`} className="text-xs text-muted-foreground">{text}</Label>
            <Select value={filters[key]} onValueChange={(v) => setFilters((f) => ({ ...f, [key]: v }))}>
              <SelectTrigger id={`filter-${key}`} size="sm" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {options[key].map((v) => (
                  <SelectItem key={v} value={v}>{label(key, v)} ({rows.filter((r) => r[key] === v).length})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
        <Button variant="ghost" size="sm" onClick={clear} disabled={!active}><XIcon data-icon="inline-start" />Clear</Button>
      </div>

      <div className="relative flex flex-col gap-4 overflow-auto px-4 lg:px-6">
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-muted">
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id} colSpan={header.colSpan}>
                      {header.isPlaceholder ? null : <FlexRender header={header} />}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {loading ? Array.from({ length: 8 }, (_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={columns.length}><Skeleton className="h-8 w-full" /></TableCell>
                </TableRow>
              )) : table.getRowModel().rows.length ? table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} data-state={row.original.trial === selected ? "selected" : undefined}
                  onClick={() => onOpen(row.original.trial)}
                  className={cn("cursor-pointer", row.original.safety === "fail" && "shadow-[inset_3px_0_0_var(--destructive)]")}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}><FlexRender cell={cell} /></TableCell>
                  ))}
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                    {rows.length ? "No trials match these filters." : "This run has no finished trials yet."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-between px-1">
          <div className="hidden flex-1 text-sm text-muted-foreground lg:flex">
            Rows are trials. Select one to open its event timeline and raw evidence.
          </div>
          <div className="flex w-full items-center gap-8 lg:w-fit">
            <div className="hidden items-center gap-2 lg:flex">
              <Label htmlFor="rows-per-page" className="text-sm font-medium">Rows per page</Label>
              <Select value={`${table.state.pagination.pageSize}`} onValueChange={(value) => table.setPageSize(Number(value))}>
                <SelectTrigger size="sm" className="w-20" id="rows-per-page">
                  <SelectValue placeholder={table.state.pagination.pageSize} />
                </SelectTrigger>
                <SelectContent side="top">
                  <SelectGroup>
                    {[10, 20, 54, 108].map((size) => <SelectItem key={size} value={`${size}`}>{size}</SelectItem>)}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="flex w-fit items-center justify-center text-sm font-medium">
              Page {table.state.pagination.pageIndex + 1} of {Math.max(table.getPageCount(), 1)}
            </div>
            <div className="ml-auto flex items-center gap-2 lg:ml-0">
              <Button variant="outline" className="hidden h-8 w-8 p-0 lg:flex" onClick={() => table.setPageIndex(0)} disabled={!table.getCanPreviousPage()}>
                <span className="sr-only">Go to first page</span><ChevronsLeftIcon />
              </Button>
              <Button variant="outline" className="size-8" size="icon" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
                <span className="sr-only">Go to previous page</span><ChevronLeftIcon />
              </Button>
              <Button variant="outline" className="size-8" size="icon" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
                <span className="sr-only">Go to next page</span><ChevronRightIcon />
              </Button>
              <Button variant="outline" className="hidden size-8 lg:flex" size="icon" onClick={() => table.setPageIndex(table.getPageCount() - 1)} disabled={!table.getCanNextPage()}>
                <span className="sr-only">Go to last page</span><ChevronsRightIcon />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Tabs>
  )
}
