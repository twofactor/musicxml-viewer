/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

export type NoteSelection = {
  name: string;
  midi: number;
};

export type NoteEntry = {
  selection: NoteSelection;
  gNote?: any;
  elementId?: string;
  chordEntries?: NoteEntry[];
  sourceNote?: any;
  sourceMeasure?: any;
  measureId?: string;
  timestamp?: number;
  duration?: number;
};

type NoteHitbox = {
  entry: NoteEntry;
  x: number;
  y: number;
  width: number;
  height: number;
};

type MeasureHitbox = {
  measureKey: number;
  sourceMeasure: any;
  entries: NoteEntry[];
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PlaybackEvent = {
  startSec: number;
  durationSec: number;
  entries: NoteEntry[];
  selections: NoteSelection[];
};

export type MusicRendererHandle = {
  highlightEntries: (entries: NoteEntry[]) => void;
  clearHighlights: () => void;
};

type MusicRendererProps = {
  xmlUrl?: string;
  xmlText?: string;
  xmlData?: ArrayBuffer;
  activeTool: "note" | "bar";
  onNoteSelected: (notes: NoteSelection[]) => void;
  onNotePlayed?: (entries: NoteEntry[]) => void;
  onBarTriggered?: (events: PlaybackEvent[]) => void;
  onScoreReady?: (events: PlaybackEvent[]) => void;
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

const toMidiFromPitch = (pitch: any) => {
  if (!pitch) {
    return null;
  }

  if (typeof pitch.getHalfTone === "function") {
    const halfTone = pitch.getHalfTone();
    if (typeof halfTone === "number") {
      return halfTone + 12;
    }
  }

  const fundamental = pitch?.FundamentalNote;
  const octave = pitch?.Octave;
  const accidental = pitch?.AccidentalHalfTones ?? 0;

  if (typeof fundamental !== "number" || typeof octave !== "number") {
    return null;
  }

  return (octave + 1) * 12 + fundamental + accidental;
};

const toNoteNameFromMidi = (midi: number) => {
  const octave = Math.floor(midi / 12) - 1;
  const name = NOTE_NAMES[midi % 12];
  return `${name}${octave}`;
};

const getBoundingBox = (graphicalObject: any) => {
  const bbox =
    graphicalObject?.PositionAndShape?.BoundingBox ??
    graphicalObject?.positionAndShape?.BoundingBox ??
    graphicalObject?.boundingBox;
  const absPos = bbox?.AbsolutePosition ?? bbox?.absolutePosition;
  const size = bbox?.Size ?? bbox?.size;
  const x = absPos?.x ?? absPos?.X;
  const y = absPos?.y ?? absPos?.Y;
  const width = size?.Width ?? size?.width;
  const height = size?.Height ?? size?.height;

  if (
    [x, y, width, height].some(
      (value) => typeof value !== "number" || Number.isNaN(value)
    )
  ) {
    return null;
  }

  return { x, y, width, height };
};

const buildPlaybackEvents = (
  entries: NoteEntry[],
  bpm: number,
  offsetBeats = 0
) => {
  const grouped = new Map<number, PlaybackEvent>();
  const secondsPerBeat = 60 / bpm;
  const minDurationSec = 0.08;

  entries.forEach((entry) => {
    if (entry.timestamp === undefined || entry.duration === undefined) {
      return;
    }
    const startBeat = entry.timestamp * 4 - offsetBeats;
    if (startBeat < 0) {
      return;
    }
    const durationBeat = Math.max(0, entry.duration * 4);
    const startKey = Math.round(startBeat * 1000) / 1000;
    const startSec = startBeat * secondsPerBeat;
    const durationSec = Math.max(durationBeat * secondsPerBeat, minDurationSec);

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

const buildMeasureHitboxes = (
  osmd: any,
  entriesByMeasure: Map<any, NoteEntry[]>
) => {
  const measureHitboxes: MeasureHitbox[] = [];
  const sheet = osmd?.GraphicSheet;
  if (!sheet?.MusicPages) {
    return measureHitboxes;
  }

  sheet.MusicPages.forEach((page: any) => {
    page.MusicSystems?.forEach((system: any) => {
      system.StaffLines?.forEach((staffLine: any) => {
        staffLine.Measures?.forEach((measure: any, measureIndex: number) => {
          const box = getBoundingBox(measure);
          if (!box) {
            return;
          }
          const sourceMeasure =
            measure?.parentSourceMeasure ?? measure?.ParentSourceMeasure;
          const entries = sourceMeasure
            ? entriesByMeasure.get(sourceMeasure) ?? []
            : [];
          const measureKey =
            sourceMeasure?.measureListIndex ??
            sourceMeasure?.MeasureNumber ??
            measure?.MeasureNumber ??
            measureIndex;
          measureHitboxes.push({
            measureKey,
            sourceMeasure,
            entries,
            ...box,
          });
        });
      });
    });
  });

  return measureHitboxes;
};

const buildNoteIndex = (osmd: any) => {
  const lookup = new Map<string, NoteEntry>();
  const hitboxes: NoteHitbox[] = [];
  const entries: NoteEntry[] = [];
  const entriesByMeasure = new Map<any, NoteEntry[]>();
  const chordGroups = new Map<any, NoteEntry[]>();

  const sheet = osmd?.GraphicSheet;
  if (!sheet?.MusicPages) {
    return {
      lookup,
      hitboxes,
      entries,
      measureHitboxes: [],
      entriesByMeasure,
    };
  }

  let noteIndex = 0;

  for (const page of sheet.MusicPages) {
    for (const system of page.MusicSystems ?? []) {
      for (const staffLine of system.StaffLines ?? []) {
        for (const measure of staffLine.Measures ?? []) {
          for (const staffEntry of measure.staffEntries ?? []) {
            for (const voiceEntry of staffEntry.graphicalVoiceEntries ?? []) {
              for (const gNote of voiceEntry.notes ?? []) {
                const sourceNote = gNote?.sourceNote;
                if (!sourceNote || sourceNote.isRest?.()) {
                  continue;
                }

                const pitch = sourceNote.Pitch;
                const midi = toMidiFromPitch(pitch);
                if (midi === null) {
                  continue;
                }
                const name = toNoteNameFromMidi(midi);

                const selection: NoteSelection = { name, midi };
                const measureSource =
                  measure?.parentSourceMeasure ??
                  measure?.ParentSourceMeasure ??
                  sourceNote?.SourceMeasure ??
                  sourceNote?.sourceMeasure ??
                  measure;
                const timestamp =
                  sourceNote?.getAbsoluteTimestamp?.()?.RealValue;
                const duration = sourceNote?.Length?.RealValue;
                const entry: NoteEntry = {
                  selection,
                  gNote,
                  sourceNote,
                  sourceMeasure: measureSource,
                  timestamp:
                    typeof timestamp === "number" ? timestamp : undefined,
                  duration: typeof duration === "number" ? duration : undefined,
                };
                const noteKey = `osmd-note-${noteIndex++}`;
                entries.push(entry);

                if (measureSource) {
                  if (!entriesByMeasure.has(measureSource)) {
                    entriesByMeasure.set(measureSource, []);
                  }
                  entriesByMeasure.get(measureSource)!.push(entry);
                }

                const svgId =
                  typeof gNote.getSVGId === "function"
                    ? gNote.getSVGId()
                    : null;
                if (svgId) {
                  lookup.set(svgId, entry);
                }

                const svgGroup =
                  typeof gNote.getSVGGElement === "function"
                    ? gNote.getSVGGElement()
                    : null;
                if (svgGroup) {
                  svgGroup.setAttribute("data-note-key", noteKey);
                  lookup.set(noteKey, entry);
                }

                const noteheads =
                  typeof gNote.getNoteheadSVGs === "function"
                    ? gNote.getNoteheadSVGs()
                    : [];
                if (noteheads?.length) {
                  for (const nh of noteheads) {
                    nh.setAttribute("data-note-key", noteKey);
                    lookup.set(noteKey, entry);
                  }
                }

                if (svgId && !svgGroup && (!noteheads || !noteheads.length)) {
                  const fallbackElement = document.getElementById(svgId);
                  if (fallbackElement) {
                    fallbackElement.setAttribute("data-note-key", noteKey);
                    lookup.set(noteKey, entry);
                  }
                }

                const box = getBoundingBox(gNote);
                if (box) {
                  hitboxes.push({ entry, ...box });
                }

                const chordKey = gNote?.parentVoiceEntry;
                if (chordKey) {
                  if (!chordGroups.has(chordKey)) {
                    chordGroups.set(chordKey, []);
                  }
                  chordGroups.get(chordKey)!.push(entry);
                }
              }
            }
          }
        }
      }
    }
  }

  chordGroups.forEach((entries) => {
    entries.forEach((entry) => {
      entry.chordEntries = entries;
    });
  });

  const measureHitboxes = buildMeasureHitboxes(osmd, entriesByMeasure);

  return { lookup, hitboxes, entries, measureHitboxes, entriesByMeasure };
};

const MusicRenderer = forwardRef<MusicRendererHandle, MusicRendererProps>(
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
    const osmdRef = useRef<any>(null);
    const noteLookupRef = useRef<Map<string, NoteEntry>>(new Map());
    const hitboxesRef = useRef<NoteHitbox[]>([]);
    const measureHitboxesRef = useRef<MeasureHitbox[]>([]);
    const entriesByMeasureRef = useRef<Map<any, NoteEntry[]>>(new Map());
    const playbackEventsRef = useRef<PlaybackEvent[]>([]);
    const bpmRef = useRef<number>(90);
    const highlightedRef = useRef<any>(null);
    const highlightedGroupRef = useRef<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
      let cancelled = false;

      const loadScore = async () => {
        try {
          setIsLoading(true);
          setError(null);
          highlightedRef.current = null;

          const [{ OpenSheetMusicDisplay }, response] = await Promise.all([
            import("opensheetmusicdisplay"),
            xmlUrl ? fetch(xmlUrl) : Promise.resolve(null),
          ]);

          let scoreData: string | ArrayBuffer | Uint8Array | null = null;

          if (xmlData) {
            scoreData = new Uint8Array(xmlData);
          } else if (xmlText) {
            scoreData = xmlText;
          } else if (response) {
            if (!response.ok) {
              throw new Error(`Failed to load MusicXML (${response.status})`);
            }
            const isMxl =
              xmlUrl?.toLowerCase().endsWith(".mxl") ||
              response.headers
                .get("content-type")
                ?.includes("application/vnd.recordare.musicxml");
            scoreData = isMxl
              ? new Uint8Array(await response.arrayBuffer())
              : await response.text();
          }

          if (cancelled) {
            return;
          }

          if (!scoreData) {
            throw new Error("No MusicXML data provided.");
          }

          const container = containerRef.current;
          if (!container) {
            throw new Error("Container not available");
          }

          container.innerHTML = "";
          const osmd = new OpenSheetMusicDisplay(container, {
            autoResize: true,
            backend: "svg",
            drawTitle: false,
            drawComposer: false,
            drawCredits: false,
          });
          osmdRef.current = osmd;

          if (xmlUrl && !xmlText && !xmlData) {
            await osmd.load(xmlUrl);
          } else {
            // OSMD accepts Uint8Array for .mxl files at runtime, but types don't reflect this
            await osmd.load(scoreData as any);
          }
          await osmd.render();

          if (cancelled) {
            return;
          }

          // Build note lookup after render
          const {
            lookup,
            hitboxes,
            entries,
            measureHitboxes,
            entriesByMeasure,
          } = buildNoteIndex(osmd);
          noteLookupRef.current = lookup;
          hitboxesRef.current = hitboxes;
          measureHitboxesRef.current = measureHitboxes;
          entriesByMeasureRef.current = entriesByMeasure;
          const bpm =
            osmd?.Sheet?.getExpressionsStartTempoInBPM?.() ??
            osmd?.Sheet?.DefaultStartTempoInBpm ??
            90;
          bpmRef.current = bpm;
          const playbackEvents = buildPlaybackEvents(entries, bpm);
          playbackEventsRef.current = playbackEvents;
          onScoreReady?.(playbackEvents);
          console.log(
            "Note lookup size:",
            noteLookupRef.current.size,
            "hitboxes:",
            hitboxesRef.current.length,
            "for",
            xmlUrl
          );

          setIsLoading(false);
        } catch (err) {
          if (cancelled) {
            return;
          }
          console.error("MusicRenderer error:", err);
          setError(
            err instanceof Error ? err.message : "Unable to load score."
          );
          setIsLoading(false);
        }
      };

      loadScore();

      return () => {
        cancelled = true;
      };
    }, [xmlUrl, xmlText, xmlData, onScoreReady]);

    useEffect(() => {
      const container = containerRef.current;
      if (!container || !osmdRef.current || isLoading) {
        return;
      }

      const observer = new ResizeObserver(() => {
        if (!osmdRef.current) {
          return;
        }
        osmdRef.current.render();
        const { lookup, hitboxes, entries, measureHitboxes, entriesByMeasure } =
          buildNoteIndex(osmdRef.current);
        noteLookupRef.current = lookup;
        hitboxesRef.current = hitboxes;
        measureHitboxesRef.current = measureHitboxes;
        entriesByMeasureRef.current = entriesByMeasure;
        const playbackEvents = buildPlaybackEvents(entries, bpmRef.current);
        playbackEventsRef.current = playbackEvents;
        onScoreReady?.(playbackEvents);
      });

      observer.observe(container);
      return () => observer.disconnect();
    }, [isLoading, onScoreReady]);

    const findHitboxAtPoint = (clientX: number, clientY: number) => {
      const svg = containerRef.current?.querySelector("svg");
      if (!svg || !hitboxesRef.current.length) {
        return null;
      }

      const rect = svg.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        return null;
      }

      const viewBox = svg.viewBox.baseVal;
      const clickX =
        ((clientX - rect.left) / rect.width) * viewBox.width + viewBox.x;
      const clickY =
        ((clientY - rect.top) / rect.height) * viewBox.height + viewBox.y;

      const padding = 4;

      let best: NoteHitbox | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;

      hitboxesRef.current.forEach((hitbox) => {
        const inside =
          clickX >= hitbox.x - padding &&
          clickX <= hitbox.x + hitbox.width + padding &&
          clickY >= hitbox.y - padding &&
          clickY <= hitbox.y + hitbox.height + padding;

        if (!inside) {
          return;
        }

        const centerX = hitbox.x + hitbox.width / 2;
        const centerY = hitbox.y + hitbox.height / 2;
        const dx = centerX - clickX;
        const dy = centerY - clickY;
        const distance = dx * dx + dy * dy;

        if (distance < bestDistance) {
          bestDistance = distance;
          best = hitbox;
        }
      });

      return best;
    };

    const clearHighlights = useCallback(() => {
      const previous = highlightedGroupRef.current.length
        ? highlightedGroupRef.current
        : highlightedRef.current
        ? [highlightedRef.current]
        : [];
      previous.forEach((note) => {
        if (note?.setColor) {
          note.setColor("#111827", {
            applyToBeams: true,
            applyToFlag: true,
            applyToLedgerLines: true,
            applyToModifiers: true,
            applyToNoteheads: true,
            applyToSlurs: true,
            applyToStem: true,
            applyToTies: true,
          });
        }
      });
      highlightedRef.current = null;
      highlightedGroupRef.current = [];
    }, []);

    const applyHighlight = useCallback(
      (entries: NoteEntry[]) => {
        clearHighlights();

        const selections: NoteSelection[] = [];
        const highlighted: any[] = [];

        entries.forEach((entry) => {
          selections.push(entry.selection);
          if (entry.gNote?.setColor) {
            entry.gNote.setColor("#f59e0b", {
              applyToBeams: true,
              applyToFlag: true,
              applyToLedgerLines: true,
              applyToModifiers: true,
              applyToNoteheads: true,
              applyToSlurs: true,
              applyToStem: true,
              applyToTies: true,
            });
            highlighted.push(entry.gNote);
          }
        });

        highlightedGroupRef.current = highlighted;
        highlightedRef.current = highlighted[0] ?? null;

        onNoteSelected(selections);
      },
      [clearHighlights, onNoteSelected]
    );

    useImperativeHandle(
      ref,
      () => ({
        highlightEntries: (entries: NoteEntry[]) => {
          applyHighlight(entries);
        },
        clearHighlights: () => {
          clearHighlights();
        },
      }),
      [applyHighlight, clearHighlights]
    );

    const getChordEntriesFromHitbox = (hitbox: NoteHitbox) => {
      const centerX = hitbox.x + hitbox.width / 2;
      const threshold = Math.max(6, hitbox.width / 2 + 2);
      const entries = hitboxesRef.current
        .filter((candidate) => {
          const candidateCenterX = candidate.x + candidate.width / 2;
          return Math.abs(candidateCenterX - centerX) <= threshold;
        })
        .map((candidate) => candidate.entry);

      const unique = new Map<string, NoteEntry>();
      entries.forEach((entry) => {
        unique.set(`${entry.selection.midi}-${entry.selection.name}`, entry);
      });
      return Array.from(unique.values());
    };

    const buildBarEvents = (entries: NoteEntry[], measure: any) => {
      const bpm = Math.min(60, bpmRef.current || 60);
      const startTimestamp =
        measure?.AbsoluteTimestamp?.RealValue ??
        measure?.absoluteTimestamp?.RealValue ??
        0;
      const offsetBeats = startTimestamp * 4;
      return buildPlaybackEvents(entries, bpm, offsetBeats);
    };

    const handleSelectNote = (
      eventTarget: EventTarget | null,
      clientX?: number,
      clientY?: number
    ) => {
      if (!eventTarget || !(eventTarget instanceof Element)) {
        return;
      }

      const target = eventTarget;
      const withData = target.closest?.("[data-note-key]") as Element | null;
      const dataKey = withData?.getAttribute("data-note-key");
      if (dataKey && noteLookupRef.current.has(dataKey)) {
        const entry = noteLookupRef.current.get(dataKey)!;
        const entries = entry.chordEntries ?? [entry];
        applyHighlight(entries);
        onNotePlayed?.(entries);
        console.log("Note selected via data-note-key", dataKey);
        return;
      }

      let current: Element | null = target;
      while (current && current !== containerRef.current) {
        const id = current.getAttribute("id");
        if (id && noteLookupRef.current.has(id)) {
          const entry = noteLookupRef.current.get(id)!;
          const entries = entry.chordEntries ?? [entry];
          applyHighlight(entries);
          onNotePlayed?.(entries);
          console.log("Note selected via id", id);
          return;
        }
        current = current.parentElement;
      }

      if (typeof clientX === "number" && typeof clientY === "number") {
        const hitbox = findHitboxAtPoint(clientX, clientY);
        if (hitbox) {
          const entries = getChordEntriesFromHitbox(hitbox);
          applyHighlight(entries);
          onNotePlayed?.(entries);
          console.log("Note selected via hitbox");
          return;
        }
      }

      console.log(
        "No note hit",
        noteLookupRef.current.size,
        "hitboxes:",
        hitboxesRef.current.length,
        "target:",
        target.tagName
      );
    };

    const handleSelectBar = (
      eventTarget?: EventTarget | null,
      clientX?: number,
      clientY?: number
    ) => {
      const targetElement = eventTarget as Element | null;
      const targetNoteKey =
        targetElement
          ?.closest?.("[data-note-key]")
          ?.getAttribute("data-note-key") ?? null;
      const targetEntry = targetNoteKey
        ? noteLookupRef.current.get(targetNoteKey) ?? null
        : null;
      const targetMeasure = targetEntry?.sourceMeasure ?? null;
      const targetEntries = targetMeasure
        ? entriesByMeasureRef.current.get(targetMeasure) ?? []
        : [];
      if (targetEntries.length) {
        clearHighlights();
        onNoteSelected([]);
        const events = buildBarEvents(targetEntries, targetMeasure);
        onBarTriggered?.(events);
        return;
      }
      if (typeof clientX !== "number" || typeof clientY !== "number") {
        return;
      }
      const svg = containerRef.current?.querySelector("svg");
      if (!svg || !measureHitboxesRef.current.length) {
        return;
      }
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        return;
      }
      const viewBox = svg.viewBox.baseVal;
      const clickX =
        ((clientX - rect.left) / rect.width) * viewBox.width + viewBox.x;
      const clickY =
        ((clientY - rect.top) / rect.height) * viewBox.height + viewBox.y;
      const measureBounds = measureHitboxesRef.current.length
        ? measureHitboxesRef.current.reduce(
            (acc, measure) => {
              return {
                minX: Math.min(acc.minX, measure.x),
                maxX: Math.max(acc.maxX, measure.x + measure.width),
                minY: Math.min(acc.minY, measure.y),
                maxY: Math.max(acc.maxY, measure.y + measure.height),
              };
            },
            {
              minX: Number.POSITIVE_INFINITY,
              maxX: Number.NEGATIVE_INFINITY,
              minY: Number.POSITIVE_INFINITY,
              maxY: Number.NEGATIVE_INFINITY,
            }
          )
        : null;
      const mappedClickX = measureBounds
        ? ((clickX - viewBox.x) / viewBox.width) *
            (measureBounds.maxX - measureBounds.minX) +
          measureBounds.minX
        : clickX;
      const mappedClickY = measureBounds
        ? ((clickY - viewBox.y) / viewBox.height) *
            (measureBounds.maxY - measureBounds.minY) +
          measureBounds.minY
        : clickY;

      const nearestNote = hitboxesRef.current.reduce<{
        entry: NoteEntry;
        distance: number;
      } | null>((best, hitbox) => {
        const centerX = hitbox.x + hitbox.width / 2;
        const centerY = hitbox.y + hitbox.height / 2;
        const dx = centerX - mappedClickX;
        const dy = centerY - mappedClickY;
        const distance = dx * dx + dy * dy;
        if (!best || distance < best.distance) {
          return { entry: hitbox.entry, distance };
        }
        return best;
      }, null);
      if (nearestNote?.entry?.sourceMeasure) {
        const measure = nearestNote.entry.sourceMeasure;
        const entries = entriesByMeasureRef.current.get(measure) ?? [];
        if (entries.length) {
          clearHighlights();
          onNoteSelected([]);
          const events = buildBarEvents(entries, measure);
          onBarTriggered?.(events);
          return;
        }
      }
      const padding = 6;
      const lookupX = measureBounds ? mappedClickX : clickX;
      const lookupY = measureBounds ? mappedClickY : clickY;
      const candidates = measureHitboxesRef.current.filter((measure) => {
        return (
          lookupX >= measure.x - padding &&
          lookupX <= measure.x + measure.width + padding &&
          lookupY >= measure.y - padding &&
          lookupY <= measure.y + measure.height + padding
        );
      });
      const nearestCandidate = candidates.length
        ? candidates.reduce((best, measure) => {
            const centerX = measure.x + measure.width / 2;
            const centerY = measure.y + measure.height / 2;
            const dx = centerX - lookupX;
            const dy = centerY - lookupY;
            const distance = dx * dx + dy * dy;
            if (!best || distance < best.distance) {
              return { measure, distance };
            }
            return best;
          }, null as { measure: MeasureHitbox; distance: number } | null)
        : null;
      let hit =
        nearestCandidate?.measure ??
        measureHitboxesRef.current.find((measure) => {
          return (
            lookupX >= measure.x - padding &&
            lookupX <= measure.x + measure.width + padding &&
            lookupY >= measure.y - padding &&
            lookupY <= measure.y + measure.height + padding
          );
        });
      if (!hit) {
        const noteHit = findHitboxAtPoint(
          clientX,
          clientY
        ) as NoteHitbox | null;
        const sourceMeasure = noteHit?.entry?.sourceMeasure;
        const fallbackEntries = sourceMeasure
          ? entriesByMeasureRef.current.get(sourceMeasure) ?? []
          : [];
        if (fallbackEntries.length) {
          hit = {
            measureKey: sourceMeasure?.MeasureNumber ?? 0,
            sourceMeasure,
            entries: fallbackEntries,
            x: 0,
            y: 0,
            width: 0,
            height: 0,
          };
        } else {
          return;
        }
      }
      clearHighlights();
      onNoteSelected([]);
      const events = buildBarEvents(hit.entries, hit.sourceMeasure);
      onBarTriggered?.(events);
    };

    const handlePointer = (event: React.MouseEvent | React.PointerEvent) => {
      if (activeTool === "bar") {
        handleSelectBar(event.target, event.clientX, event.clientY);
        return;
      }
      handleSelectNote(event.target, event.clientX, event.clientY);
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
          className="osmd-container min-h-full cursor-pointer bg-amber-50 p-4"
        />
      </div>
    );
  }
);

MusicRenderer.displayName = "MusicRenderer";

export default MusicRenderer;
