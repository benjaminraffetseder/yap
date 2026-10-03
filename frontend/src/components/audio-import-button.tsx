import { useState } from "react"
import { Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useDictation } from "@/components/dictation-provider"
import { backend, isBusy, isDesktop } from "@/lib/backend"

export function AudioImportButton() {
  const { snapshot, loading, run } = useDictation()
  const [pending, setPending] = useState(false)
  async function importAudio() {
    setPending(true)
    try { await run(backend.importAudio) } finally { setPending(false) }
  }
  return <Button variant="outline" title="WAV, MP3, M4A, AAC, FLAC, OGG, Opus, AIFF, WMA · up to 10 minutes · 256 MiB" disabled={!isDesktop || loading || !snapshot.ready || isBusy(snapshot.status.phase) || pending} onClick={() => void importAudio()}><Upload className="size-4" />Import audio</Button>
}
