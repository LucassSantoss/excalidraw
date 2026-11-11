import { InvalidInputError } from "./errors.mts";

/**
 * The editor's shape library (`LibraryPersistedData`), shared by all notes.
 * Stored as sent.
 */
export type Library = { libraryItems: unknown[] } & Record<string, unknown>;

export const parseLibrary = (data: Record<string, unknown>) => {
  if (!Array.isArray(data.libraryItems)) {
    throw new InvalidInputError("libraryItems must be an array");
  }
  return data as Library;
};
