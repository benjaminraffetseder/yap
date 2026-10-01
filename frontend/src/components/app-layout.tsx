import { useState, type CSSProperties } from "react"
import { AudioLines, BookOpen, HardDriveDownload, History, Mic, PanelLeftClose, PanelLeftOpen, Settings2, Sparkles, X } from "lucide-react"
import { NavLink, Outlet } from "react-router"
import { cn } from "@/lib/utils"
import { isDesktop } from "@/lib/backend"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useDictation } from "@/components/dictation-provider"
import { RecordingStatus } from "@/components/recording-status"

const navigation = [
  { to: "/", label: "Dictate", icon: Mic },
  { to: "/history", label: "History", icon: History },
  { to: "/models", label: "Models", icon: HardDriveDownload },
  { to: "/vocabulary", label: "Vocabulary", icon: BookOpen },
  { to: "/prompts", label: "Prompts", icon: Sparkles },
  { to: "/settings", label: "Settings", icon: Settings2 },
]
const sidebarKey = "yap-sidebar-collapsed"

function readCollapsed() {
  try { return localStorage.getItem(sidebarKey) === "true" }
  catch { return false }
}

export function AppLayout() {
  const { error, clearError } = useDictation()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const toggleLabel = collapsed ? "Expand sidebar" : "Collapse sidebar"

  function toggleSidebar() {
    const next = !collapsed
    setCollapsed(next)
    try { localStorage.setItem(sidebarKey, String(next)) } catch { /* Use the current session preference. */ }
  }

  return (
    <TooltipProvider delay={250}>
      <div className="flex min-h-screen" style={{ "--sidebar-width": collapsed ? "4.5rem" : "13.75rem" } as CSSProperties}>
        <aside id="app-sidebar" className="sticky top-0 flex h-screen w-[var(--sidebar-width)] shrink-0 flex-col border-r bg-sidebar px-3 py-4 transition-[width] duration-200 ease-out motion-reduce:transition-none">
          <div className="mb-6 flex h-11 items-center justify-between">
            {!collapsed && <NavLink to="/" className="flex items-center gap-2.5 pl-3" aria-label="Yap home">
              <AudioLines className="size-5 text-primary" aria-hidden="true" />
              <span className="text-xl font-semibold tracking-tight">yap.</span>
            </NavLink>}
            <Tooltip>
              <TooltipTrigger render={<Button variant="ghost" size="icon" className="size-11 shrink-0 rounded-lg" />} onClick={toggleSidebar} aria-label={toggleLabel} aria-expanded={!collapsed} aria-controls="app-sidebar">
                {collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
              </TooltipTrigger>
              <TooltipContent side="right">{toggleLabel}</TooltipContent>
            </Tooltip>
          </div>
          <nav aria-label="Main navigation" className="flex flex-1 flex-col gap-1">
            {navigation.map(({ to, label, icon: Icon }) => (
              <Tooltip key={`${to}-${collapsed}`} disabled={!collapsed}>
                <TooltipTrigger render={<NavLink to={to} end />} className={cn(
                    "flex h-11 shrink-0 items-center gap-3 rounded-lg px-3 text-sm text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-primary/10 aria-[current=page]:font-medium aria-[current=page]:text-primary",
                    to === "/settings" && "mt-auto",
                  )}>
                    <Icon className="size-5 shrink-0" aria-hidden="true" />
                    <span className={collapsed ? "sr-only" : "truncate"}>{label}</span>
                </TooltipTrigger>
                <TooltipContent side="right">{label}</TooltipContent>
              </Tooltip>
            ))}
          </nav>
        </aside>
        <main id="main-content" className="min-w-0 flex-1">
          <div className="mx-auto max-w-5xl px-6 py-8 lg:px-10">
            {!isDesktop && <div className="mb-6 rounded-lg border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">Browser preview. Native features require the desktop app.</div>}
            {error && <div role="alert" className="mb-6 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              <span className="flex-1 whitespace-pre-wrap">{error}</span>
              <Button variant="ghost" size="icon-sm" onClick={clearError} aria-label="Dismiss error"><X aria-hidden="true" /></Button>
            </div>}
            <Outlet />
          </div>
        </main>
        <RecordingStatus />
      </div>
    </TooltipProvider>
  )
}
