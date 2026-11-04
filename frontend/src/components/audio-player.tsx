import i18n from "@/i18n";
import { nativeText } from "@/i18n/native-text";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { Loader2, Pause, Play, Volume2, VolumeX, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

const speeds = [0.75, 1, 1.25, 1.5, 2].map((value) => ({
  value: String(value),
  label: `${value}×`,
}));

function timeLabel(seconds: number) {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const minutes = Math.floor(value / 60);
  return `${minutes}:${String(value % 60).padStart(2, "0")}`;
}

type AudioPlayerProps = {
  src: string;
  durationMs?: number;
  autoPlay?: boolean;
  onClose?: () => void;
  className?: string;
};

export function AudioPlayer(props: AudioPlayerProps) {
  return <Playback key={props.src} {...props} />;
}

function Playback({ src, durationMs = 0, autoPlay = false, onClose, className }: AudioPlayerProps) {
  const { t } = useTranslation();
  const audio = useRef<HTMLAudioElement>(null);
  const playback = useRef({ mounted: false, request: 0 });
  const lastVolume = useRef(1);
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState("");
  const [position, setPosition] = useState(0);
  const [length, setLength] = useState(
    Number.isFinite(durationMs) ? Math.max(0, durationMs / 1000) : 0,
  );
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState("1");

  const start = useCallback(async () => {
    const media = audio.current;
    if (!media) return;
    const lifecycle = playback.current;
    const request = ++lifecycle.request;
    setError("");
    try {
      await media.play();
    } catch (cause) {
      if (
        lifecycle.mounted &&
        request === lifecycle.request &&
        !(cause instanceof DOMException && cause.name === "AbortError")
      )
        setError(
          media.error
            ? i18n.t("audioPlayer.thisRecordingCouldnTBePlayed")
            : i18n.t("audioPlayer.playbackDidnTStartPressPlayTo"),
        );
    }
  }, []);

  useEffect(() => {
    const lifecycle = playback.current;
    lifecycle.mounted = true;
    const media = audio.current;
    if (autoPlay) void start();
    return () => {
      lifecycle.mounted = false;
      lifecycle.request++;
      media?.pause();
    };
  }, [autoPlay, start]);

  function updateDuration() {
    const duration = audio.current?.duration ?? 0;
    if (Number.isFinite(duration) && duration > 0) {
      setLength(duration);
      setReady(true);
    }
  }

  function toggle() {
    const media = audio.current;
    if (!media) return;
    if (!media.paused) {
      playback.current.request++;
      media.pause();
    } else {
      if (media.ended) media.currentTime = 0;
      void start();
    }
  }

  function toggleMute() {
    const media = audio.current;
    if (!media) return;
    if (media.muted || media.volume === 0) {
      media.volume = lastVolume.current;
      media.muted = false;
    } else media.muted = true;
  }

  const silent = muted || volume === 0;
  return (
    <section
      aria-label={t("audioPlayer.recordingPlayer")}
      className={cn("@container/audio-player min-w-0 rounded-xl border bg-card/60 p-3", className)}
    >
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        className="hidden"
        onLoadedMetadata={updateDuration}
        onDurationChange={updateDuration}
        onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPlaying={() => {
          setPlaying(true);
          setWaiting(false);
        }}
        onPause={() => {
          setPlaying(false);
          setWaiting(false);
        }}
        onEnded={() => {
          setPlaying(false);
          setPosition(audio.current?.duration ?? 0);
        }}
        onWaiting={() => setWaiting(true)}
        onCanPlay={() => setWaiting(false)}
        onVolumeChange={(event) => {
          const media = event.currentTarget;
          setVolume(media.volume);
          setMuted(media.muted);
          if (media.volume > 0) lastVolume.current = media.volume;
        }}
        onRateChange={(event) => setRate(String(event.currentTarget.playbackRate))}
        onError={() => {
          setFailed(true);
          setPlaying(false);
          setWaiting(false);
          setError(t("audioPlayer.thisRecordingCouldnTBePlayed"));
        }}
      />
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <Button
          variant="secondary"
          size="icon"
          aria-label={
            playing ? t("audioPlayer.pauseRecording") : t("historyEntryPage.playRecording")
          }
          title={playing ? t("audioPlayer.pauseRecording") : t("historyEntryPage.playRecording")}
          disabled={failed}
          onClick={toggle}
        >
          {!failed && (!ready || waiting) ? (
            <Loader2
              aria-hidden="true"
              className="size-4 animate-spin motion-reduce:animate-none"
            />
          ) : playing ? (
            <Pause aria-hidden="true" className="size-4 fill-current" />
          ) : (
            <Play aria-hidden="true" className="size-4 fill-current" />
          )}
        </Button>
        <div
          aria-label={t("audioPlayer.playbackTime")}
          className="flex min-w-0 flex-wrap items-center gap-1 font-mono text-xs text-muted-foreground tabular-nums"
        >
          <span className="text-foreground">{timeLabel(position)}</span>
          <span aria-hidden="true">/</span>
          <span>{timeLabel(length)}</span>
        </div>
        <Slider
          aria-label={t("audioPlayer.recordingPosition")}
          className="order-last w-full @min-[36rem]/audio-player:order-none @min-[36rem]/audio-player:w-auto @min-[36rem]/audio-player:flex-1"
          min={0}
          max={Math.max(1, length)}
          step={1}
          value={Math.min(position, length)}
          disabled={!ready || failed}
          getAriaValueText={(_, value) => `${timeLabel(value)} of ${timeLabel(length)}`}
          onValueChange={(value) => {
            if (audio.current && ready) {
              audio.current.currentTime = value;
              setPosition(value);
            }
          }}
        />
        <div className="order-2 ml-auto flex min-w-0 max-w-full flex-wrap items-center gap-2 @min-[36rem]/audio-player:order-none">
          <Select
            items={speeds}
            value={rate}
            onValueChange={(value) => {
              if (audio.current && value !== null) audio.current.playbackRate = Number(value);
            }}
          >
            <SelectTrigger
              aria-label={t("audioPlayer.playbackSpeed")}
              size="sm"
              className="w-20 max-w-full border-transparent bg-transparent dark:bg-transparent"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false} align="end">
              {speeds.map((speed) => (
                <SelectItem key={speed.value} value={speed.value}>
                  {speed.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex min-w-0 max-w-full items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={
                silent ? t("audioPlayer.unmuteRecording") : t("audioPlayer.muteRecording")
              }
              title={silent ? t("audioPlayer.unmuteRecording") : t("audioPlayer.muteRecording")}
              onClick={toggleMute}
            >
              {silent ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
            </Button>
            <Slider
              aria-label={t("audioPlayer.volume")}
              className="w-20 min-w-0 flex-1"
              min={0}
              max={1}
              step={0.05}
              value={silent ? 0 : volume}
              getAriaValueText={(_, value) => `${Math.round(value * 100)} percent`}
              onValueChange={(value) => {
                if (audio.current) {
                  audio.current.volume = value;
                  audio.current.muted = value === 0;
                }
              }}
            />
          </div>
        </div>
        {onClose && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("audioPlayer.closeAudioPlayer")}
            title={t("audioPlayer.closeAudioPlayer")}
            className="order-1 ml-auto @min-[36rem]/audio-player:order-none @min-[36rem]/audio-player:ml-0"
            onClick={() => {
              playback.current.request++;
              audio.current?.pause();
              onClose();
            }}
          >
            <X aria-hidden="true" />
          </Button>
        )}
      </div>
      {error && (
        <div
          role="alert"
          className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-destructive"
        >
          {nativeText(error)}
          {failed && (
            <Button
              variant="link"
              size="sm"
              onClick={() => {
                setFailed(false);
                setReady(false);
                audio.current?.load();
                void start();
              }}
            >
              {t("audioPlayer.retryPlayback")}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
