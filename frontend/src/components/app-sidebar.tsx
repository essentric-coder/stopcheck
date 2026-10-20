import * as React from "react"
import { FlaskConicalIcon, LayoutDashboardIcon, ListIcon } from "lucide-react"

import { NavMain } from "@/components/nav-main"
import { FixtureBadge } from "@/components/stopcheck/verdict-badge"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
} from "@/components/ui/sidebar"
import type { RunInfo } from "@/lib/api"
import { formatUtc, runName } from "@/lib/labels"
import { cn } from "@/lib/utils"

export type View = "overview" | "runs"

function StatusDot({ status }: { status: RunInfo["status"] }) {
  return (
    <span aria-hidden className={cn("size-2 shrink-0 rounded-full",
      status === "complete" && "bg-primary",
      status === "running" && "animate-pulse bg-primary",
      (status === "failed" || status === "incomplete" || status === "unreadable") && "bg-amber-500")} />
  )
}

export function AppSidebar({ view, onView, runs, runId, onRun, ...props }: React.ComponentProps<typeof Sidebar> & {
  view: View
  onView: (v: View) => void
  runs: RunInfo[] | null
  runId: string | null
  onRun: (id: string) => void
}) {
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild className="data-[slot=sidebar-menu-button]:p-1.5!">
              <a href="#" onClick={(e) => { e.preventDefault(); onView("overview") }}>
                <span className="flex size-6 items-center justify-center rounded-md bg-navy text-white">
                  <FlaskConicalIcon className="size-3.5!" />
                </span>
                <span className="text-base font-semibold">StopCheck</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain
          active={view}
          onSelect={onView}
          items={[
            { id: "overview", title: "Overview", icon: <LayoutDashboardIcon /> },
            { id: "runs", title: "Runs", icon: <ListIcon />, badge: runs?.length },
          ]}
        />
        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel>Recent runs</SidebarGroupLabel>
          <SidebarMenu>
            {runs === null && Array.from({ length: 3 }, (_, i) => (
              <SidebarMenuItem key={i}><SidebarMenuSkeleton showIcon /></SidebarMenuItem>
            ))}
            {runs?.slice(0, 8).map((r) => (
              <SidebarMenuItem key={r.id}>
                <SidebarMenuButton isActive={r.id === runId} onClick={() => onRun(r.id)} tooltip={r.id}
                  className="h-auto py-1.5">
                  <StatusDot status={r.status} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{runName(r)}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {r.status === "running" ? "Running…" : r.bundled ? "runs/pilot" : formatUtc(r.generated_utc) || r.status}
                    </span>
                  </span>
                </SidebarMenuButton>
                <SidebarMenuBadge className="font-mono text-muted-foreground">{r.trial_dirs}</SidebarMenuBadge>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className="flex flex-col gap-2 rounded-lg border bg-background p-3 text-xs text-muted-foreground">
          <FixtureBadge className="w-fit" />
          <p>Constructed fixtures with scripted message behavior. They validate the runner and scorer, not deployed-agent failure rates.</p>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
