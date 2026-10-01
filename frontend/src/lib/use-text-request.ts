import { useEffect, useRef, useState } from "react"
import { backend, message } from "@/lib/backend"

// Request identity protects a new preview against late replies/cancellation
// from an older one. All unmount paths cancel the native request.
export function useTextRequest() {
  const current = useRef<string | null>(null)
  const cancelled = useRef(false)
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState("")
  const [error, setError] = useState("")
  useEffect(() => () => {
    const id = current.current
    current.current = null
    if (id) void backend.cancelTextProcessing(id).catch(() => {})
  }, [])
  async function request(action: (id: string) => Promise<string>) {
    if (current.current) return
    const id = crypto.randomUUID()
    current.current = id
    cancelled.current = false
    setPending(true); setResult(""); setError("")
    try {
      const output = await action(id)
      if (current.current === id) { if (cancelled.current) setError("Processing cancelled"); else setResult(output) }
    } catch (cause) { if (current.current === id) setError(cancelled.current ? "Processing cancelled" : message(cause)) }
    finally { if (current.current === id) { current.current = null; setPending(false) } }
  }
  async function cancel() {
    const id = current.current
    if (!id) return
    cancelled.current = true
    // Keep ownership until the processing promise settles. This prevents a
    // retry from racing the server's cleanup. Hide any late successful reply.
    setError("Cancelling…")
    try { await backend.cancelTextProcessing(id) }
    catch (cause) { if (current.current === id) setError(message(cause)) }
  }
  return { pending, result, error, request, cancel, clear: () => { setResult(""); setError("") } }
}
