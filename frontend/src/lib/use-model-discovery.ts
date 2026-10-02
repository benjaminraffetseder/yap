import { useCallback, useEffect, useRef, useState } from "react"
import { backend, message } from "@/lib/backend"

type Discovery = { endpoint: string; phase: "idle" | "checking" | "ready" | "error"; models: string[]; error: string }
const initial = (endpoint: string): Discovery => ({ endpoint, phase: "idle", models: [], error: "" })

export function useModelDiscovery(endpoint: string, enabled: boolean) {
  const [state, setState] = useState<Discovery>(() => initial(endpoint))
  const current = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancel = useCallback(() => {
    const id = current.current
    current.current = null
    if (id) void backend.cancelTextProcessing(id).catch(() => {})
  }, [])
  const refresh = useCallback(async () => {
    if (!enabled) return
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    cancel()
    const id = crypto.randomUUID()
    current.current = id
    setState(old => ({ ...initial(endpoint), phase: "checking", models: old.endpoint === endpoint ? old.models : [] }))
    try {
      const models = await backend.listTextModels(id, endpoint)
      if (current.current === id) setState({ endpoint, phase: "ready", models, error: "" })
    } catch (cause) {
      if (current.current === id) setState({ ...initial(endpoint), phase: "error", error: message(cause) })
    } finally { if (current.current === id) current.current = null }
  }, [endpoint, enabled, cancel])
  useEffect(() => {
    setState(initial(endpoint))
    // Let URL edits settle before checking metadata; never submit a transcript.
    if (enabled) timer.current = setTimeout(() => { void refresh() }, 500)
    return () => { if (timer.current) clearTimeout(timer.current); timer.current = null; cancel() }
  }, [endpoint, enabled, refresh, cancel])
  return { ...(state.endpoint === endpoint ? state : initial(endpoint)), refresh }
}
