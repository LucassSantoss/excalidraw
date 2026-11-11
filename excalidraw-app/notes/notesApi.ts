import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { LibraryPersistedData } from "@excalidraw/excalidraw/data/library";
import type {
  AppState,
  BinaryFiles,
  ColorTopPicksDefaults,
  ColorTopPicksSlot,
} from "@excalidraw/excalidraw/types";

const API_URL = "/api";

export type NoteSummary = {
  id: string;
  title: string;
  folderId: string | null;
  /** created by "Nota de hoje"; the only notes allowed in "Notas Diárias" */
  isDaily: boolean;
  createdAt: number;
  updatedAt: number;
  hasThumbnail: boolean;
  /** the scene changed since the thumbnail was rendered (or has none yet,
   * e.g. created through the API) */
  needsThumbnail: boolean;
  /** changes with each thumbnail saved */
  thumbnailVersion: number;
};

export type SearchResult = NoteSummary & {
  /** where the query was found (`null`: no query, most recent notes) */
  matchedIn: "title" | "content" | null;
  /** an excerpt of the drawing's text around the match */
  snippet: string | null;
};

export type Folder = {
  id: string;
  name: string;
  /** set for app-managed folders (can't be renamed or deleted) */
  kind: "daily" | null;
  createdAt: number;
  noteCount: number;
};

export type Note = NoteSummary & {
  elements: ExcalidrawElement[];
  appState: Partial<AppState>;
  files: BinaryFiles;
};

export type NoteUpdate = {
  title?: string;
  /** moves the note into a folder (`null`: out of any folder) */
  folderId?: string | null;
  elements?: readonly ExcalidrawElement[];
  appState?: Partial<AppState>;
  /** only files not yet stored for the note need to be sent */
  files?: BinaryFiles;
  /** PNG data URL, or `null` to clear */
  thumbnail?: string | null;
  /** `updatedAt` of the version edited: refused (409) if it changed since */
  baseUpdatedAt?: number;
};

/** an error answer of the notes API */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** the note changed elsewhere since the version the update was made on */
export const isConflictError = (error: unknown) =>
  error instanceof ApiError && error.status === 409;

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  if (!response.ok) {
    const { error } = await response
      .json()
      .catch(() => ({ error: response.statusText }));
    throw new ApiError(
      response.status,
      error || `Request failed (${response.status})`,
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
};

export const notesApi = {
  list: () => request<NoteSummary[]>("/notes"),
  /** every note, by title and by the text written in its drawing */
  search: (query: string, init?: RequestInit) =>
    request<SearchResult[]>(
      `/notes/search?q=${encodeURIComponent(query)}`,
      init,
    ),
  get: (id: string) => request<Note>(`/notes/${id}`),
  create: (title = "", folderId: string | null = null) =>
    request<NoteSummary>("/notes", {
      method: "POST",
      body: JSON.stringify({ title, folderId }),
    }),
  /** gets the note of the given day, creating it in "Notas Diárias" if needed */
  daily: (date: string, title: string) =>
    request<NoteSummary>("/notes/daily", {
      method: "POST",
      body: JSON.stringify({ date, title }),
    }),
  update: (id: string, update: NoteUpdate) =>
    request<NoteSummary>(`/notes/${id}`, {
      method: "PUT",
      body: JSON.stringify(update),
    }),
  /** saves a rendered thumbnail without bumping `updatedAt`; refused (409)
   * if the note changed since `baseUpdatedAt` */
  saveThumbnail: (
    id: string,
    thumbnail: string | null,
    baseUpdatedAt?: number,
  ) =>
    request<NoteSummary>(`/notes/${id}/thumbnail`, {
      method: "PUT",
      body: JSON.stringify({ thumbnail, baseUpdatedAt }),
    }),
  duplicate: (id: string) =>
    request<NoteSummary>(`/notes/${id}/duplicate`, { method: "POST" }),
  move: (id: string, folderId: string | null) =>
    request<NoteSummary>(`/notes/${id}`, {
      method: "PUT",
      body: JSON.stringify({ folderId }),
    }),
  remove: (id: string) => request<void>(`/notes/${id}`, { method: "DELETE" }),
  /** deletes all the given notes, or none if one doesn't exist */
  removeMany: (ids: readonly string[]) =>
    request<{ deleted: number }>("/notes", {
      method: "DELETE",
      body: JSON.stringify({ ids }),
    }),
  thumbnailURL: (note: NoteSummary) =>
    `${API_URL}/notes/${note.id}/thumbnail?v=${note.thumbnailVersion}`,
};

export const foldersApi = {
  list: () => request<Folder[]>("/folders"),
  create: (name: string) =>
    request<Folder>("/folders", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  rename: (id: string, name: string) =>
    request<Folder>(`/folders/${id}`, {
      method: "PUT",
      body: JSON.stringify({ name }),
    }),
  /** notes inside are moved out of the folder, not deleted */
  remove: (id: string) => request<void>(`/folders/${id}`, { method: "DELETE" }),
};

export const libraryApi = {
  load: () => request<LibraryPersistedData | null>("/library"),
  save: (data: LibraryPersistedData) =>
    request<void>("/library", { method: "PUT", body: JSON.stringify(data) }),
};

/** default colors of the color pickers' top picks, shared by all notes */
export const colorDefaultsApi = {
  load: () => request<ColorTopPicksDefaults>("/color-defaults"),
  /** replaces the slot's defaults (`null`: built-in color); returns all */
  save: (slot: ColorTopPicksSlot, defaults: readonly (string | null)[]) =>
    request<ColorTopPicksDefaults>(`/color-defaults/${slot}`, {
      method: "PUT",
      body: JSON.stringify({ defaults }),
    }),
};
