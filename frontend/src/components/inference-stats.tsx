import i18n from "@/i18n";
import { useTranslation } from "react-i18next";
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
  available(value)
    ? value!.toLocaleString(i18n.resolvedLanguage)
    : i18n.t("inferenceStats.unavailable");
const elapsed = (ms: number | null | undefined) =>
  !available(ms)
    ? i18n.t("inferenceStats.unavailable")
    : ms! < 1000
      ? `${ms!.toLocaleString(i18n.resolvedLanguage, { maximumFractionDigits: 1 })} ms`
      : `${(ms! / 1000).toLocaleString(i18n.resolvedLanguage, { maximumFractionDigits: 2 })} s`;
const rate = (value: number | null | undefined) =>
  available(value)
    ? `${value!.toLocaleString(i18n.resolvedLanguage, { maximumFractionDigits: 1 })} tokens/s`
    : i18n.t("inferenceStats.unavailable");

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
  const { t } = useTranslation();
  const responseRate =
    available(stats.outputTokens) && stats.responseMs > 0
      ? (stats.outputTokens! * 1000) / stats.responseMs
      : undefined;
  return (
    <>
      <dl className="grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3">
        <Metric label={t("promptsPage.textModel")}>{stats.model}</Metric>
        <Metric label={t("inferenceStats.lLMTime")}>{elapsed(stats.durationMs)}</Metric>
        <Metric label={t("inferenceStats.responseRate")}>{rate(responseRate)}</Metric>
        {available(stats.generationTokensPerSecond) && (
          <Metric label={t("inferenceStats.generationSpeed")}>
            {rate(stats.generationTokensPerSecond)}
          </Metric>
        )}
        <Metric label={t("inferenceStats.inputTokens")}>{count(stats.inputTokens)}</Metric>
        <Metric label={t("inferenceStats.outputTokens")}>{count(stats.outputTokens)}</Metric>
        <Metric label={t("inferenceStats.totalTokens")}>{count(stats.totalTokens)}</Metric>
        {available(stats.cachedInputTokens) && (
          <Metric label={t("inferenceStats.cachedInputTokens")}>
            {count(stats.cachedInputTokens)}
          </Metric>
        )}
        {available(stats.reasoningTokens) && (
          <Metric label={t("inferenceStats.reasoningTokens")}>
            {count(stats.reasoningTokens)}
          </Metric>
        )}
        <Metric label={t("inferenceStats.requests")}>{count(stats.attempts)}</Metric>
        {stats.finishReason && (
          <Metric label={t("inferenceStats.finishReason")}>{stats.finishReason}</Metric>
        )}
      </dl>
      <p className="mt-3 text-muted-foreground">
        {t("inferenceStats.responseRateIsOutputTokensDividedBy")}
        {stats.attempts > 1 && t("inferenceStats.lLMTimeIncludesRetriesTokenCountsAndRates")}
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
  const { t } = useTranslation();
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
            aria-label={t("settingsPage.statsForNerds")}
            title={t("settingsPage.statsForNerds")}
            className="text-muted-foreground"
          />
        }
      >
        <ChartNoAxesColumn aria-hidden="true" />
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader className="pr-8 text-left">
          <DialogTitle>{t("settingsPage.statsForNerds")}</DialogTitle>
          <DialogDescription>
            {t("inferenceStats.timingModelDetailsAndAvailableTokenUsage")}{" "}
            {session ? t("historyPage.dictation") : t("inferenceStats.output")}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5 text-xs leading-5">
          {session && (
            <div>
              <dl className="grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3">
                <Metric label={t("common.speechModel")}>{session.speechModel}</Metric>
                <Metric label={t("inferenceStats.speechEngine")}>
                  {session.stats?.engine ?? t("inferenceStats.unavailable")}
                </Metric>
                <Metric label={t("inferenceStats.languageSetting")}>
                  {session.language === "auto" ? t("inferenceStats.auto") : session.language}
                </Metric>
                <Metric label={t("inferenceStats.audioLength")}>
                  {elapsed(session.durationMs)}
                </Metric>
                <Metric label={t("inferenceStats.transcriptionTime")}>
                  {elapsed(session.stats?.transcriptionMs)}
                </Metric>
                <Metric label={t("inferenceStats.transcriptionSpeed")}>
                  {speed === undefined
                    ? t("inferenceStats.unavailable")
                    : t("inferenceStats.realTime", {
                        speed: speed.toLocaleString(i18n.resolvedLanguage, {
                          maximumFractionDigits: 1,
                        }),
                      })}
                </Metric>
                <Metric label={t("inferenceStats.transcriptWords")}>
                  {session.rawTranscript
                    .trim()
                    .split(/\s+/)
                    .filter(Boolean)
                    .length.toLocaleString(i18n.resolvedLanguage)}
                </Metric>
              </dl>
              <p className="mt-3 text-muted-foreground">
                {t("inferenceStats.transcriptionTimeIncludesSpeechModelLoadingAudio")}
                {!session.stats && t("inferenceStats.timingWasNotRecordedForThisDictation")}
              </p>
            </div>
          )}
          {generated.map((item) => (
            <div key={item.id} className={session ? "border-t pt-4" : ""}>
              <p className="mb-3 break-words font-medium">
                {item.chain?.step ? t("homeResultPanel.step", { step: item.chain.step }) : ""}
                {item.prompt.name}
              </p>
              {item.stats ? (
                <TextMetrics stats={item.stats} />
              ) : (
                <p className="text-muted-foreground">
                  {t("inferenceStats.statsWereNotRecordedForThisOutput")}
                </p>
              )}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
