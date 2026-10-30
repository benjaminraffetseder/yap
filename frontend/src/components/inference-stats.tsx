import { useDictation } from "@/components/dictation-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { GeneratedOutput, Session, TextStats } from "@/lib/backend";
import { ChartNoAxesColumn } from "lucide-react";
import type { ReactNode } from "react";

const available = (value: number | null | undefined) =>
  value != null && Number.isFinite(value) && value >= 0;
const count = (value: number | null | undefined) =>
  available(value) ? value!.toLocaleString() : "Unavailable";
const elapsed = (ms: number | null | undefined) =>
  !available(ms)
    ? "Unavailable"
    : ms! < 1000
      ? `${ms!.toLocaleString(undefined, { maximumFractionDigits: 1 })} ms`
      : `${(ms! / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} s`;
const rate = (value: number | null | undefined) =>
  available(value)
    ? `${value!.toLocaleString(undefined, { maximumFractionDigits: 1 })} tokens/s`
    : "Unavailable";

function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words font-medium text-foreground [overflow-wrap:anywhere]">
        {children}
      </dd>
    </div>
  );
}

function TextMetrics({ stats }: { stats: TextStats }) {
  const responseRate =
    available(stats.outputTokens) && stats.responseMs > 0
      ? (stats.outputTokens! * 1000) / stats.responseMs
      : undefined;
  return (
    <>
      <dl className="grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3">
        <Metric label="Text model">{stats.model}</Metric>
        <Metric label="LLM time">{elapsed(stats.durationMs)}</Metric>
        <Metric label="Response rate">{rate(responseRate)}</Metric>
        {available(stats.generationTokensPerSecond) && (
          <Metric label="Generation speed">{rate(stats.generationTokensPerSecond)}</Metric>
        )}
        <Metric label="Input tokens">{count(stats.inputTokens)}</Metric>
        <Metric label="Output tokens">{count(stats.outputTokens)}</Metric>
        <Metric label="Total tokens">{count(stats.totalTokens)}</Metric>
        {available(stats.cachedInputTokens) && (
          <Metric label="Cached input tokens">{count(stats.cachedInputTokens)}</Metric>
        )}
        {available(stats.reasoningTokens) && (
          <Metric label="Reasoning tokens">{count(stats.reasoningTokens)}</Metric>
        )}
        <Metric label="Requests">{count(stats.attempts)}</Metric>
        {stats.finishReason && <Metric label="Finish reason">{stats.finishReason}</Metric>}
      </dl>
      <p className="mt-3 text-muted-foreground">
        Response rate is output tokens divided by the full request time, including prompt processing
        and model loading. Generation speed, when available, is reported by the server.
        {stats.attempts > 1 &&
          " LLM time includes retries; token counts and rates describe the final response."}
      </p>
    </>
  );
}

export function InferenceStats({
  session,
  outputs = [],
  output,
}: {
  session?: Session;
  outputs?: GeneratedOutput[];
  output?: GeneratedOutput;
}) {
  const { snapshot } = useDictation();
  if (!snapshot.settings.statsForNerds) return null;
  const generated = output ? [output] : outputs;
  const speed =
    session?.stats && session.stats.transcriptionMs > 0 && session.durationMs > 0
      ? session.durationMs / session.stats.transcriptionMs
      : undefined;
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Stats for Nerds"
            title="Stats for Nerds"
            className="text-muted-foreground"
          />
        }
      >
        <ChartNoAxesColumn aria-hidden="true" />
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader className="pr-8 text-left">
          <DialogTitle>Stats for Nerds</DialogTitle>
          <DialogDescription>
            Timing, model details, and available token usage for this{" "}
            {session ? "dictation" : "output"}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5 text-xs leading-5">
          {session && (
            <div>
              <dl className="grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3">
                <Metric label="Speech model">{session.speechModel}</Metric>
                <Metric label="Speech engine">{session.stats?.engine ?? "Unavailable"}</Metric>
                <Metric label="Language setting">
                  {session.language === "auto" ? "Auto" : session.language}
                </Metric>
                <Metric label="Audio length">{elapsed(session.durationMs)}</Metric>
                <Metric label="Transcription time">
                  {elapsed(session.stats?.transcriptionMs)}
                </Metric>
                <Metric label="Transcription speed">
                  {speed === undefined
                    ? "Unavailable"
                    : `${speed.toLocaleString(undefined, { maximumFractionDigits: 1 })}× real time`}
                </Metric>
                <Metric label="Transcript words">
                  {session.rawTranscript
                    .trim()
                    .split(/\s+/)
                    .filter(Boolean)
                    .length.toLocaleString()}
                </Metric>
              </dl>
              <p className="mt-3 text-muted-foreground">
                Transcription time includes speech model loading. Audio preparation and text
                processing are excluded.
                {!session.stats && " Timing was not recorded for this dictation."}
              </p>
            </div>
          )}
          {generated.map((item) => (
            <div key={item.id} className={session ? "border-t pt-4" : ""}>
              <p className="mb-3 break-words font-medium">
                {item.chain?.step ? `Step ${item.chain.step}: ` : ""}
                {item.prompt.name}
              </p>
              {item.stats ? (
                <TextMetrics stats={item.stats} />
              ) : (
                <p className="text-muted-foreground">Stats were not recorded for this output.</p>
              )}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
