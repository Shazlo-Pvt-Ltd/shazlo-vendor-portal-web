import type { ModuleIcon } from '@shazlo/shell-protocol'
import type { LucideIcon } from 'lucide-react'
import { Bell, Box, Building2, ChartBar, ClipboardCheck, FileText, Inbox, LayoutDashboard, Megaphone, Send, Settings, ShoppingBag, Store, Tag, Users } from 'lucide-react'

// The icons a module may name in its manifest or summary (MODULE_ICONS in shell-protocol). The
// record is complete by type, so a name added there fails the typecheck here until it is drawn.
export const moduleIcons: Record<ModuleIcon, LucideIcon> = {
  box: Box,
  store: Store,
  'layout-dashboard': LayoutDashboard,
  inbox: Inbox,
  'building-2': Building2,
  send: Send,
  users: Users,
  megaphone: Megaphone,
  'chart-bar': ChartBar,
  'file-text': FileText,
  'shopping-bag': ShoppingBag,
  tag: Tag,
  bell: Bell,
  settings: Settings,
  'clipboard-check': ClipboardCheck,
}

export const iconFor = (name: ModuleIcon | null | undefined): LucideIcon => (name ? moduleIcons[name] : Box)
