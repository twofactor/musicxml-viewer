"use client";

type NoteSelection = {
  name: string;
  midi: number;
};

type PianoVisualizerProps = {
  selectedNotes: NoteSelection[];
};

type WhiteKey = {
  midi: number;
  label: string;
  hasBlackAfter: boolean;
};

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const BLACK_NOTES = new Set([1, 3, 6, 8, 10]);

const toNoteName = (midi: number) => {
  const octave = Math.floor(midi / 12) - 1;
  const name = NOTE_NAMES[midi % 12];
  return `${name}${octave}`;
};

const buildWhiteKeys = (startMidi: number, endMidi: number): WhiteKey[] => {
  const keys: WhiteKey[] = [];
  for (let midi = startMidi; midi <= endMidi; midi += 1) {
    const isBlack = BLACK_NOTES.has(midi % 12);
    if (!isBlack) {
      const nextMidi = midi + 1;
      keys.push({
        midi,
        label: toNoteName(midi),
        hasBlackAfter: nextMidi <= endMidi && BLACK_NOTES.has(nextMidi % 12),
      });
    }
  }
  return keys;
};

export default function PianoVisualizer({
  selectedNotes,
}: PianoVisualizerProps) {
  const firstMidi = 21; // A0
  const lastMidi = 108; // C8
  const whiteKeys = buildWhiteKeys(firstMidi, lastMidi);
  const selectedSet = new Set(selectedNotes.map((note) => note.midi));
  const maxWhite = whiteKeys.length;
  const blackWidthPercent = 55 / maxWhite;
  const blackKeys = whiteKeys
    .map((key, index) => {
      if (!key.hasBlackAfter) {
        return null;
      }
      return {
        midi: key.midi + 1,
        leftPercent: ((index + 1) * 100) / maxWhite - blackWidthPercent / 2,
      };
    })
    .filter(
      (key): key is { midi: number; leftPercent: number } => key !== null,
    );

  return (
    <div className="flex h-28 w-full shrink-0 flex-col border-t-2 border-amber-800 bg-gradient-to-b from-amber-900 to-amber-950">
      {/* Selected note indicator */}
      <div className="flex h-6 items-center justify-center bg-amber-950/80">
        {selectedNotes.length ? (
          <span className="text-xs font-medium text-amber-200">
            {selectedNotes.length === 1
              ? `${selectedNotes[0].name} · MIDI ${selectedNotes[0].midi}`
              : `Chord: ${selectedNotes
                  .map((note) => note.name)
                  .slice(0, 4)
                  .join(", ")}${selectedNotes.length > 4 ? "…" : ""}`}
          </span>
        ) : (
          <span className="text-xs text-amber-200/50">
            Tap a note on the score
          </span>
        )}
      </div>

      {/* Piano keys */}
      <div className="relative flex-1">
        {/* Black keys layer */}
        <div className="absolute inset-x-0 top-0 z-10 h-[58%]">
          {blackKeys.map((key) => {
            const isActive = selectedSet.has(key.midi);
            return (
              <div
                key={key.midi}
                className={`absolute top-0 h-full rounded-b-[3px] shadow-lg transition-colors duration-75 ${
                  isActive
                    ? "bg-gradient-to-b from-amber-400 to-amber-500"
                    : "bg-gradient-to-b from-zinc-800 to-zinc-900"
                }`}
                style={{
                  width: `${blackWidthPercent}%`,
                  left: `${key.leftPercent}%`,
                }}
              />
            );
          })}
        </div>

        {/* White keys layer */}
        <div className="flex h-full">
          {whiteKeys.map((key) => {
            const isActive = selectedSet.has(key.midi);
            return (
              <div
                key={key.midi}
                className={`relative flex-1 border-r border-zinc-300 transition-colors duration-75 last:border-r-0 ${
                  isActive
                    ? "bg-gradient-to-b from-amber-300 to-amber-400"
                    : "bg-gradient-to-b from-zinc-100 to-white"
                }`}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
