# Memorilo

Memorilo is an open-source desktop application for reading, note-taking, and
spaced-repetition learning. It keeps notes, books, annotations, and flashcards
in one local workspace.

## Features

- Write in Document or Outline mode with rich text, math, tables, images, and
  task lists.
- Keep daily journals and quickly find recent or favorite notes.
- Read and annotate EPUB, PDF, TXT, CBZ, and CBR files from OPDS book sources.
- Use an incremental reading workflow to turn annotations into notes and
  learning cards.
- Create flashcards, cloze cards, and image occlusions, then review them with
  FSRS scheduling.
- Work with whiteboards alongside regular text topics.
- Search notes locally and optionally connect MCP-compatible AI tools.

Memorilo is under active development, and its interfaces and storage formats
may change.

## Development

Requirements:

- Node.js 22.12.0 or newer
- Corepack
- pnpm 10.12.4

```sh
corepack enable
corepack prepare pnpm@10.12.4 --activate
pnpm install
pnpm dev
```

Common commands:

```sh
pnpm build       # Build all packages
pnpm lint        # Lint the workspace
pnpm typecheck   # Type-check the workspace
pnpm test        # Run unit and component tests
MEMORILO_E2E_HIDE_WINDOW=1 pnpm test:e2e  # Run Electron end-to-end tests
```

## Project structure

- `apps/desktop` contains the Electron application.
- `packages/editor` contains the editor and note model.
- `packages/editor-storage` contains SQLite persistence and search.
- `packages/reader`, `packages/shelf`, and `packages/reading-model` contain the
  reading experience.
- `packages/srs` contains the spaced-repetition feature module.
- `apps/desktop/e2e` contains Electron end-to-end tests.

## Database Schema

The main process owns the SQLite database through `packages/editor-storage` and the native
Better SQLite adapter. The main database schema generation is derived from the
applied Drizzle migrations. The learning schema has its own generation value.
See
[`docs/adr/0006-card-topics-own-learning-cards.md`](docs/adr/0006-card-topics-own-learning-cards.md)
and [`docs/fsrs-learning-system.md`](docs/fsrs-learning-system.md) for the ownership and
maintenance contract.

## License

Memorilo is licensed under the GNU Affero General Public License v3.0 only. See
[`LICENSE`](LICENSE).
