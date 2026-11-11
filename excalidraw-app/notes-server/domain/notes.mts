import { ConflictError, InvalidInputError } from "./errors.mts";

/** a note as listed in the gallery (without its scene) */
export type NoteSummary = {
  id: string;
  title: string;
  /** `null`: not in any folder */
  folderId: string | null;
  /** created by "Nota de hoje"; the only notes allowed in the daily folder */
  isDaily: boolean;
  createdAt: number;
  updatedAt: number;
  hasThumbnail: boolean;
  /**
   * the scene changed since the thumbnail was rendered, or was saved without
   * one (e.g. through the API): clients render and save it
   */
  needsThumbnail: boolean;
  /** changes with each thumbnail saved (e.g. to tell cached ones apart) */
  thumbnailVersion: number;
};

/** an image of the scene (`BinaryFileData`), stored apart from the elements */
export type NoteFile = { id: string };

export type Note = NoteSummary & {
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
};

/** changes to a note; each field sent replaces the stored value */
export type NoteUpdate = {
  title?: string;
  /** moves the note (`null`: out of any folder); doesn't bump `updatedAt` */
  folderId?: string | null;
  elements?: unknown[];
  appState?: Record<string, unknown>;
  /** only new images are stored; ids the note already has are ignored */
  files?: Record<string, NoteFile>;
  /** PNG data URL, or `null` to clear */
  thumbnail?: string | null;
  /**
   * the `updatedAt` of the note the changes were made on: when the note has
   * changed since (elsewhere), the update is refused. Omit to always write.
   */
  baseUpdatedAt?: number;
};

const UNTITLED_NOTE_TITLE = "Sem título";
const DAILY_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** refuses changes made on an outdated version of the note */
export const assertUpToDate = (note: NoteSummary, baseUpdatedAt: unknown) => {
  if (baseUpdatedAt === undefined) {
    return;
  }
  if (typeof baseUpdatedAt !== "number") {
    throw new InvalidInputError("baseUpdatedAt must be a number");
  }
  if (note.updatedAt !== baseUpdatedAt) {
    throw new ConflictError("note was changed elsewhere");
  }
};

/** title of a duplicated note */
export const getCopyTitle = (title: string) =>
  `${title || UNTITLED_NOTE_TITLE} (cópia)`;

/** a daily note's date, YYYY-MM-DD (each day has a single daily note) */
export const parseDailyDate = (date: unknown) => {
  if (typeof date !== "string" || !DAILY_DATE_PATTERN.test(date)) {
    throw new InvalidInputError("date must be YYYY-MM-DD");
  }
  return date;
};

/** a daily note is titled after its date unless a title is given */
export const getDailyNoteTitle = (title: unknown, date: string) =>
  typeof title === "string" && title.trim() ? title.trim() : date;

/** the distinct ids of the notes to delete at once */
export const parseNoteIds = (ids: unknown) => {
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    !ids.every((id) => typeof id === "string")
  ) {
    throw new InvalidInputError("ids must be a non-empty array of note ids");
  }
  return [...new Set(ids as string[])];
};

/** the thumbnail image of a PNG data URL (`null`: no thumbnail) */
export const parseThumbnail = (dataURL: string | null) => {
  if (!dataURL) {
    return null;
  }
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataURL);
  if (!match) {
    throw new InvalidInputError("invalid thumbnail");
  }
  return Buffer.from(match[3], match[2] ? "base64" : "utf8");
};

/**
 * the images the scene still uses. Deleted elements are kept in the scene
 * (for undo), so their images are kept too.
 */
export const getReferencedFileIds = (elements: unknown[]) =>
  new Set(
    elements
      .map((element) => (element as { fileId?: string }).fileId)
      .filter(Boolean),
  );
