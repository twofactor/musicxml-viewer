"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { songs, type Song } from "../lib/songs";
import MusicRenderer, {
  type MusicRendererHandle,
  type NoteEntry,
  type NoteSelection,
  type PlaybackEvent,
} from "./MusicRenderer";
import PianoVisualizer from "./PianoVisualizer";
import VerovioRenderer from "./VerovioRenderer";

type Screen =
  | { type: "library" }
  | { type: "viewer"; song: Song; xmlText?: string; xmlData?: ArrayBuffer };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ type: "library" });
  const [selectedNotes, setSelectedNotes] = useState<NoteSelection[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [activeTool, setActiveTool] = useState<"note" | "bar">("note");
  const [isPlaying, setIsPlaying] = useState(false);
  const [rendererMode, setRendererMode] = useState<"osmd" | "verovio">(
    "verovio"
  );
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const osmdRef = useRef<MusicRendererHandle | null>(null);
  const verovioRef = useRef<MusicRendererHandle | null>(null);
  const playbackEventsRef = useRef<PlaybackEvent[]>([]);
  const playbackTimeoutsRef = useRef<number[]>([]);
  const playbackStartRef = useRef<number | null>(null);
  const playheadRef = useRef(0);
  const isPlayingRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const localIdRef = useRef(0);

  const ensureAudioContext = async () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
      masterGainRef.current = audioContextRef.current.createGain();
      masterGainRef.current.gain.value = 0.18;
      masterGainRef.current.connect(audioContextRef.current.destination);
    }
    if (audioContextRef.current.state === "suspended") {
      await audioContextRef.current.resume();
    }
    return audioContextRef.current;
  };

  const midiToFrequency = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

  const playNote = async (midi: number, durationSec: number) => {
    const context = await ensureAudioContext();
    const masterGain = masterGainRef.current;
    if (!masterGain) {
      return;
    }
    const osc = context.createOscillator();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();

    osc.type = "triangle";
    osc.frequency.value = midiToFrequency(midi);
    filter.type = "lowpass";
    filter.frequency.value = 5200;
    filter.Q.value = 0.6;

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);

    const now = context.currentTime;
    const attack = 0.02;
    const release = Math.max(0.12, durationSec);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.7, now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + release);

    osc.start(now);
    osc.stop(now + release + 0.05);
  };

  const playChord = (selections: NoteSelection[], durationSec: number) => {
    selections.forEach((note) => {
      void playNote(note.midi, durationSec);
    });
  };

  const clearPlaybackTimers = useCallback(() => {
    playbackTimeoutsRef.current.forEach((id) => window.clearTimeout(id));
    playbackTimeoutsRef.current = [];
  }, []);

  const stopPlayback = useCallback(
    (resetPlayhead: boolean) => {
      clearPlaybackTimers();
      isPlayingRef.current = false;
      setIsPlaying(false);
      playbackStartRef.current = null;
      if (resetPlayhead) {
        playheadRef.current = 0;
      }
      const activeRenderer =
        rendererMode === "verovio" ? verovioRef.current : osmdRef.current;
      activeRenderer?.clearHighlights();
      setSelectedNotes([]);
    },
    [clearPlaybackTimers, rendererMode]
  );

  const scheduleEvents = (
    events: PlaybackEvent[],
    startOffsetSec: number,
    usePlaybackState: boolean
  ) => {
    clearPlaybackTimers();
    if (!events.length) {
      return;
    }
    void ensureAudioContext();
    const context = audioContextRef.current;
    if (!context) {
      return;
    }
    if (usePlaybackState) {
      isPlayingRef.current = true;
      setIsPlaying(true);
    }
    playbackStartRef.current = context.currentTime - startOffsetSec;

    events.forEach((event) => {
      if (event.startSec < startOffsetSec) {
        return;
      }
      const delayMs = (event.startSec - startOffsetSec) * 1000;
      const timeoutId = window.setTimeout(() => {
        if (usePlaybackState && !isPlayingRef.current) {
          return;
        }
        const activeRenderer =
          rendererMode === "verovio" ? verovioRef.current : osmdRef.current;
        activeRenderer?.highlightEntries(event.entries);
        playChord(event.selections, event.durationSec);
      }, delayMs);
      playbackTimeoutsRef.current.push(timeoutId);
    });

    const lastEvent = events[events.length - 1];
    const endMs =
      (lastEvent.startSec + lastEvent.durationSec - startOffsetSec) * 1000 + 80;
    const finishId = window.setTimeout(() => {
      if (usePlaybackState) {
        stopPlayback(true);
      } else {
        const activeRenderer =
          rendererMode === "verovio" ? verovioRef.current : osmdRef.current;
        activeRenderer?.clearHighlights();
      }
    }, Math.max(0, endMs));
    playbackTimeoutsRef.current.push(finishId);
  };

  const startPlayback = () => {
    scheduleEvents(playbackEventsRef.current, playheadRef.current, true);
  };

  const pausePlayback = () => {
    if (!isPlayingRef.current) {
      return;
    }
    const context = audioContextRef.current;
    if (context && playbackStartRef.current !== null) {
      playheadRef.current = Math.max(
        0,
        context.currentTime - playbackStartRef.current
      );
    }
    clearPlaybackTimers();
    isPlayingRef.current = false;
    setIsPlaying(false);
  };

  const handleNotePlayed = (entries: NoteEntry[]) => {
    if (activeTool !== "note") {
      return;
    }
    void ensureAudioContext();
    playChord(
      entries.map((entry) => entry.selection),
      0.65
    );
  };

  const handleBarTriggered = (events: PlaybackEvent[]) => {
    if (activeTool !== "bar") {
      return;
    }
    stopPlayback(true);
    scheduleEvents(events, 0, false);
  };

  const handleScoreReady = useCallback(
    (events: PlaybackEvent[]) => {
      playbackEventsRef.current = events;
      playheadRef.current = 0;
      stopPlayback(true);
    },
    [stopPlayback]
  );

  useEffect(() => {
    stopPlayback(true);
  }, [rendererMode, stopPlayback]);

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      const message = event.error?.stack || event.message || "Unknown error";
      setRuntimeError(message);
      console.error("Runtime error:", message);
    };
    const handleRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const message =
        reason?.stack || reason?.message || String(reason || "Unknown rejection");
      setRuntimeError(message);
      console.error("Unhandled rejection:", message);
    };
    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);

  const goToLibrary = () => {
    setScreen({ type: "library" });
    setSelectedNotes([]);
    stopPlayback(true);
    setRendererMode("osmd");
  };

  const openSong = (song: Song) => {
    setScreen({ type: "viewer", song });
    setSelectedNotes([]);
    stopPlayback(true);
    setRendererMode("osmd");
  };

  const openLocalFile = async (file: File) => {
    const fileName = file.name.replace(/\.[^.]+$/, "");
    const isMxl = file.name.toLowerCase().endsWith(".mxl");
    const xmlData = isMxl ? await file.arrayBuffer() : undefined;
    const xmlText = isMxl ? undefined : await file.text();
    localIdRef.current += 1;
    const localSong: Song = {
      id: `local-${localIdRef.current}`,
      title: fileName || "Imported Score",
      composer: "Local file",
      file: "",
      sourceUrl: "",
    };
    setScreen({ type: "viewer", song: localSong, xmlText, xmlData });
    setSelectedNotes([]);
    stopPlayback(true);
    setRendererMode("osmd");
  };

  useEffect(() => {
    return () => {
      stopPlayback(true);
      if (audioContextRef.current) {
        void audioContextRef.current.close();
      }
    };
  }, [stopPlayback]);

  if (screen.type === "library") {
    return (
      <div className="flex h-screen flex-col bg-amber-50">
        {/* Header */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-amber-200 bg-gradient-to-b from-amber-800 to-amber-900 px-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-700">
              <svg
                className="h-5 w-5 text-amber-100"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
                />
              </svg>
            </div>
            <h1 className="text-lg font-semibold text-amber-100">Library</h1>
          </div>
          <span className="text-xs text-amber-300/70">
            {songs.length} {songs.length === 1 ? "score" : "scores"}
          </span>
        </header>

        {/* Song list */}
        <main
          className="flex-1 overflow-auto p-4"
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setIsDragging(false);
            const file = event.dataTransfer.files?.[0];
            if (file) {
              void openLocalFile(file);
            }
          }}
        >
          <div className="mx-auto max-w-2xl space-y-4">
            <label
              className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition ${
                isDragging
                  ? "border-amber-500 bg-amber-100/70 text-amber-900"
                  : "border-amber-200 bg-white text-amber-700 hover:border-amber-300"
              }`}
            >
              <input
                type="file"
                accept=".musicxml,.xml,.mxl"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    void openLocalFile(file);
                  }
                }}
              />
              <span className="text-sm font-semibold">
                Drop a MusicXML file
              </span>
              <span className="text-xs text-amber-700/70">
                or click to upload .musicxml/.xml/.mxl
              </span>
            </label>
            {songs.map((song) => (
              <button
                key={song.id}
                onClick={() => openSong(song)}
                className="group flex w-full items-center justify-between rounded-xl border border-amber-200 bg-white p-4 text-left shadow-sm transition hover:border-amber-300 hover:shadow-md"
              >
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-base font-semibold text-amber-900 group-hover:text-amber-700">
                    {song.title}
                  </h2>
                  <p className="truncate text-sm text-amber-700/70">
                    {song.composer}
                  </p>
                </div>
                <div className="ml-4 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 transition group-hover:bg-amber-200">
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M8.25 4.5l7.5 7.5-7.5 7.5"
                    />
                  </svg>
                </div>
              </button>
            ))}
          </div>
        </main>
      </div>
    );
  }

  // Viewer screen
  const { song } = screen;

  return (
    <div className="flex h-screen flex-col bg-amber-50">
      {/* Header bar */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-amber-200 bg-gradient-to-b from-amber-800 to-amber-900 px-3">
        {/* Left: Library button */}
        <button
          onClick={goToLibrary}
          className="flex items-center gap-1.5 rounded-md bg-amber-700/50 px-3 py-1.5 text-xs font-semibold text-amber-100 transition hover:bg-amber-700"
        >
          <svg
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 19.5L8.25 12l7.5-7.5"
            />
          </svg>
          Library
        </button>

        {/* Center: Title */}
        <div className="absolute left-1/2 -translate-x-1/2 text-center">
          <h1 className="text-sm font-semibold text-amber-100">{song.title}</h1>
          <p className="text-[10px] text-amber-300/70">{song.composer}</p>
          {rendererMode === "verovio" && (
            <p className="text-[10px] text-amber-200/80">Verovio renderer</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() =>
              setRendererMode((prev) => (prev === "osmd" ? "verovio" : "osmd"))
            }
            className="rounded-md border border-amber-600/60 px-2.5 py-1.5 text-[11px] font-semibold text-amber-100 transition hover:bg-amber-700/40"
          >
            {rendererMode === "osmd" ? "OSMD" : "Verovio"}
          </button>
          <button
            onClick={() => (isPlaying ? pausePlayback() : startPlayback())}
            className="flex items-center gap-1.5 rounded-md bg-amber-700/50 px-2.5 py-1.5 text-xs font-semibold text-amber-100 transition hover:bg-amber-700"
          >
            {isPlaying ? "Pause" : "Play"}
          </button>
          <div className="flex items-center rounded-md bg-amber-950/40 p-0.5 text-[11px] font-semibold text-amber-100">
            <button
              onClick={() => setActiveTool("note")}
              className={`rounded px-2 py-1 transition ${
                activeTool === "note"
                  ? "bg-amber-600 text-amber-950"
                  : "text-amber-100/80 hover:text-amber-100"
              }`}
            >
              Note
            </button>
            <button
              onClick={() => setActiveTool("bar")}
              className={`rounded px-2 py-1 transition ${
                activeTool === "bar"
                  ? "bg-amber-600 text-amber-950"
                  : "text-amber-100/80 hover:text-amber-100"
              }`}
            >
              Bar
            </button>
          </div>
        </div>
      </header>
      {runtimeError && (
        <div className="border-b border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {runtimeError}
        </div>
      )}

      {/* Sheet music area */}
      <main className="score-scroll flex-1 overflow-y-auto overflow-x-hidden">
        {rendererMode === "osmd" ? (
          <MusicRenderer
            ref={osmdRef}
            xmlUrl={song.file || undefined}
            xmlText={screen.xmlText}
            xmlData={screen.xmlData}
            activeTool={activeTool}
            onNoteSelected={setSelectedNotes}
            onNotePlayed={handleNotePlayed}
            onBarTriggered={handleBarTriggered}
            onScoreReady={handleScoreReady}
          />
        ) : (
          <VerovioRenderer
            ref={verovioRef}
            xmlUrl={song.file || undefined}
            xmlText={screen.xmlText}
            xmlData={screen.xmlData}
            activeTool={activeTool}
            onNoteSelected={setSelectedNotes}
            onNotePlayed={handleNotePlayed}
            onBarTriggered={handleBarTriggered}
            onScoreReady={handleScoreReady}
          />
        )}
      </main>

      {/* Piano at bottom */}
      <PianoVisualizer selectedNotes={selectedNotes} />
    </div>
  );
}
