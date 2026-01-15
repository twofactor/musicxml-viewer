# MusicXML Piano Viewer

A web app for viewing MusicXML sheet music with an interactive piano visualizer. Tap any note on the score to see exactly which key it is on a full 88-key piano.

![Screenshot](https://img.shields.io/badge/Next.js-16-black) ![License](https://img.shields.io/badge/license-MIT-blue)

## Features

- **Sheet Music Rendering** — Uses [OpenSheetMusicDisplay](https://opensheetmusicdisplay.org/) to render MusicXML files with full notation support (grand staff, accidentals, dynamics, etc.)
- **Interactive Note Selection** — Click/tap any note to highlight it and see the corresponding piano key
- **Chord Support** — Clicking a chord highlights all notes in the chord on both the score and piano
- **Full 88-Key Piano** — Standard piano range from A0 to C8
- **Drag & Drop Upload** — Drop your own `.musicxml`, `.xml`, or `.mxl` files to view them
- **Public Domain Library** — 69 classical pieces from [MuseTrainer](https://musetrainer.github.io/library/) ready to explore

## Getting Started

```bash
# Install dependencies
npm install

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage

1. **Library Screen** — Browse the song list or drag & drop your own MusicXML file
2. **Viewer Screen** — Scroll through the sheet music and tap notes to see them on the piano
3. **Piano Visualizer** — Shows which keys correspond to the selected note(s)

## Tech Stack

- [Next.js 16](https://nextjs.org/) with App Router
- [React 19](https://react.dev/)
- [Tailwind CSS 4](https://tailwindcss.com/)
- [OpenSheetMusicDisplay](https://opensheetmusicdisplay.org/) for MusicXML rendering
- TypeScript

## Adding Your Own Music

Place `.musicxml`, `.xml`, or `.mxl` files in `public/musicxml/` and add entries to `app/lib/songs.ts`:

```typescript
{
  id: "my-song",
  title: "My Song Title",
  composer: "Composer Name",
  file: "/musicxml/my-song.mxl",
  sourceUrl: "https://example.com",
}
```

Or simply drag and drop files onto the library screen.

## Credits

- Sheet music library from [MuseTrainer](https://musetrainer.github.io/library/) (Public Domain)
- MusicXML rendering by [OpenSheetMusicDisplay](https://opensheetmusicdisplay.org/)

## License

MIT
