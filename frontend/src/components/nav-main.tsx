import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import type { View } from "@/components/app-sidebar"

export function NavMain({ items, active, onSelect }: {
  items: { id: View; title: string; icon?: React.ReactNode; badge?: number }[]
  active: View
  onSelect: (v: View) => void
}) {
  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-2">
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.id}>
              <SidebarMenuButton tooltip={item.title} isActive={active === item.id} onClick={() => onSelect(item.id)}>
                {item.icon}
                <span>{item.title}</span>
              </SidebarMenuButton>
              {item.badge !== undefined && <SidebarMenuBadge>{item.badge}</SidebarMenuBadge>}
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
