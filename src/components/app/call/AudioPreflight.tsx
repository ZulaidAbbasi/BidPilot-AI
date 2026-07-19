import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, AlertTriangle, CheckCircle2, RefreshCw, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { AudioPreflightState } from "./types";

interface Props {
  onReady: (deviceId: string | null) => void;
  onNotReady: () => void;
}

/**
 * Audio preflight — requests mic permission, enumerates devices, and
 * shows a live input meter powered by Web Audio API. All browser APIs
 * are accessed only inside effects/handlers, never at module scope.
 */
export function AudioPreflight({ onReady, onNotReady }: Props) {
  const [state, setState] = useState<AudioPreflightState>({
    supported: true,
    permission: "unknown",
    devices: [],
    selectedDeviceId: null,
    inputLevel: 0,
    testing: false,
  });

  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const cleanup = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (ctxRef.current) {
      void ctxRef.current.close();
      ctxRef.current = null;
    }
    analyserRef.current = null;
  }, []);

  const startMeter = useCallback(
    async (deviceId: string | null) => {
      cleanup();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: deviceId ? { deviceId: { exact: deviceId } } : true,
        });
        streamRef.current = stream;
        const AC =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new AC();
        ctxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        analyserRef.current = analyser;

        const buffer = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          if (!analyserRef.current) return;
          analyserRef.current.getByteTimeDomainData(buffer);
          let sum = 0;
          for (let i = 0; i < buffer.length; i++) {
            const v = (buffer[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / buffer.length);
          setState((prev) => ({ ...prev, inputLevel: Math.min(1, rms * 3) }));
          rafRef.current = requestAnimationFrame(tick);
        };
        tick();

        // Enumerate devices AFTER permission is granted, so labels are populated
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioIn = devices
          .filter((d) => d.kind === "audioinput")
          .map((d) => ({ deviceId: d.deviceId, label: d.label || "Microphone" }));

        const track = stream.getAudioTracks()[0];
        const activeId = track?.getSettings().deviceId ?? deviceId ?? audioIn[0]?.deviceId ?? null;

        setState((prev) => ({
          ...prev,
          permission: "granted",
          devices: audioIn,
          selectedDeviceId: activeId,
          error: undefined,
        }));
        onReady(activeId);
      } catch (err) {
        const isDenied =
          err instanceof DOMException &&
          (err.name === "NotAllowedError" || err.name === "SecurityError");
        setState((prev) => ({
          ...prev,
          permission: isDenied ? "denied" : "unknown",
          error: isDenied
            ? "Microphone access blocked. Enable it in your browser settings and retry."
            : (err as Error).message || "Could not access the microphone.",
          inputLevel: 0,
        }));
        onNotReady();
      }
    },
    [cleanup, onReady, onNotReady],
  );

  useEffect(() => {
    // Feature detection first
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setState((s) => ({
        ...s,
        supported: false,
        error: "This browser does not support microphone capture. Try Chrome, Edge, or Safari.",
      }));
      onNotReady();
      return;
    }

    // Ask immediately — the Start button depends on this
    void startMeter(null);
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDeviceChange = (id: string) => {
    setState((s) => ({ ...s, selectedDeviceId: id }));
    void startMeter(id);
  };

  const bars = 12;
  const active = Math.round(state.inputLevel * bars);

  return (
    <div className="rounded-xl border border-border/70 bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {state.permission === "granted" ? (
            <CheckCircle2 className="size-4 text-verified" />
          ) : state.permission === "denied" ? (
            <MicOff className="size-4 text-risk" />
          ) : (
            <Mic className="size-4 text-muted-foreground" />
          )}
          <span className="text-sm font-medium">Audio preflight</span>
        </div>
        <span
          className={cn(
            "font-mono text-[10px] uppercase tracking-[0.12em]",
            state.permission === "granted"
              ? "text-verified"
              : state.permission === "denied"
                ? "text-risk"
                : "text-muted-foreground",
          )}
        >
          {state.permission === "granted"
            ? "Ready"
            : state.permission === "denied"
              ? "Blocked"
              : "Checking…"}
        </span>
      </div>

      {state.error && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-risk/30 bg-risk-soft/50 p-2 text-xs text-risk-foreground">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>{state.error}</span>
        </div>
      )}

      {state.supported && state.devices.length > 0 && (
        <div className="mt-3 space-y-2">
          <label className="block font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Microphone
          </label>
          <Select value={state.selectedDeviceId ?? ""} onValueChange={handleDeviceChange}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Select microphone" />
            </SelectTrigger>
            <SelectContent>
              {state.devices.map((d) => (
                <SelectItem key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {state.permission === "granted" && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Input level
            </span>
            <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
              {Math.round(state.inputLevel * 100)}%
            </span>
          </div>
          <div className="flex h-4 items-end gap-0.5" aria-hidden>
            {Array.from({ length: bars }).map((_, i) => (
              <div
                key={i}
                className={cn(
                  "w-1.5 rounded-sm transition-[background-color,height] duration-100",
                  i < active
                    ? i < bars * 0.6
                      ? "h-full bg-verified"
                      : i < bars * 0.85
                        ? "h-full bg-warn"
                        : "h-full bg-risk"
                    : "h-1 bg-border",
                )}
              />
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            <Volume2 className="mr-1 inline size-3" />
            Speak now — bars should react. If they stay flat, pick a different mic.
          </p>
        </div>
      )}

      {state.permission === "denied" && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3 w-full"
          onClick={() => startMeter(null)}
        >
          <RefreshCw className="mr-1.5 size-3.5" /> Retry permission
        </Button>
      )}
    </div>
  );
}
