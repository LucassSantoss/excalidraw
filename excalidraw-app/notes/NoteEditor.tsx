import {
  CaptureUpdateAction,
  Excalidraw,
  MainMenu,
  WelcomeScreen,
  exportScene,
  getDataURL,
  getNonDeletedElements,
  hashElementsVersion,
  restoreElements,
  useExcalidrawAPI,
  useHandleLibrary,
} from "@excalidraw/excalidraw";
import {
  cleanAppStateForExport,
  clearAppStateForLocalStorage,
} from "@excalidraw/excalidraw/appState";
import { gridIcon } from "@excalidraw/excalidraw/components/icons";
import clsx from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type {
  AppState,
  BinaryFiles,
  ColorTopPicksDefaults,
  ColorTopPicksSlot,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";

import { LanguageList } from "../app-language/LanguageList";
import { useAppLangCode } from "../app-language/language-state";
import { useHandleAppTheme } from "../useHandleAppTheme";

import {
  IndexedDBLibraryMigrationAdapter,
  SQLiteLibraryAdapter,
} from "./libraryAdapters";
import { colorDefaultsApi, isConflictError, notesApi } from "./notesApi";

import "./NoteEditor.scss";

import type { Note } from "./notesApi";

const SAVE_DEBOUNCE_MS = 800;
const UNTITLED = "Sem título";
/** the macOS app (Electron), where closing waits for pending saves without
 * asking the user (see `desktop/src/main.mts`) */
const IS_DESKTOP_APP = navigator.userAgent.includes("Electron");
const THUMBNAIL_MAX_SIZE = 480;

type SaveStatus = "saved" | "pending" | "saving" | "error" | "conflict";

type SceneSnapshot = {
  elements: readonly ExcalidrawElement[];
  appState: AppState;
  files: BinaryFiles;
};

const SAVE_STATUS_LABELS: Record<SaveStatus, string> = {
  saved: "Salvo",
  pending: "Alterações não salvas",
  saving: "Salvando…",
  error: "Erro ao salvar",
  conflict: "Alterada em outro lugar",
};

const createThumbnail = async ({
  elements,
  appState,
  files,
}: SceneSnapshot) => {
  const visibleElements = getNonDeletedElements(elements);
  if (!visibleElements.length) {
    return null;
  }
  const blob = await exportScene({
    type: "png",
    data: {
      elements: visibleElements,
      appState: cleanAppStateForExport(appState),
      files,
    },
    config: { maxWidthOrHeight: THUMBNAIL_MAX_SIZE, padding: 16 },
  });
  return getDataURL(blob);
};

const createThumbnailOrSkip = (snapshot: SceneSnapshot) =>
  createThumbnail(snapshot).catch((error) => {
    console.error("Failed to create note thumbnail", error);
    return undefined;
  });

/**
 * Keeps a note in sync with the server: debounces scene changes, sends only
 * images the server doesn't have yet, and serializes saves (scene and title)
 * so they never overlap.
 *
 * The thumbnail isn't part of these saves (it's costly to render for large
 * drawings): it's rendered once, when the note is closed (`saveThumbnail`).
 *
 * Each save is made on the version of the note last loaded or saved here:
 * when the note changed elsewhere since (another window, the API), the
 * server refuses it and saving stops (`conflict`) until it's resolved.
 */
const useNoteSaver = (noteId: string) => {
  const [status, setStatus] = useState<SaveStatus>("saved");

  const stateRef = useRef({
    // version of the last scene seen (saved or pending); `null` until the
    // first change after load, which only establishes the baseline
    sceneVersion: null as number | null,
    viewBackgroundColor: null as string | null,
    savedFileIds: new Set<string>(),
    pending: null as SceneSnapshot | null,
    pendingTitle: null as string | null,
    // the latest scene, saved or not
    latest: null as SceneSnapshot | null,
    // `updatedAt` of the version of the note the changes are made on
    baseUpdatedAt: null as number | null,
    conflict: false,
    // the next save overwrites changes made elsewhere
    force: false,
    // the saved scene changed since the thumbnail was last rendered
    thumbnailStale: false,
    thumbnailQueued: false,
    timer: 0,
    queue: Promise.resolve(),
  });

  const save = useCallback(() => {
    const state = stateRef.current;
    window.clearTimeout(state.timer);

    state.queue = state.queue.then(async () => {
      const snapshot = state.pending;
      const title = state.pendingTitle;
      if (state.conflict || (!snapshot && title === null)) {
        return;
      }
      state.pending = null;
      state.pendingTitle = null;
      setStatus("saving");

      const newFiles: BinaryFiles = {};
      for (const [id, file] of Object.entries(snapshot?.files ?? {})) {
        if (!state.savedFileIds.has(id)) {
          newFiles[id] = file;
        }
      }

      try {
        const note = await notesApi.update(noteId, {
          ...(title !== null && { title }),
          ...(snapshot && {
            elements: snapshot.elements,
            appState: clearAppStateForLocalStorage(snapshot.appState),
            files: newFiles,
          }),
          baseUpdatedAt:
            state.force || state.baseUpdatedAt === null
              ? undefined
              : state.baseUpdatedAt,
        });
        state.force = false;
        state.baseUpdatedAt = note.updatedAt;
        if (snapshot) {
          state.thumbnailStale = true;
        }
        Object.keys(newFiles).forEach((id) => state.savedFileIds.add(id));
        setStatus(
          state.pending || state.pendingTitle !== null ? "pending" : "saved",
        );
      } catch (error) {
        // retry with the next change (or flush) unless newer changes exist
        state.pending ??= snapshot;
        if (title !== null) {
          state.pendingTitle ??= title;
        }
        if (isConflictError(error)) {
          state.conflict = true;
          setStatus("conflict");
        } else {
          console.error("Failed to save note", error);
          setStatus("error");
        }
      }
    });

    return state.queue;
  }, [noteId]);

  /** the note as loaded from the server (initially, or reloaded) */
  const onLoaded = useCallback((note: Note) => {
    const state = stateRef.current;
    window.clearTimeout(state.timer);
    state.savedFileIds = new Set(Object.keys(note.files));
    state.baseUpdatedAt = note.updatedAt;
    state.sceneVersion = null;
    state.pending = null;
    state.pendingTitle = null;
    state.latest = null;
    state.conflict = false;
    state.force = false;
    state.thumbnailStale = false;
    setStatus("saved");
  }, []);

  const onChange = useCallback(
    (
      elements: readonly ExcalidrawElement[],
      appState: AppState,
      files: BinaryFiles,
    ) => {
      const state = stateRef.current;
      const sceneVersion = hashElementsVersion(elements);
      const hasNewFiles = Object.keys(files).some(
        (id) => !state.savedFileIds.has(id),
      );

      if (state.sceneVersion === null) {
        state.sceneVersion = sceneVersion;
        state.viewBackgroundColor = appState.viewBackgroundColor;
        return;
      }

      if (
        sceneVersion === state.sceneVersion &&
        appState.viewBackgroundColor === state.viewBackgroundColor &&
        !hasNewFiles
      ) {
        return;
      }

      state.sceneVersion = sceneVersion;
      state.viewBackgroundColor = appState.viewBackgroundColor;
      state.pending = { elements, appState, files };
      state.latest = state.pending;
      window.clearTimeout(state.timer);
      // while in conflict, changes are kept until it's resolved
      if (!state.conflict) {
        setStatus("pending");
        state.timer = window.setTimeout(save, SAVE_DEBOUNCE_MS);
      }
    },
    [save],
  );

  const saveTitle = useCallback(
    (title: string) => {
      stateRef.current.pendingTitle = title;
      return save();
    },
    [save],
  );

  /**
   * renders and saves the thumbnail if the saved scene changed since it was
   * last rendered (after the saves already queued)
   */
  const saveThumbnail = useCallback(() => {
    const state = stateRef.current;
    if (state.thumbnailQueued) {
      return state.queue;
    }
    state.thumbnailQueued = true;
    state.queue = state.queue.then(async () => {
      try {
        const scene = state.latest;
        if (!state.thumbnailStale || state.conflict || !scene) {
          return;
        }
        const thumbnail = await createThumbnailOrSkip(scene);
        if (thumbnail === undefined) {
          // failed to render: give up on it rather than retrying forever
          state.thumbnailStale = false;
          return;
        }
        const note = await notesApi.update(noteId, {
          thumbnail,
          baseUpdatedAt: state.baseUpdatedAt ?? undefined,
        });
        state.baseUpdatedAt = note.updatedAt;
        // unless the scene changed (and was saved) meanwhile
        state.thumbnailStale = state.latest !== scene;
      } catch (error) {
        // e.g. the note changed elsewhere: this thumbnail would be outdated.
        // Not retried (closing the macOS app waits for it)
        console.error("Failed to save the note thumbnail", error);
        state.thumbnailStale = false;
      } finally {
        state.thumbnailQueued = false;
      }
    });
    return state.queue;
  }, [noteId]);

  /** saves the changes made here over the ones made elsewhere */
  const overwrite = useCallback(() => {
    const state = stateRef.current;
    state.conflict = false;
    state.force = true;
    return save();
  }, [save]);

  useEffect(() => {
    const state = stateRef.current;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      // (while in conflict, the editor saves the changes as a copy)
      if (state.conflict) {
        return;
      }
      const hasChanges = !!state.pending || state.pendingTitle !== null;
      if (hasChanges || state.thumbnailStale) {
        save();
        saveThumbnail();
        // unsaved changes: ask before leaving. A thumbnail alone isn't worth
        // asking about, but the macOS app closes as soon as it's saved
        if (hasChanges || IS_DESKTOP_APP) {
          event.preventDefault();
        }
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      // e.g. browser back button: flush whatever is pending
      save();
      saveThumbnail();
    };
  }, [save, saveThumbnail]);

  const isConflicted = useCallback(() => stateRef.current.conflict, []);
  /** the latest scene, if it changed since it was loaded */
  const getLatestScene = useCallback(() => stateRef.current.latest, []);

  return useMemo(
    () => ({
      status,
      onChange,
      onLoaded,
      flush: save,
      saveThumbnail,
      saveTitle,
      overwrite,
      isConflicted,
      getLatestScene,
    }),
    [
      status,
      onChange,
      onLoaded,
      save,
      saveThumbnail,
      saveTitle,
      overwrite,
      isConflicted,
      getLatestScene,
    ],
  );
};

/**
 * default colors of the color pickers' top picks, stored in SQLite and shared
 * by all notes. `null` while loading: the editor waits for them, since its
 * memoized color pickers don't pick up later changes on their own.
 */
const useColorTopPicksDefaults = () => {
  const [defaults, setDefaults] = useState<ColorTopPicksDefaults | null>(null);

  useEffect(() => {
    let cancelled = false;
    colorDefaultsApi
      .load()
      .catch((error) => {
        console.error("Failed to load default colors", error);
        return {};
      })
      .then((loaded) => {
        if (!cancelled) {
          setDefaults(loaded);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onChange = useCallback(
    (slot: ColorTopPicksSlot, slotDefaults: readonly (string | null)[]) => {
      setDefaults((current) => ({ ...current, [slot]: slotDefaults }));
      colorDefaultsApi.save(slot, slotDefaults).catch((error) => {
        console.error("Failed to save default colors", error);
      });
    },
    [],
  );

  return { defaults, onChange };
};

export const NoteEditor = ({
  noteId,
  onClose,
}: {
  noteId: string;
  onClose: () => void;
}) => {
  const excalidrawAPI = useExcalidrawAPI();
  const { editorTheme, appTheme, setAppTheme } = useHandleAppTheme();
  const [langCode] = useAppLangCode();
  const [title, setTitle] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const saver = useNoteSaver(noteId);
  const colorDefaults = useColorTopPicksDefaults();

  useHandleLibrary({
    excalidrawAPI,
    adapter: SQLiteLibraryAdapter,
    migrationAdapter: IndexedDBLibraryMigrationAdapter,
  });

  // where a copy of the note goes (`saveAsCopy`)
  const noteRef = useRef<Pick<Note, "folderId" | "isDaily"> | null>(null);
  const titleRef = useRef(title);
  titleRef.current = title;

  const { onLoaded } = saver;
  const initialData = useMemo(
    () =>
      notesApi
        .get(noteId)
        .then((note): ExcalidrawInitialDataState => {
          setTitle(note.title);
          noteRef.current = note;
          onLoaded(note);
          return {
            elements: note.elements,
            appState: note.appState,
            files: note.files,
          };
        })
        .catch((error) => {
          setLoadError(error.message);
          return null;
        }),
    [noteId, onLoaded],
  );

  useEffect(() => {
    document.title = `${title || "Sem título"} — Excalidraw Notes`;
  }, [title]);

  /** discards the changes made here: shows the note as saved */
  const reload = useCallback(async () => {
    const note = await notesApi.get(noteId);
    noteRef.current = note;
    onLoaded(note);
    setTitle(note.title);
    if (excalidrawAPI) {
      excalidrawAPI.addFiles(Object.values(note.files));
      excalidrawAPI.updateScene({
        elements: restoreElements(note.elements, null),
        appState: note.appState.viewBackgroundColor
          ? { viewBackgroundColor: note.appState.viewBackgroundColor }
          : undefined,
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      // undo would bring the discarded changes back
      excalidrawAPI.history.clear();
    }
  }, [noteId, onLoaded, excalidrawAPI]);

  /**
   * saves the changes made here as a new note, next to this one (the daily
   * notes folder only holds daily notes), then shows this note as saved
   */
  const { getLatestScene, isConflicted } = saver;
  const saveAsCopy = useCallback(async () => {
    const scene: SceneSnapshot | null =
      getLatestScene() ??
      (excalidrawAPI && {
        elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
        appState: excalidrawAPI.getAppState(),
        files: excalidrawAPI.getFiles(),
      });
    const copy = await notesApi.create(
      `${titleRef.current || UNTITLED} (conflito)`,
      noteRef.current?.isDaily ? null : noteRef.current?.folderId ?? null,
    );
    if (scene) {
      await notesApi.update(copy.id, {
        elements: scene.elements,
        appState: clearAppStateForLocalStorage(scene.appState),
        files: scene.files,
        thumbnail: await createThumbnailOrSkip(scene),
      });
    }
    return copy;
  }, [getLatestScene, excalidrawAPI]);

  const resolveConflict = async (
    resolution: "reload" | "overwrite" | "copy",
  ) => {
    try {
      if (resolution === "overwrite") {
        await saver.overwrite();
      } else if (resolution === "reload") {
        await reload();
      } else {
        const copy = await saveAsCopy();
        await reload();
        excalidrawAPI?.setToast({
          message: `Suas alterações foram salvas em "${copy.title}".`,
          duration: 5000,
          closable: true,
        });
      }
    } catch (error: any) {
      console.error("Failed to resolve the conflict", error);
      excalidrawAPI?.setToast({
        message: `Não foi possível concluir: ${error.message}`,
        closable: true,
      });
    }
  };

  // leaving while in conflict keeps the changes made here in a copy, instead
  // of losing them (or, in the macOS app, never closing: it retries closing
  // until nothing is pending)
  const isSavingCopyRef = useRef(false);
  const leaveWhileConflicted = useCallback(async () => {
    if (isSavingCopyRef.current) {
      return;
    }
    isSavingCopyRef.current = true;
    try {
      await saveAsCopy();
      await reload();
    } finally {
      isSavingCopyRef.current = false;
    }
  }, [saveAsCopy, reload]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (isConflicted()) {
        leaveWhileConflicted();
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isConflicted, leaveWhileConflicted]);

  // closed some other way (e.g. the browser's back button) while in
  // conflict: the editor is gone, only the copy can be saved
  const saveAsCopyRef = useRef(saveAsCopy);
  saveAsCopyRef.current = saveAsCopy;
  useEffect(
    () => () => {
      if (isConflicted() && !isSavingCopyRef.current) {
        saveAsCopyRef
          .current()
          .catch((error) =>
            console.error("Failed to save the note as a copy", error),
          );
      }
    },
    [isConflicted],
  );

  const close = async () => {
    if (saver.isConflicted()) {
      await leaveWhileConflicted().catch((error) =>
        console.error("Failed to save the note as a copy", error),
      );
    } else {
      await saver.flush();
      await saver.saveThumbnail();
    }
    onClose();
  };

  const saveTitle = (value: string) => {
    saver.saveTitle(value);
  };

  if (loadError) {
    return (
      <div className="note-editor__error">
        <p>Não foi possível abrir a nota: {loadError}</p>
        <button type="button" onClick={onClose}>
          Voltar para a galeria
        </button>
      </div>
    );
  }

  if (!colorDefaults.defaults) {
    return null;
  }

  return (
    <div style={{ height: "100%" }} className="excalidraw-app note-editor">
      <Excalidraw
        initialData={initialData}
        onChange={saver.onChange}
        colorTopPicksDefaults={colorDefaults.defaults}
        onColorTopPicksDefaultsChange={colorDefaults.onChange}
        name={title || "Sem título"}
        langCode={langCode}
        theme={editorTheme}
        onThemeChange={setAppTheme}
        UIOptions={{ canvasActions: { toggleTheme: true } }}
        autoFocus={true}
        handleKeyboardGlobally={true}
        renderTopRightUI={(isMobile) => (
          <div className="note-editor__top-right">
            {!isMobile && (
              <input
                className="note-editor__title"
                value={title}
                placeholder="Sem título"
                aria-label="Título da nota"
                onChange={(event) => setTitle(event.target.value)}
                onBlur={(event) => saveTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === "Escape") {
                    event.currentTarget.blur();
                  }
                }}
              />
            )}
            {saver.status === "conflict" && (
              <div className="note-editor__conflict" role="alert">
                <p>
                  Esta nota foi alterada em outro lugar. Suas alterações daqui
                  ainda não foram salvas.
                </p>
                <div className="note-editor__conflict-actions">
                  <button
                    type="button"
                    onClick={() => resolveConflict("reload")}
                    title="Descarta as alterações daqui e mostra a versão salva"
                  >
                    Recarregar
                  </button>
                  <button
                    type="button"
                    onClick={() => resolveConflict("copy")}
                    title="Salva as alterações daqui numa nota nova e mostra a versão salva"
                  >
                    Salvar como cópia
                  </button>
                  <button
                    type="button"
                    className="note-editor__conflict-overwrite"
                    onClick={() => resolveConflict("overwrite")}
                    title="Salva as alterações daqui por cima das feitas em outro lugar"
                  >
                    Manter a minha
                  </button>
                </div>
              </div>
            )}
            <span
              className={clsx(
                "note-editor__status",
                `note-editor__status--${saver.status}`,
              )}
              title={SAVE_STATUS_LABELS[saver.status]}
            >
              {isMobile ? "" : SAVE_STATUS_LABELS[saver.status]}
            </span>
            <button
              type="button"
              className="note-editor__back"
              onClick={close}
              title="Voltar para a galeria"
            >
              {gridIcon}
              {!isMobile && <span>Galeria</span>}
            </button>
          </div>
        )}
      >
        <MainMenu>
          <MainMenu.Item icon={gridIcon} onSelect={close}>
            Voltar para a galeria
          </MainMenu.Item>
          <MainMenu.Separator />
          <MainMenu.DefaultItems.LoadScene />
          <MainMenu.DefaultItems.Export />
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.DefaultItems.CommandPalette className="highlighted" />
          <MainMenu.DefaultItems.SearchMenu />
          <MainMenu.DefaultItems.Help />
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.Separator />
          <MainMenu.DefaultItems.Preferences />
          <MainMenu.DefaultItems.ToggleTheme
            allowSystemTheme
            theme={appTheme}
          />
          <MainMenu.ItemCustom>
            <LanguageList style={{ width: "100%" }} />
          </MainMenu.ItemCustom>
          <MainMenu.DefaultItems.ChangeCanvasBackground />
        </MainMenu>
        <WelcomeScreen>
          <WelcomeScreen.Hints.MenuHint />
          <WelcomeScreen.Hints.ToolbarHint />
          <WelcomeScreen.Hints.HelpHint />
        </WelcomeScreen>
      </Excalidraw>
    </div>
  );
};
