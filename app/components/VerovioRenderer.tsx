"use client";

import JSZip from "jszip";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  type MusicRendererHandle,
  type NoteEntry,
  type NoteSelection,
  type PlaybackEvent,
} from "./MusicRenderer";

type VerovioRendererProps = {
  xmlUrl?: string;
  xmlText?: string;
  xmlData?: ArrayBuffer;
  activeTool: "note" | "bar";
  onNoteSelected: (notes: NoteSelection[]) => void;
  onNotePlayed?: (entries: NoteEntry[]) => void;
  onBarTriggered?: (events: PlaybackEvent[]) => void;
  onScoreReady?: (events: PlaybackEvent[]) => void;
};

type VerovioToolkitInstance = {
  setOptions: (options: Record<string, unknown>) => void;
  loadData: (data: string) => void;
  getPageCount: () => number;
  renderToSVG: (page: number) => string;
};

type VerovioGlobal = {
  toolkit: new () => VerovioToolkitInstance;
};

type VerovioToolkitClass = new (module: unknown) => VerovioToolkitInstance;

const loadVerovioFromCdn = () =>
  new Promise<VerovioGlobal>((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Verovio can only load in the browser."));
      return;
    }
    const existing = (window as Window & { verovio?: VerovioGlobal }).verovio;
    if (existing?.toolkit) {
      resolve(existing);
      return;
    }
    const script = document.createElement("script");
    script.src =
      "https://www.verovio.org/javascript/latest/verovio-toolkit-wasm.js";
    script.async = true;
    script.onload = () => {
      const globalVerovio = (window as Window & { verovio?: VerovioGlobal })
        .verovio;
      if (!globalVerovio?.toolkit) {
        reject(new Error("Verovio CDN loaded without toolkit."));
        return;
      }
      resolve(globalVerovio);
    };
    script.onerror = () => reject(new Error("Failed to load Verovio CDN."));
    document.body.appendChild(script);
  });

const loadVerovioToolkit = async () => {
  try {
    const [{ default: createVerovioModule }, { VerovioToolkit }] =
      await Promise.all([import("verovio/wasm"), import("verovio/esm")]);
    const module = await createVerovioModule();
    const Toolkit = VerovioToolkit as VerovioToolkitClass;
    class ToolkitWrapper {
      constructor() {
        return new Toolkit(module) as VerovioToolkitInstance;
      }
    }
    return { toolkit: ToolkitWrapper as unknown as VerovioGlobal["toolkit"] };
  } catch {
    return loadVerovioFromCdn();
  }
};

const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

const toNoteNameFromMidi = (midi: number) => {
  const localNames = [
    "C",
    "C#",
    "D",
    "D#",
    "E",
    "F",
    "F#",
    "G",
    "G#",
    "A",
    "A#",
    "B",
  ];
  const octave = Math.floor(midi / 12) - 1;
  const name = localNames[midi % 12];
  return `${name}${octave}`;
};

const readMxlToXml = async (buffer: ArrayBuffer) => {
  const zip = await JSZip.loadAsync(buffer);
  const xmlFile = Object.values(zip.files).find((file) =>
    file.name.toLowerCase().match(/\.(musicxml|xml)$/)
  );
  if (!xmlFile) {
    throw new Error("Unable to find MusicXML file inside .mxl.");
  }
  return xmlFile.async("text");
};

const loadXml = async (
  xmlUrl?: string,
  xmlText?: string,
  xmlData?: ArrayBuffer
) => {
  if (xmlText) {
    return xmlText;
  }
  if (xmlData) {
    return readMxlToXml(xmlData);
  }
  if (xmlUrl) {
    const response = await fetch(xmlUrl);
    if (!response.ok) {
      throw new Error(`Failed to load MusicXML (${response.status}).`);
    }
    const isMxl =
      xmlUrl.toLowerCase().endsWith(".mxl") ||
      response.headers
        .get("content-type")
        ?.includes("application/vnd.recordare.musicxml");
    if (isMxl) {
      const buffer = await response.arrayBuffer();
      return readMxlToXml(buffer);
    }
    return response.text();
  }
  throw new Error("No MusicXML source provided.");
};

const getPitchData = (element: Element) => {
  const pitchElement =
    element.getAttribute("data-pname") !== null
      ? element
      : element.querySelector("[data-pname]");
  if (!pitchElement) {
    return null;
  }
  const pname = pitchElement.getAttribute("data-pname");
  const octave = pitchElement.getAttribute("data-oct");
  const accid =
    pitchElement.getAttribute("data-accid") ??
    pitchElement.getAttribute("data-accid.ges");
  if (!pname || octave === null) {
    return null;
  }
  return { pname, octave: Number(octave), accid };
};

const toMidiFromPitchData = (pname: string, octave: number, accid?: string) => {
  try {
    if (typeof pname !== "string") {
      return null;
    }
    const NOTE_TO_SEMITONE: Record<string, number> = {
      C: 0,
      D: 2,
      E: 4,
      F: 5,
      G: 7,
      A: 9,
      B: 11,
    };
    const ACCIDENTAL_TO_OFFSET: Record<string, number> = {
      s: 1,
      f: -1,
      n: 0,
      ss: 2,
      ff: -2,
      x: 2,
      xs: 2,
    };
    const step = NOTE_TO_SEMITONE[pname.toUpperCase()];
    if (step === undefined || Number.isNaN(octave)) {
      return null;
    }
    const accidental = accid ? ACCIDENTAL_TO_OFFSET[accid] ?? 0 : 0;
    return (octave + 1) * 12 + step + accidental;
  } catch {
    return null;
  }
};

const buildPlaybackEvents = (
  entries: NoteEntry[],
  bpm: number,
  offsetBeats = 0
) => {
  const grouped = new Map<number, PlaybackEvent>();
  const secondsPerBeat = 60 / bpm;
  const minDurationSec = 0.1;

  entries.forEach((entry, index) => {
    const timestamp =
      typeof entry.timestamp === "number" ? entry.timestamp : index * 0.5;
    const duration =
      typeof entry.duration === "number" ? entry.duration : 0.5;
    const startBeat = timestamp - offsetBeats;
    if (startBeat < 0) {
      return;
    }
    const startKey = Math.round(startBeat * 1000) / 1000;
    const startSec = startBeat * secondsPerBeat;
    const durationSec = Math.max(duration * secondsPerBeat, minDurationSec);

    const existing = grouped.get(startKey);
    if (existing) {
      existing.entries.push(entry);
      existing.selections.push(entry.selection);
      existing.durationSec = Math.max(existing.durationSec, durationSec);
    } else {
      grouped.set(startKey, {
        startSec,
        durationSec,
        entries: [entry],
        selections: [entry.selection],
      });
    }
  });

  return Array.from(grouped.values()).sort((a, b) => a.startSec - b.startSec);
};

const VerovioRenderer = forwardRef<MusicRendererHandle, VerovioRendererProps>(
  (
    {
      xmlUrl,
      xmlText,
      xmlData,
      activeTool,
      onNoteSelected,
      onNotePlayed,
      onBarTriggered,
      onScoreReady,
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const toolkitRef = useRef<any>(null);
    const elementMapRef = useRef<Map<string, Element>>(new Map());
    const entriesRef = useRef<NoteEntry[]>([]);
    const entriesByMeasureRef = useRef<Map<string, NoteEntry[]>>(new Map());
    const chordGroupsRef = useRef<Map<string, NoteEntry[]>>(new Map());
    const highlightedRef = useRef<Element[]>([]);
    const parseErrorRef = useRef(false);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const clearHighlights = useCallback(() => {
      highlightedRef.current.forEach((el) => {
        el.classList.remove("verovio-note-selected");
      });
      highlightedRef.current = [];
    }, []);

    const highlightEntries = useCallback(
      (entries: NoteEntry[]) => {
        clearHighlights();
        const selections: NoteSelection[] = [];
        const highlighted: Element[] = [];
        entries.forEach((entry) => {
          selections.push(entry.selection);
          const elementId = entry.elementId;
          if (!elementId) {
            return;
          }
          const element = elementMapRef.current.get(elementId);
          if (element) {
            element.classList.add("verovio-note-selected");
            highlighted.push(element);
          }
        });
        highlightedRef.current = highlighted;
        onNoteSelected(selections);
      },
      [clearHighlights, onNoteSelected]
    );

    useImperativeHandle(
      ref,
      () => ({
        highlightEntries,
        clearHighlights,
      }),
      [highlightEntries, clearHighlights]
    );

    useEffect(() => {
      let cancelled = false;

      const renderScore = async () => {
        let stage = "init";
        try {
          setIsLoading(true);
          setError(null);

          stage = "load-xml";
          const xml = await loadXml(xmlUrl, xmlText, xmlData);
          if (cancelled) {
            return;
          }

          stage = "load-verovio";
          const verovio = await loadVerovioToolkit();
          const toolkit = new verovio.toolkit();
          toolkitRef.current = toolkit;

          stage = "set-options";
          toolkit.setOptions({
            scale: 55,
            adjustPageHeight: true,
            adjustPageWidth: true,
            pageMarginTop: 40,
            pageMarginBottom: 40,
            pageMarginLeft: 35,
            pageMarginRight: 35,
          });

          stage = "load-data";
          toolkit.loadData(xml);
          const pageCount = toolkit.getPageCount();
          if (!pageCount || pageCount < 1) {
            setError("Verovio returned 0 pages for this score.");
            setIsLoading(false);
            return;
          }
          const pages: string[] = [];
          stage = "render-svg";
          for (let i = 1; i <= pageCount; i += 1) {
            pages.push(toolkit.renderToSVG(i));
          }

          if (cancelled) {
            return;
          }

          const container = containerRef.current;
          if (container) {
            container.innerHTML = pages.join("");
          }
          if (!pages.join("").trim()) {
            setError("Verovio rendered empty SVG output.");
            setIsLoading(false);
            return;
          }

          const elementMap = new Map<string, Element>();
          const entries: NoteEntry[] = [];
          const entriesByMeasure = new Map<string, NoteEntry[]>();
          const chordGroups = new Map<string, NoteEntry[]>();
          const noteElements =
            container?.querySelectorAll<Element>("g.note") ?? [];

          noteElements.forEach((noteElement, index) => {
            if (parseErrorRef.current) {
              return;
            }
            try {
              const id = noteElement.getAttribute("id");
              if (!id) {
                return;
              }

              const pitchData = getPitchData(noteElement);
              if (!pitchData) {
                return;
              }

              const midi = toMidiFromPitchData(
                pitchData.pname,
                pitchData.octave,
                pitchData.accid ?? undefined
              );
              if (midi === null) {
                return;
              }

              const name = toNoteNameFromMidi(midi);
              const selection: NoteSelection = { name, midi };

              const onsetRaw = noteElement.getAttribute("data-onset");
              const durRaw = noteElement.getAttribute("data-dur");
              const onset = onsetRaw ? Number(onsetRaw) : undefined;
              const duration = durRaw ? Number(durRaw) : undefined;

              const measureElement = noteElement.closest(".measure") as
                | Element
                | null;
              const measureId =
                measureElement?.getAttribute("id") ?? undefined;

              const entry: NoteEntry = {
                selection,
                elementId: id,
                measureId,
                sourceMeasure: measureId,
                timestamp: Number.isFinite(onset) ? onset : undefined,
                duration: Number.isFinite(duration) ? duration : undefined,
              };

              entries.push(entry);
              elementMap.set(id, noteElement);

              if (measureId) {
                if (!entriesByMeasure.has(measureId)) {
                  entriesByMeasure.set(measureId, []);
                }
                entriesByMeasure.get(measureId)!.push(entry);
              }

              const chordKey =
                measureId && Number.isFinite(onset)
                  ? `${measureId}:${onset}`
                  : `${measureId ?? "unknown"}:${index}`;
              if (!chordGroups.has(chordKey)) {
                chordGroups.set(chordKey, []);
              }
              chordGroups.get(chordKey)!.push(entry);
            } catch (err) {
              parseErrorRef.current = true;
              const details = err instanceof Error ? err.message : String(err);
              setError(
                `Verovio note parse failed: ${details} (note index ${index})`
              );
            }
          });

          chordGroups.forEach((group) => {
            group.forEach((entry) => {
              entry.chordEntries = group;
            });
          });

          elementMapRef.current = elementMap;
          entriesRef.current = entries;
          entriesByMeasureRef.current = entriesByMeasure;
          chordGroupsRef.current = chordGroups;

          const bpm = 90;
          const playbackEvents = buildPlaybackEvents(entries, bpm);
          onScoreReady?.(playbackEvents);

          setIsLoading(false);
        } catch (err) {
          if (cancelled) {
            return;
          }
          const details =
            err instanceof Error
              ? `${err.message}${err.stack ? `\n${err.stack}` : ""}`
              : String(err);
          setError(`Verovio ${stage} failed: ${details}`);
          setIsLoading(false);
        }
      };

      renderScore();

      return () => {
        cancelled = true;
      };
    }, [xmlUrl, xmlText, xmlData, onScoreReady]);

    const handlePointer = (event: React.MouseEvent | React.PointerEvent) => {
      const elementsAtPoint = document.elementsFromPoint(
        event.clientX,
        event.clientY
      );
      const noteElement = elementsAtPoint.find((el) =>
        el.classList?.contains("note")
      );
      const measureElement =
        noteElement?.closest?.(".measure") ??
        elementsAtPoint.find((el) => el.classList?.contains("measure"));

      if (activeTool === "note") {
        if (!noteElement) {
          return;
        }
        const noteId = noteElement.getAttribute("id");
        if (!noteId) {
          return;
        }
        const entry = entriesRef.current.find((item) => item.elementId === noteId);
        if (!entry) {
          return;
        }
        const entries = entry.chordEntries ?? [entry];
        highlightEntries(entries);
        onNotePlayed?.(entries);
        return;
      }

      if (!measureElement) {
        return;
      }
      const measureId = measureElement.getAttribute("id");
      if (!measureId) {
        return;
      }
      clearHighlights();
      onNoteSelected([]);
      const entries = entriesByMeasureRef.current.get(measureId) ?? [];
      if (!entries.length) {
        return;
      }
      const timestamps = entries
        .map((entry) => entry.timestamp)
        .filter((value): value is number => typeof value === "number");
      const offset = timestamps.length ? Math.min(...timestamps) : 0;
      const events = buildPlaybackEvents(entries, 80, offset);
      onBarTriggered?.(events);
    };

    if (error) {
      return (
        <div className="flex h-full items-center justify-center p-8">
          <div className="rounded-lg border border-red-200 bg-red-50 px-6 py-4 text-sm text-red-700">
            {error}
          </div>
        </div>
      );
    }

    return (
      <div className="relative h-full min-h-full">
        {isLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-amber-50">
            <div className="flex flex-col items-center gap-3">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-amber-300 border-t-amber-700" />
              <p className="text-sm text-amber-800">Loading score...</p>
            </div>
          </div>
        )}
        <div
          ref={containerRef}
          onClick={handlePointer}
          onPointerDown={handlePointer}
          className="verovio-container min-h-full bg-amber-50 p-4"
        />
      </div>
    );
  }
);

VerovioRenderer.displayName = "VerovioRenderer";

export default VerovioRenderer;
