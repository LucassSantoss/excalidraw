import { getFrameLikeTitle } from "@excalidraw/element";

import type {
  ExcalidrawFrameLikeElement,
  NonDeleted,
} from "@excalidraw/element/types";

import { atom, editorJotaiStore } from "../../editor-jotai";
import { t } from "../../i18n";

import type { AppClassProperties, AppState } from "../../types";

/** viewport padding around the presented frame, in viewport pixels */
const SLIDE_PADDING = 24;
const SLIDE_ANIMATION_DURATION = 400;

/** the app state a presentation changes, restored when it ends */
type RestoredAppState = Pick<
  AppState,
  | "viewModeEnabled"
  | "frameRendering"
  | "selectedElementIds"
  | "selectedGroupIds"
  | "scrollX"
  | "scrollY"
  | "zoom"
>;

export type PresentationState = {
  /** the presenting editor (the atom store is shared by all of them) */
  appId: string;
  /** the frames to present, in order */
  frameIds: readonly string[];
  index: number;
  restore: RestoredAppState;
  /** whether the presentation put the editor in fullscreen */
  enteredFullscreen: boolean;
};

export const presentationAtom = atom<PresentationState | null>(null);

const titleCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

/**
 * the frames of the scene in presentation order: by title, alphabetically
 * and numerically ("Slide 2" before "Slide 10"), keeping the scene order for
 * frames with the same title
 */
export const getPresentationFrames = (
  frames: readonly NonDeleted<ExcalidrawFrameLikeElement>[],
) =>
  [...frames].sort((a, b) =>
    titleCollator.compare(getFrameLikeTitle(a), getFrameLikeTitle(b)),
  );

export const getPresentation = (app: AppClassProperties) => {
  const presentation = editorJotaiStore.get(presentationAtom);
  return presentation?.appId === app.id ? presentation : null;
};

/** moves the viewport to the given frame (clamped to the first/last one) */
export const goToSlide = (app: AppClassProperties, index: number) => {
  const presentation = getPresentation(app);
  if (!presentation) {
    return;
  }
  // frames deleted meanwhile (e.g. by a collaborator) are skipped
  const frameIds = presentation.frameIds.filter((id) =>
    app.scene.getNonDeletedElement(id),
  );
  if (!frameIds.length) {
    stopPresentation(app);
    return;
  }
  const nextIndex = Math.max(0, Math.min(index, frameIds.length - 1));
  app.updateEditorAtom(presentationAtom, {
    ...presentation,
    frameIds,
    index: nextIndex,
  });
  app.viewport.setViewport({
    target: frameIds[nextIndex],
    fit: "contain",
    offsets: {
      top: SLIDE_PADDING,
      right: SLIDE_PADDING,
      bottom: SLIDE_PADDING,
      left: SLIDE_PADDING,
    },
    animation: { duration: SLIDE_ANIMATION_DURATION },
  });
};

export const startPresentation = (app: AppClassProperties) => {
  if (getPresentation(app)) {
    return;
  }
  const frames = getPresentationFrames(app.scene.getNonDeletedFramesLikes());
  if (!frames.length) {
    app.setAppState({
      toast: { message: t("presentation.noFrames"), closable: true },
    });
    return;
  }

  const { state } = app;
  app.updateEditorAtom(presentationAtom, {
    appId: app.id,
    frameIds: frames.map((frame) => frame.id),
    index: 0,
    restore: {
      viewModeEnabled: state.viewModeEnabled,
      frameRendering: state.frameRendering,
      selectedElementIds: state.selectedElementIds,
      selectedGroupIds: state.selectedGroupIds,
      scrollX: state.scrollX,
      scrollY: state.scrollY,
      zoom: state.zoom,
    },
    enteredFullscreen: false,
  });
  // slides show the drawing only: no editing, selection, frame names or
  // outlines (the frames still clip their content)
  app.setAppState({
    viewModeEnabled: true,
    frameRendering: { ...state.frameRendering, name: false, outline: false },
    selectedElementIds: {},
    selectedGroupIds: {},
    openMenu: null,
    openPopup: null,
    openDialog: null,
    toast: null,
  });

  const container = app.excalidrawContainerValue.container;
  if (container?.requestFullscreen && !app.ownerDocument.fullscreenElement) {
    container
      .requestFullscreen()
      .then(() => {
        const presentation = getPresentation(app);
        if (presentation) {
          app.updateEditorAtom(presentationAtom, {
            ...presentation,
            enteredFullscreen: true,
          });
        }
      })
      // not allowed (e.g. no user gesture): present in the window
      .catch(() => {});
  }
  goToSlide(app, 0);
};

export const stopPresentation = (app: AppClassProperties) => {
  const presentation = getPresentation(app);
  if (!presentation) {
    return;
  }
  app.updateEditorAtom(presentationAtom, null);
  app.viewport.cancelTransition();
  const { selectedElementIds, selectedGroupIds, ...restore } =
    presentation.restore;
  // leaving view mode clears the selection: restore it afterwards
  app.setAppState(restore, () =>
    app.setAppState({ selectedElementIds, selectedGroupIds }),
  );
  if (
    presentation.enteredFullscreen &&
    app.ownerDocument.fullscreenElement ===
      app.excalidrawContainerValue.container
  ) {
    app.ownerDocument.exitFullscreen().catch(() => {});
  }
};
