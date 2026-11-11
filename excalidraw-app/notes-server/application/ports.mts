/**
 * What the application layer needs from storage. Implemented by
 * `infrastructure/sqlite`.
 */

import type { ColorDefaults } from "../domain/colorDefaults.mts";
import type { Folder } from "../domain/folders.mts";
import type { Library } from "../domain/library.mts";
import type { Note, NoteFile, NoteSummary } from "../domain/notes.mts";

export interface NotesRepository {
  /** most recently updated first */
  list(): NoteSummary[];
  find(id: string): NoteSummary | null;
  findWithScene(id: string): Note | null;
  findIdByDailyDate(date: string): string | null;
  insert(note: {
    id: string;
    title: string;
    folderId: string | null;
    dailyDate: string | null;
    now: number;
  }): void;
  /** a new note with the source's scene, images and thumbnail */
  insertCopy(
    sourceId: string,
    copy: { id: string; title: string; folderId: string | null; now: number },
  ): void;
  /** replaces the given fields, bumping `updatedAt` */
  update(
    id: string,
    fields: {
      title?: string;
      elements?: unknown[];
      appState?: Record<string, unknown>;
      thumbnail?: Uint8Array | null;
    },
    now: number,
  ): void;
  /** doesn't bump `updatedAt` */
  move(id: string, folderId: string | null): void;
  /** files the note already has are kept as they are */
  addFiles(id: string, files: NoteFile[]): void;
  removeFilesExcept(id: string, keptFileIds: Set<unknown>): void;
  delete(id: string): void;
  /** `null` if the note or its thumbnail doesn't exist */
  findThumbnail(id: string): Uint8Array | null;
}

export interface FoldersRepository {
  /** app-managed folders first, then by name (case-insensitive) */
  list(): Folder[];
  find(id: string): Folder | null;
  findIdByKind(kind: string): string | null;
  insert(folder: {
    id: string;
    name: string;
    kind: string | null;
    now: number;
  }): void;
  rename(id: string, name: string): void;
  /** its notes go back to the root */
  delete(id: string): void;
}

export interface LibraryRepository {
  find(): Library | null;
  save(library: Library, now: number): void;
}

export interface ColorDefaultsRepository {
  list(): ColorDefaults;
  /** replaces the slot's defaults */
  replace(slot: string, defaults: (string | null)[]): void;
}

/** runs `fn` atomically: all of its writes, or none if it throws */
export type RunInTransaction = (fn: () => void) => void;
