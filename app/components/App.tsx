"use client";

import { useState } from "react";
import { songs, type Song } from "../lib/songs";
import MusicRenderer from "./MusicRenderer";
import PianoVisualizer from "./PianoVisualizer";

type NoteSelection = {
  name: string;
  midi: number;
};

type Screen =
  | { type: "library" }
  | { type: "viewer"; song: Song; xmlText?: string; xmlData?: ArrayBuffer };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ type: "library" });
  const [selectedNotes, setSelectedNotes] = useState<NoteSelection[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  const goToLibrary = () => {
    setScreen({ type: "library" });
    setSelectedNotes([]);
  };

  const openSong = (song: Song) => {
    setScreen({ type: "viewer", song });
    setSelectedNotes([]);
  };

  const openLocalFile = async (file: File) => {
    const fileName = file.name.replace(/\.[^.]+$/, "");
    const isMxl = file.name.toLowerCase().endsWith(".mxl");
    const xmlData = isMxl ? await file.arrayBuffer() : undefined;
    const xmlText = isMxl ? undefined : await file.text();
    const localSong: Song = {
      id: `local-${Date.now()}`,
      title: fileName || "Imported Score",
      composer: "Local file",
      file: "",
      sourceUrl: "",
    };
    setScreen({ type: "viewer", song: localSong, xmlText, xmlData });
    setSelectedNotes([]);
  };

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
              <span className="text-sm font-semibold">Drop a MusicXML file</span>
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
        </div>

        <div className="w-20" />
      </header>

      {/* Sheet music area */}
      <main className="score-scroll flex-1 overflow-y-auto overflow-x-hidden">
        <MusicRenderer
          xmlUrl={song.file || undefined}
          xmlText={screen.xmlText}
          xmlData={screen.xmlData}
          onNoteSelected={setSelectedNotes}
        />
      </main>

      {/* Piano at bottom */}
      <PianoVisualizer selectedNotes={selectedNotes} />
    </div>
  );
}
