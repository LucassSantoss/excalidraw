import {
  DuplicateIcon,
  PlusIcon,
  TrashIcon,
  pencilIcon,
  searchIcon,
} from "@excalidraw/excalidraw/components/icons";
import clsx from "clsx";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useHandleAppTheme } from "../useHandleAppTheme";

import {
  calendarIcon,
  chevronRightIcon,
  folderIcon,
  folderPlusIcon,
} from "./icons";
import { foldersApi, notesApi } from "./notesApi";
import { usePromptDialog } from "./PromptDialog";

import "./NotesGallery.scss";

import type { Folder, NoteSummary } from "./notesApi";

const UNTITLED = "Sem título";

/** drag & drop payload type for moving notes between folders */
const NOTE_DRAG_TYPE = "application/x-excalidraw-note";
/** drop target key of the root ("Minhas notas") */
const ROOT_DROP_TARGET = "root";

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
});

const dailyTitleFormatter = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** local YYYY-MM-DD (identifies the daily note of that day) */
const toISODate = (date: Date) =>
  [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");

/** e.g. "Sexta-feira, 23 de outubro de 2026" */
const getDailyNoteTitle = (date: Date) => {
  const title = dailyTitleFormatter.format(date);
  return title.charAt(0).toUpperCase() + title.slice(1);
};

const pluralizeNotes = (count: number) =>
  `${count} ${count === 1 ? "nota" : "notas"}`;

const isNoteDrag = (event: React.DragEvent) =>
  event.dataTransfer.types.includes(NOTE_DRAG_TYPE);

/** the daily notes folder only holds daily notes */
const canMoveNoteTo = (note: NoteSummary, folder: Folder | null) =>
  folder?.kind !== "daily" || note.isDaily;

const NoteCard = ({
  note,
  folderName,
  isDragging,
  onOpen,
  onRename,
  onDuplicate,
  onDelete,
  onDragStart,
  onDragEnd,
}: {
  note: NoteSummary;
  /** shown when listing notes from several folders (search) */
  folderName?: string;
  isDragging: boolean;
  onOpen: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) => (
  <li
    className={clsx("notes-gallery__card", {
      "notes-gallery__card--dragging": isDragging,
    })}
    draggable
    onDragStart={(event) => {
      event.dataTransfer.setData(NOTE_DRAG_TYPE, note.id);
      event.dataTransfer.effectAllowed = "move";
      onDragStart();
    }}
    onDragEnd={onDragEnd}
  >
    <button
      type="button"
      className="notes-gallery__thumbnail"
      onClick={onOpen}
      aria-label={`Abrir ${note.title || UNTITLED}`}
    >
      {note.hasThumbnail ? (
        <img
          src={notesApi.thumbnailURL(note)}
          alt=""
          loading="lazy"
          draggable={false}
        />
      ) : (
        <span>Nota vazia</span>
      )}
    </button>
    <div className="notes-gallery__info">
      <div className="notes-gallery__meta">
        <span
          className={clsx("notes-gallery__title", {
            "notes-gallery__title--untitled": !note.title,
          })}
          title={note.title || UNTITLED}
        >
          {note.title || UNTITLED}
        </span>
        <span className="notes-gallery__date">
          {folderName && (
            <span className="notes-gallery__folder-tag">
              {folderIcon}
              {folderName}
            </span>
          )}
          {dateFormatter.format(note.updatedAt)}
        </span>
      </div>
      <div className="notes-gallery__actions">
        <button type="button" title="Renomear" onClick={onRename}>
          {pencilIcon}
        </button>
        <button type="button" title="Duplicar" onClick={onDuplicate}>
          {DuplicateIcon}
        </button>
        <button
          type="button"
          title="Excluir"
          className="notes-gallery__delete"
          onClick={onDelete}
        >
          {TrashIcon}
        </button>
      </div>
    </div>
  </li>
);

export const NotesGallery = ({
  folderId,
  onOpenNote,
  onOpenFolder,
}: {
  /** folder being browsed (`null`: root) */
  folderId: string | null;
  onOpenNote: (note: NoteSummary) => void;
  onOpenFolder: (folderId: string | null) => void;
}) => {
  const { editorTheme } = useHandleAppTheme();
  const [notes, setNotes] = useState<NoteSummary[] | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [draggedNoteId, setDraggedNoteId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const { prompt, confirm, dialog } = usePromptDialog();

  const refresh = useCallback(
    () =>
      Promise.all([notesApi.list(), foldersApi.list()])
        .then(([notes, folders]) => {
          setNotes(notes);
          setFolders(folders);
          setError(null);
        })
        .catch((error) => setError(error.message)),
    [],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  // a folder that no longer exists (e.g. deleted) falls back to the root
  const currentFolder = folders.find((folder) => folder.id === folderId);
  const currentFolderId = currentFolder?.id ?? null;

  useEffect(() => {
    document.title = `${
      currentFolder?.name ?? "Minhas notas"
    } — Excalidraw Notes`;
  }, [currentFolder?.name]);

  const run = (action: () => Promise<unknown>) =>
    action()
      .then(refresh)
      .catch((error) => setError(error.message));

  const createNote = () =>
    notesApi
      .create("", currentFolderId)
      .then(onOpenNote)
      .catch((error) => setError(error.message));

  const openDailyNote = () => {
    const today = new Date();
    notesApi
      .daily(toISODate(today), getDailyNoteTitle(today))
      .then(onOpenNote)
      .catch((error) => setError(error.message));
  };

  const renameNote = async (note: NoteSummary) => {
    const title = await prompt({
      title: "Renomear nota",
      confirmLabel: "Renomear",
      defaultValue: note.title,
      placeholder: UNTITLED,
    });
    if (title !== null && title !== note.title) {
      run(() => notesApi.update(note.id, { title }));
    }
  };

  const deleteNote = async (note: NoteSummary) => {
    const confirmed = await confirm({
      title: `Excluir "${note.title || UNTITLED}"?`,
      message: "Essa ação não pode ser desfeita.",
      confirmLabel: "Excluir",
      danger: true,
    });
    if (confirmed) {
      run(() => notesApi.remove(note.id));
    }
  };

  const moveNote = (noteId: string, targetFolderId: string | null) => {
    const note = notes?.find((note) => note.id === noteId);
    const targetFolder =
      folders.find((folder) => folder.id === targetFolderId) ?? null;
    if (
      !note ||
      note.folderId === targetFolderId ||
      !canMoveNoteTo(note, targetFolder)
    ) {
      return;
    }
    // optimistic, so the card leaves the current view right away
    setNotes(
      (notes) =>
        notes?.map((note) =>
          note.id === noteId ? { ...note, folderId: targetFolderId } : note,
        ) ?? null,
    );
    run(() => notesApi.move(noteId, targetFolderId));
  };

  const createFolder = async () => {
    const name = await prompt({
      title: "Nova pasta",
      confirmLabel: "Criar pasta",
      placeholder: "Nome da pasta",
    });
    if (name) {
      run(() => foldersApi.create(name));
    }
  };

  const renameFolder = async (folder: Folder) => {
    const name = await prompt({
      title: "Renomear pasta",
      confirmLabel: "Renomear",
      defaultValue: folder.name,
      placeholder: "Nome da pasta",
    });
    if (name && name !== folder.name) {
      run(() => foldersApi.rename(folder.id, name));
    }
  };

  const deleteFolder = async (folder: Folder) => {
    const confirmed = await confirm({
      title: `Excluir a pasta "${folder.name}"?`,
      message: folder.noteCount
        ? `${pluralizeNotes(folder.noteCount)} dentro dela ${
            folder.noteCount === 1 ? "volta" : "voltam"
          } para "Minhas notas". Nenhuma nota é apagada.`
        : "A pasta está vazia.",
      confirmLabel: "Excluir pasta",
      danger: true,
    });
    if (confirmed) {
      if (folder.id === currentFolderId) {
        onOpenFolder(null);
      }
      run(() => foldersApi.remove(folder.id));
    }
  };

  /** props making an element a drop target for moving notes into a folder */
  const draggedNote = notes?.find((note) => note.id === draggedNoteId);

  /** whether the note being dragged can't be dropped into `folder` */
  const isDropDisabled = (folder: Folder | null) =>
    !!draggedNote && !canMoveNoteTo(draggedNote, folder);

  const dropTargetProps = (targetFolderId: string | null) => {
    const key = targetFolderId ?? ROOT_DROP_TARGET;
    const targetFolder =
      folders.find((folder) => folder.id === targetFolderId) ?? null;
    return {
      onDragOver: (event: React.DragEvent) => {
        // not accepting the drop shows the "not allowed" cursor
        if (isNoteDrag(event) && !isDropDisabled(targetFolder)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setDropTarget(key);
        }
      },
      onDragLeave: (event: React.DragEvent) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          setDropTarget((current) => (current === key ? null : current));
        }
      },
      onDrop: (event: React.DragEvent) => {
        event.preventDefault();
        setDropTarget(null);
        // the dragged card may leave the view before its `dragend` fires
        setDraggedNoteId(null);
        const noteId = event.dataTransfer.getData(NOTE_DRAG_TYPE);
        if (noteId) {
          moveNote(noteId, targetFolderId);
        }
      },
    };
  };

  const normalizedQuery = query.trim().toLowerCase();
  const isSearching = !!normalizedQuery;

  const folderNames = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder.name])),
    [folders],
  );

  const visibleNotes = useMemo(
    () =>
      (notes ?? []).filter((note) =>
        isSearching
          ? // search looks into every folder
            (note.title || UNTITLED).toLowerCase().includes(normalizedQuery)
          : note.folderId === currentFolderId,
      ),
    [notes, isSearching, normalizedQuery, currentFolderId],
  );

  const showFolders = !isSearching && !currentFolder && !!folders.length;
  const isEmpty = notes && !notes.length && !folders.length;

  return (
    <div
      className={clsx("notes-gallery", {
        "notes-gallery--dark": editorTheme === "dark",
        "notes-gallery--dragging": !!draggedNoteId,
      })}
    >
      <header className="notes-gallery__header">
        {currentFolder ? (
          <nav className="notes-gallery__breadcrumb" aria-label="Pastas">
            <button
              type="button"
              className={clsx("notes-gallery__crumb", {
                "notes-gallery__crumb--drop-target":
                  dropTarget === ROOT_DROP_TARGET,
              })}
              onClick={() => onOpenFolder(null)}
              title="Voltar para Minhas notas (solte uma nota aqui para tirá-la da pasta)"
              {...dropTargetProps(null)}
            >
              Minhas notas
            </button>
            {chevronRightIcon}
            <h1>
              {currentFolder.kind === "daily" ? calendarIcon : folderIcon}
              {currentFolder.name}
            </h1>
            {!currentFolder.kind && (
              <div className="notes-gallery__actions">
                <button
                  type="button"
                  title="Renomear pasta"
                  onClick={() => renameFolder(currentFolder)}
                >
                  {pencilIcon}
                </button>
                <button
                  type="button"
                  title="Excluir pasta"
                  className="notes-gallery__delete"
                  onClick={() => deleteFolder(currentFolder)}
                >
                  {TrashIcon}
                </button>
              </div>
            )}
          </nav>
        ) : (
          <h1>Minhas notas</h1>
        )}
        <label className="notes-gallery__search">
          {searchIcon}
          <input
            type="search"
            placeholder="Buscar notas"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="notes-gallery__secondary"
          onClick={openDailyNote}
          title='Abre a nota de hoje na pasta "Notas Diárias", criando-a se ainda não existir'
        >
          {calendarIcon}
          Nota de hoje
        </button>
        {!currentFolder && (
          <button
            type="button"
            className="notes-gallery__secondary"
            onClick={createFolder}
          >
            {folderPlusIcon}
            Nova pasta
          </button>
        )}
        {currentFolder?.kind !== "daily" && (
          <button
            type="button"
            className="notes-gallery__create"
            onClick={createNote}
          >
            {PlusIcon}
            Nova nota
          </button>
        )}
      </header>

      {error && <p className="notes-gallery__error">{error}</p>}

      {isEmpty && (
        <div className="notes-gallery__empty">
          <p>Nenhuma nota ainda.</p>
          <button
            type="button"
            className="notes-gallery__create"
            onClick={createNote}
          >
            {PlusIcon}
            Criar a primeira nota
          </button>
        </div>
      )}

      {showFolders && (
        <section>
          <h2 className="notes-gallery__section-title">Pastas</h2>
          <ul className="notes-gallery__folders">
            {folders.map((folder) => (
              <li
                key={folder.id}
                className={clsx("notes-gallery__folder", {
                  "notes-gallery__folder--drop-target":
                    dropTarget === folder.id,
                  "notes-gallery__folder--drop-disabled":
                    isDropDisabled(folder),
                })}
                title={
                  isDropDisabled(folder)
                    ? 'Só notas criadas por "Nota de hoje" ficam nesta pasta'
                    : undefined
                }
                {...dropTargetProps(folder.id)}
              >
                <button
                  type="button"
                  className="notes-gallery__folder-open"
                  onClick={() => onOpenFolder(folder.id)}
                  aria-label={`Abrir pasta ${folder.name}`}
                >
                  <span className="notes-gallery__folder-icon">
                    {folder.kind === "daily" ? calendarIcon : folderIcon}
                  </span>
                  <span className="notes-gallery__meta">
                    <span className="notes-gallery__title" title={folder.name}>
                      {folder.name}
                    </span>
                    <span className="notes-gallery__date">
                      {pluralizeNotes(folder.noteCount)}
                    </span>
                  </span>
                </button>
                {!folder.kind && (
                  <div className="notes-gallery__actions">
                    <button
                      type="button"
                      title="Renomear pasta"
                      onClick={() => renameFolder(folder)}
                    >
                      {pencilIcon}
                    </button>
                    <button
                      type="button"
                      title="Excluir pasta"
                      className="notes-gallery__delete"
                      onClick={() => deleteFolder(folder)}
                    >
                      {TrashIcon}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {!!visibleNotes.length && (
            <h2 className="notes-gallery__section-title">Notas</h2>
          )}
        </section>
      )}

      {isSearching && !visibleNotes.length && (
        <p className="notes-gallery__empty">
          Nenhuma nota encontrada para "{query}".
        </p>
      )}

      {!isSearching && currentFolder && notes && !visibleNotes.length && (
        <p className="notes-gallery__empty">
          {currentFolder.kind === "daily"
            ? 'Use "Nota de hoje" para criar a nota do dia.'
            : 'Pasta vazia. Crie uma nota aqui ou, em "Minhas notas", arraste notas até esta pasta.'}
        </p>
      )}

      <ul className="notes-gallery__grid">
        {visibleNotes.map((note) => (
          <NoteCard
            key={note.id}
            note={note}
            folderName={
              isSearching && note.folderId
                ? folderNames.get(note.folderId)
                : undefined
            }
            isDragging={draggedNoteId === note.id}
            onOpen={() => onOpenNote(note)}
            onRename={() => renameNote(note)}
            onDuplicate={() => run(() => notesApi.duplicate(note.id))}
            onDelete={() => deleteNote(note)}
            onDragStart={() => setDraggedNoteId(note.id)}
            onDragEnd={() => {
              setDraggedNoteId(null);
              setDropTarget(null);
            }}
          />
        ))}
      </ul>

      {dialog}
    </div>
  );
};
