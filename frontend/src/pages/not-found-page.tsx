import { Link } from "react-router"
import { Button } from "@/components/ui/button"

export function NotFoundPage() {
  return (
    <div className="space-y-4 py-16">
      <p className="text-sm text-muted-foreground">404</p>
      <h1 className="text-3xl font-semibold tracking-tight">Page not found</h1>
      <p className="text-sm text-muted-foreground">There isn’t a screen at this address yet.</p>
      <Button asChild><Link to="/">Back to dictation</Link></Button>
    </div>
  )
}
