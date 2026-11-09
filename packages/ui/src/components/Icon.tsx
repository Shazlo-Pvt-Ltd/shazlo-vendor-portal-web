import {
  Activity, ArrowLeft, ArrowRight, Ban, Bell, Calendar, Check, ChevronDown, ChevronLeft, ChevronRight, CircleAlert,
  CircleHelp, Clock, Copy, Diff, Download, Ellipsis, ExternalLink, Eye, File, FileSpreadsheet, Frame, Funnel, Globe,
  GripVertical, House, Image, IndianRupee, Info, Instagram, Layers, LayoutGrid, Link, List, Lock, LogOut, Mail, Menu,
  Monitor, Package, Pencil, Plus, RefreshCw, Search, Send, Shield, SlidersHorizontal, Smartphone, Store, Tag, Trash2,
  Upload, User, Users, X, type LucideIcon,
} from 'lucide-react'
import type { CSSProperties } from 'react'

// The 54 icons of the Penpot "Kit / Icons" board, drawn with Lucide (1.5 px stroke).
export const icons = {
  search: Search, home: House, grid: LayoutGrid, store: Store, package: Package, image: Image, upload: Upload,
  download: Download, file: File, sheet: FileSpreadsheet, check: Check, x: X, plus: Plus, alert: CircleAlert,
  info: Info, clock: Clock, chevronDown: ChevronDown, chevronRight: ChevronRight, chevronLeft: ChevronLeft,
  filter: Funnel, users: Users, user: User, sliders: SlidersHorizontal, logout: LogOut, eye: Eye, send: Send,
  refresh: RefreshCw, more: Ellipsis, bell: Bell, shield: Shield, list: List, external: ExternalLink, mail: Mail,
  lock: Lock, edit: Pencil, trash: Trash2, link: Link, instagram: Instagram, monitor: Monitor, phone: Smartphone,
  layers: Layers, activity: Activity, arrowRight: ArrowRight, arrowLeft: ArrowLeft, tag: Tag, diff: Diff,
  help: CircleHelp, grip: GripVertical, calendar: Calendar, rupee: IndianRupee, copy: Copy, globe: Globe, ban: Ban,
  frame: Frame, menu: Menu,
} satisfies Record<string, LucideIcon>

export type IconName = keyof typeof icons

export interface IconProps {
  name: IconName
  size?: number
  strokeWidth?: number
  color?: string
  style?: CSSProperties
  className?: string
  /** Accessible name. Icons are decorative unless a label is given. */
  label?: string
}

export function Icon({ name, size = 16, strokeWidth = 1.5, color = 'currentColor', style, className, label }: IconProps) {
  const Glyph = icons[name]
  return (
    <Glyph
      size={size}
      strokeWidth={strokeWidth}
      color={color}
      style={{ flexShrink: 0, ...style }}
      className={className}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      focusable="false"
    />
  )
}
