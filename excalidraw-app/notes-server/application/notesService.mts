import { randomUUID } from "node:crypto";

import { InvalidInputError, NotFoundError } from "../domain/errors.mts";
import {
  assertFolderAcceptsNote,
  DAILY_FOLDER_KIND,
  DAILY_FOLDER_NAME,
} from "../domain/folders.mts";
import {
  assertUpToDate,
  getCopyTitle,
  getDailyNoteTitle,
  getReferencedFileIds,
  parseDailyDate,
  parseNoteIds,
  parseThumbnail,
} from "../domain/notes.mts";
import { searchNotes } from "../domain/search.mts";

import type { FoldersService } from "./foldersService.mts";
import type {
  FoldersRepository,
  NotesRepository,
  RunInTransaction,
} from "./ports.mts";
import type { NoteUpdate } from "../domain/notes.mts";

const SEARCH_RESULTS_LIMIT = 30;

export const createNotesService = ({
  notes,
  folders,
  foldersService,
  transaction,
}: {
  notes: NotesRepository;
  folders: FoldersRepository;
  foldersService: FoldersService;
  transaction: RunInTransaction;
}) => {
  const find = (id: string) => {
    const note = notes.find(id);
    if (!note) {
      throw new NotFoundError("note not found");
    }
    return note;
  };

  /**
   * validates a client-supplied folder id (`null`: no folder) for a note,
   * daily or not: the daily notes folder only accepts daily notes
   */
  const parseFolderId = (folderId: unknown, isDailyNote: boolean) => {
    if (folderId === null || folderId === undefined || folderId === "") {
      return null;
    }
    const folder = typeof folderId === "string" ? folders.find(folderId) : null;
    if (!folder) {
      throw new InvalidInputError("folder not found");
    }
    assertFolderAcceptsNote(folder, isDailyNote);
    return folder.id;
  };

  const create = (title: unknown, folderId: unknown) => {
    const id = randomUUID();
    notes.insert({
      id,
      title: String(title ?? ""),
      folderId: parseFolderId(folderId, false),
      dailyDate: null,
      now: Date.now(),
    });
    return find(id);
  };

  /** the note of the given day, created in the daily notes folder if needed */
  const getOrCreateDaily = (dateInput: unknown, title: unknown) => {
    const date = parseDailyDate(dateInput);
    let noteId = notes.findIdByDailyDate(date);
    if (!noteId) {
      const id = randomUUID();
      transaction(() => {
        const folderId =
          folders.findIdByKind(DAILY_FOLDER_KIND) ??
          foldersService.create(DAILY_FOLDER_NAME, DAILY_FOLDER_KIND).id;
        notes.insert({
          id,
          title: getDailyNoteTitle(title, date),
          folderId,
          dailyDate: date,
          now: Date.now(),
        });
      });
      noteId = id;
    }
    return find(noteId);
  };

  const duplicate = (sourceId: string) => {
    const source = find(sourceId);
    const id = randomUUID();
    transaction(() => {
      notes.insertCopy(sourceId, {
        id,
        title: getCopyTitle(source.title),
        // a copy isn't a daily note, so it can't stay in the daily notes
        // folder
        folderId: source.isDaily ? null : source.folderId,
        now: Date.now(),
      });
    });
    return find(id);
  };

  const update = (id: string, update: NoteUpdate) => {
    const note = find(id);
    assertUpToDate(note, update.baseUpdatedAt);
    const folderId =
      update.folderId !== undefined
        ? parseFolderId(update.folderId, note.isDaily)
        : undefined;

    const fields: Parameters<NotesRepository["update"]>[1] = {};
    if (typeof update.title === "string") {
      fields.title = update.title.trim();
    }
    if (Array.isArray(update.elements)) {
      fields.elements = update.elements;
    }
    if (update.appState && typeof update.appState === "object") {
      fields.appState = update.appState;
    }
    if (update.thumbnail !== undefined) {
      fields.thumbnail = parseThumbnail(update.thumbnail);
    }

    transaction(() => {
      if (folderId !== undefined) {
        notes.move(id, folderId);
      }
      if (Object.keys(fields).length) {
        notes.update(id, fields, Date.now());
      }
      notes.addFiles(id, Object.values(update.files ?? {}));
      if (Array.isArray(update.elements)) {
        notes.removeFilesExcept(id, getReferencedFileIds(update.elements));
      }
    });

    return find(id);
  };

  /** deletes several notes at once: all of them, or none if one is missing */
  const deleteMany = (idsInput: unknown) => {
    const ids = parseNoteIds(idsInput);
    transaction(() => {
      for (const id of ids) {
        find(id);
        notes.delete(id);
      }
    });
    return { deleted: ids.length };
  };

  /**
   * saves the thumbnail rendered for the scene of `baseUpdatedAt` (refused if
   * the note changed since), without bumping `updatedAt`
   */
  const saveThumbnail = (
    id: string,
    {
      thumbnail,
      baseUpdatedAt,
    }: Pick<NoteUpdate, "thumbnail" | "baseUpdatedAt">,
  ) => {
    const note = find(id);
    assertUpToDate(note, baseUpdatedAt);
    if (thumbnail === undefined) {
      throw new InvalidInputError("thumbnail is required");
    }
    notes.saveThumbnail(id, parseThumbnail(thumbnail));
    return find(id);
  };

  return {
    list: () => notes.list(),
    /** by title and by the text written in the drawings (see `searchNotes`) */
    search: (query: unknown) =>
      searchNotes(
        notes.listSearchable(),
        typeof query === "string" ? query : "",
        SEARCH_RESULTS_LIMIT,
      ),
    saveThumbnail,
    load: (id: string) => {
      const note = notes.findWithScene(id);
      if (!note) {
        throw new NotFoundError("note not found");
      }
      return note;
    },
    create,
    getOrCreateDaily,
    duplicate,
    update,
    delete: (id: string) => {
      find(id);
      notes.delete(id);
    },
    deleteMany,
    findThumbnail: (id: string) => {
      const thumbnail = notes.findThumbnail(id);
      if (!thumbnail) {
        throw new NotFoundError("thumbnail not found");
      }
      return thumbnail;
    },
  };
};

export type NotesService = ReturnType<typeof createNotesService>;
