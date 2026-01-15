"use client";

import { useEffect, useRef, useState } from "react";

type NoteSelection = {
  name: string;
  midi: number;
};

type NoteEntry = {
  selection: NoteSelection;
  gNote?: any;
  chordEntries?: NoteEntry[];
};

type NoteHitbox = {
  entry: NoteEntry;
  x: number;
  y: number;
  width: number;
  height: number;
};

type MusicRendererProps = {
  xmlUrl?: string;
  xmlText?: string;
  xmlData?: ArrayBuffer;
  onNoteSelected: (notes: NoteSelection[]) => void;
};

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

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

const getBoundingBox = (graphicalNote: any) => {
  const bbox =
    graphicalNote?.PositionAndShape?.BoundingBox ??
    graphicalNote?.positionAndShape?.BoundingBox ??
    graphicalNote?.boundingBox;
  const absPos = bbox?.AbsolutePosition ?? bbox?.absolutePosition;
  const size = bbox?.Size ?? bbox?.size;
  const x = absPos?.x ?? absPos?.X;
  const y = absPos?.y ?? absPos?.Y;
  const width = size?.Width ?? size?.width;
  const height = size?.Height ?? size?.height;

  if (
    [x, y, width, height].some(
      (value) => typeof value !== "number" || Number.isNaN(value),
    )
  ) {
    return null;
  }

  return { x, y, width, height };
};

const buildNoteIndex = (osmd: any) => {
  const lookup = new Map<string, NoteEntry>();
  const hitboxes: NoteHitbox[] = [];
  const chordGroups = new Map<any, NoteEntry[]>();

  const sheet = osmd?.GraphicSheet;
  if (!sheet?.MusicPages) {
    return lookup;
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
                const entry: NoteEntry = { selection, gNote };
                const noteKey = `osmd-note-${noteIndex++}`;

                const svgId =
                  typeof gNote.getSVGId === "function" ? gNote.getSVGId() : null;
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

  return { lookup, hitboxes };
};

export default function MusicRenderer({
  xmlUrl,
  xmlText,
  xmlData,
  onNoteSelected,
}: MusicRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const osmdRef = useRef<any>(null);
  const noteLookupRef = useRef<Map<string, NoteEntry>>(new Map());
  const hitboxesRef = useRef<NoteHitbox[]>([]);
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
          await osmd.load(scoreData);
        }
        await osmd.render();

        if (cancelled) {
          return;
        }

        // Build note lookup after render
        const { lookup, hitboxes } = buildNoteIndex(osmd);
        noteLookupRef.current = lookup;
        hitboxesRef.current = hitboxes;
        console.log(
          "Note lookup size:",
          noteLookupRef.current.size,
          "hitboxes:",
          hitboxesRef.current.length,
          "for",
          xmlUrl,
        );

        setIsLoading(false);
      } catch (err) {
        if (cancelled) {
          return;
        }
        console.error("MusicRenderer error:", err);
        setError(err instanceof Error ? err.message : "Unable to load score.");
        setIsLoading(false);
      }
    };

    loadScore();

    return () => {
      cancelled = true;
    };
  }, [xmlUrl, xmlText, xmlData]);

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
      const { lookup, hitboxes } = buildNoteIndex(osmdRef.current);
      noteLookupRef.current = lookup;
      hitboxesRef.current = hitboxes;
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [isLoading]);

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

  const clearHighlights = () => {
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
  };

  const applyHighlight = (entries: NoteEntry[]) => {
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
  };

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

  const handleSelectNote = (
    eventTarget: EventTarget | null,
    clientX?: number,
    clientY?: number,
  ) => {
    if (!eventTarget || !(eventTarget instanceof Element)) {
      return;
    }

    const target = eventTarget;
    const withData = target.closest?.("[data-note-key]") as Element | null;
    const dataKey = withData?.getAttribute("data-note-key");
    if (dataKey && noteLookupRef.current.has(dataKey)) {
      const entry = noteLookupRef.current.get(dataKey)!;
      applyHighlight(entry.chordEntries ?? [entry]);
      console.log("Note selected via data-note-key", dataKey);
      return;
    }

    let current: Element | null = target;
    while (current && current !== containerRef.current) {
      const id = current.getAttribute("id");
      if (id && noteLookupRef.current.has(id)) {
        const entry = noteLookupRef.current.get(id)!;
        applyHighlight(entry.chordEntries ?? [entry]);
        console.log("Note selected via id", id);
        return;
      }
      current = current.parentElement;
    }

    if (typeof clientX === "number" && typeof clientY === "number") {
      const hitbox = findHitboxAtPoint(clientX, clientY);
      if (hitbox) {
        applyHighlight(getChordEntriesFromHitbox(hitbox));
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
      target.tagName,
    );
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
        onClick={(event) =>
          handleSelectNote(event.target, event.clientX, event.clientY)
        }
        onPointerDown={(event) =>
          handleSelectNote(event.target, event.clientX, event.clientY)
        }
        className="osmd-container min-h-full cursor-pointer bg-amber-50 p-4"
      />
    </div>
  );
}
