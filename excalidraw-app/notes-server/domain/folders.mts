import { ForbiddenError, InvalidInputError } from "./errors.mts";

/**
 * A single level of folders. App-managed folders have a `kind` (the daily
 * notes one) and can't be renamed or deleted.
 */
export type Folder = {
  id: string;
  name: string;
  kind: string | null;
  createdAt: number;
  noteCount: number;
};

export const DAILY_FOLDER_KIND = "daily";
export const DAILY_FOLDER_NAME = "Notas Diárias";

export const parseFolderName = (name: unknown) => {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) {
    throw new InvalidInputError("folder name is required");
  }
  return trimmed;
};

export const assertEditableFolder = (folder: Folder) => {
  if (folder.kind) {
    throw new ForbiddenError("this folder can't be renamed or deleted");
  }
};

/** the daily notes folder only holds daily notes */
export const assertFolderAcceptsNote = (
  folder: Folder,
  isDailyNote: boolean,
) => {
  if (folder.kind === DAILY_FOLDER_KIND && !isDailyNote) {
    throw new ForbiddenError("only daily notes can be in this folder");
  }
};
