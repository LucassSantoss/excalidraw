import { ExcalidrawAPIProvider } from "@excalidraw/excalidraw";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";

import { Provider, appJotaiStore } from "../app-jotai";
import { TopErrorBoundary } from "../components/TopErrorBoundary";

import "../index.scss";

import { NoteEditor } from "./NoteEditor";
import { NotesGallery } from "./NotesGallery";

// the original excalidraw.com app, still used for `#json=` / `#room=` links
const ExcalidrawApp = lazy(() => import("../App"));

const NOTE_PARAM = "note";
const FOLDER_PARAM = "folder";

const getRouteFromURL = () => {
  const params = new URLSearchParams(window.location.search);
  return {
    noteId: params.get(NOTE_PARAM),
    folderId: params.get(FOLDER_PARAM),
  };
};

const isLegacyAppURL = () =>
  !!window.location.hash ||
  window.location.pathname === "/excalidraw-plus-export";

/** updates the given URL params (`null` removes one), keeping the others */
const navigate = (params: { note?: string | null; folder?: string | null }) => {
  const url = new URL(window.location.href);
  for (const [key, value] of [
    [NOTE_PARAM, params.note],
    [FOLDER_PARAM, params.folder],
  ] as const) {
    if (value) {
      url.searchParams.set(key, value);
    } else if (value === null) {
      url.searchParams.delete(key);
    }
  }
  window.history.pushState(null, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
};

// notes open within their folder, so closing them goes back to it
const openNote = (note: { id: string; folderId: string | null }) =>
  navigate({ note: note.id, folder: note.folderId });

const openFolder = (folderId: string | null) =>
  navigate({ note: null, folder: folderId });

export const NotesApp = () => {
  const [{ noteId, folderId }, setRoute] = useState(getRouteFromURL);

  useEffect(() => {
    const onPopState = () => setRoute(getRouteFromURL());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const openGallery = useCallback(() => navigate({ note: null }), []);

  if (!noteId && isLegacyAppURL()) {
    return (
      <Suspense fallback={null}>
        <ExcalidrawApp />
      </Suspense>
    );
  }

  return (
    <TopErrorBoundary>
      <Provider store={appJotaiStore}>
        {noteId ? (
          <ExcalidrawAPIProvider key={noteId}>
            <NoteEditor noteId={noteId} onClose={openGallery} />
          </ExcalidrawAPIProvider>
        ) : (
          <NotesGallery
            folderId={folderId}
            onOpenNote={openNote}
            onOpenFolder={openFolder}
          />
        )}
      </Provider>
    </TopErrorBoundary>
  );
};
