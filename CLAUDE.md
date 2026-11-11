# CLAUDE.md

## Project Structure

Excalidraw is a **monorepo** with a clear separation between the core library and the application:

- **`packages/excalidraw/`** - Main React component library published to npm as `@excalidraw/excalidraw`
- **`excalidraw-app/`** - Full-featured web application (excalidraw.com) that uses the library
- **`packages/`** - Core packages: `@excalidraw/common`, `@excalidraw/element`, `@excalidraw/math`, `@excalidraw/utils`
- **`examples/`** - Integration examples (NextJS, browser script)
- **`excalidraw-app/notes-server/`** - Local notes API. To read or create notes programmatically, follow its `README.md`, and keep that file up to date when changing the API
- **`excalidraw-app/notes/`** - This fork's notes app (gallery, note editor, quick search), the app's entry point
- **`desktop/`** - The macOS app (Electron), running the notes server; its own `yarn install`

## Development Workflow

1. **Package Development**: Work in `packages/*` for editor features
2. **App Development**: Work in `excalidraw-app/` for app-specific features
3. **Testing**: Always run `yarn test:update` before committing
4. **Type Safety**: Use `yarn test:typecheck` to verify TypeScript

## This Fork

- Node 24 (the notes server uses `node:sqlite`); the GitHub workflows run on it too
- After pulling or merging upstream, run `yarn install` before building: dependencies change
- Don't leave `packages/excalidraw/dist` around (e.g. after `build:esm` or size-limit) when running tests: some tests then import the built package and fail with a null `appState`
- The fork's changes to `packages/excalidraw` are listed in `README.md` ("Atualizar com o Excalidraw oficial"); keep that list current
- PR titles follow upstream's format, type and scope: `feat(app): …`, `fix(editor): …`, `ci(repo): …`

## Development Commands

```bash
yarn test:typecheck  # TypeScript type checking
yarn test:update     # Run all tests (with snapshot updates)
yarn fix             # Auto-fix formatting and linting issues
```

## Architecture Notes

### Package System

- Uses Yarn workspaces for monorepo management
- Internal packages use path aliases (see `vitest.config.mts`)
- Build system uses esbuild for packages, Vite for the app
- TypeScript throughout with strict configuration
