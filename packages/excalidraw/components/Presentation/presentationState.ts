import {
  CaptureUpdateAction,
  getFrameLikeTitle,
  isFrameLikeElement,
  newElementWith,
} from "@excalidraw/element";

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

/** `customData` key of a frame's position in the slides, set by
 * reordering them */
const SLIDE_ORDER_KEY = "presentationOrder";

/** a frame's position in the slides, if they were reordered */
const getSlideOrder = (frame: ExcalidrawFrameLikeElement) => {
  const order = frame.customData?.[SLIDE_ORDER_KEY];
  return typeof order === "number" ? order : null;
};

/** whether the slides were reordered (vs. sorted by title) */
export const hasCustomSlideOrder = (
  frames: readonly ExcalidrawFrameLikeElement[],
) => frames.some((frame) => getSlideOrder(frame) !== null);

/**
 * the frames of the scene in presentation order: the order they were put in
 * (stored on the frames, so it travels with the drawing), then the frames
 * that weren't (e.g. added since) by title, alphabetically and numerically
 * ("Slide 2" before "Slide 10"), keeping the scene order for frames with the
 * same title
 */
export const getPresentationFrames = (
  frames: readonly NonDeleted<ExcalidrawFrameLikeElement>[],
) =>
  [...frames].sort((a, b) => {
    const orderA = getSlideOrder(a);
    const orderB = getSlideOrder(b);
    if (orderA !== null || orderB !== null) {
      return (orderA ?? Infinity) - (orderB ?? Infinity) || 0;
    }
    return titleCollator.compare(getFrameLikeTitle(a), getFrameLikeTitle(b));
  });

/**
 * stores the order of the slides on their frames (`null`: back to sorting
 * them by title), as an undoable change of the scene
 */
export const setSlideOrder = (
  app: AppClassProperties,
  frameIds: readonly string[] | null,
) => {
  const positions = new Map(frameIds?.map((id, index) => [id, index]));
  app.syncActionResult({
    elements: app.scene.getElementsIncludingDeleted().map((element) => {
      if (!isFrameLikeElement(element)) {
        return element;
      }
      const { [SLIDE_ORDER_KEY]: current, ...customData } =
        element.customData ?? {};
      const order = positions.get(element.id) ?? null;
      if ((current ?? null) === order) {
        return element;
      }
      return newElementWith(element, {
        customData:
          order === null
            ? customData
            : { ...customData, [SLIDE_ORDER_KEY]: order },
      });
    }),
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
};

/** the editor whose "Organizar slides" dialog is open */
export const slidesDialogAtom = atom<{ appId: string } | null>(null);

export const openSlidesDialog = (app: AppClassProperties) => {
  app.setAppState({ openMenu: null, openPopup: null });
  app.updateEditorAtom(slidesDialogAtom, { appId: app.id });
};

export const closeSlidesDialog = (app: AppClassProperties) => {
  app.updateEditorAtom(slidesDialogAtom, null);
};

/**
 * the slide a presentation starts on: the selected frame (or the frame of
 * the selected elements), else the frame taking up most of the screen (the
 * one closest to its center if several do), else the first one
 */
export const getStartSlideIndex = (
  frames: readonly NonDeleted<ExcalidrawFrameLikeElement>[],
  {
    selectedFrameIds,
    viewport,
  }: {
    /** frames of the selected elements, in selection order */
    selectedFrameIds: readonly string[];
    /** the visible part of the scene */
    viewport: { x: number; y: number; width: number; height: number };
  },
) => {
  for (const frameId of selectedFrameIds) {
    const index = frames.findIndex((frame) => frame.id === frameId);
    if (index !== -1) {
      return index;
    }
  }
  const viewportCenterX = viewport.x + viewport.width / 2;
  const viewportCenterY = viewport.y + viewport.height / 2;
  let bestIndex = 0;
  let bestArea = 0;
  let bestDistance = Infinity;
  frames.forEach((frame, index) => {
    const overlapWidth =
      Math.min(frame.x + frame.width, viewport.x + viewport.width) -
      Math.max(frame.x, viewport.x);
    const overlapHeight =
      Math.min(frame.y + frame.height, viewport.y + viewport.height) -
      Math.max(frame.y, viewport.y);
    const area = Math.max(0, overlapWidth) * Math.max(0, overlapHeight);
    if (!area) {
      return;
    }
    // among frames as much in view (e.g. all of them, zoomed out), the one
    // closest to the center of the screen
    const distance = Math.hypot(
      frame.x + frame.width / 2 - viewportCenterX,
      frame.y + frame.height / 2 - viewportCenterY,
    );
    if (
      area > bestArea + 1 ||
      (Math.abs(area - bestArea) <= 1 && distance < bestDistance)
    ) {
      bestArea = area;
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
};

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

export const startPresentation = (
  app: AppClassProperties,
  /** defaults to the current slide (see `getStartSlideIndex`) */
  startAt?: number,
) => {
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
  const selectedFrameIds = Object.keys(state.selectedElementIds).flatMap(
    (id) => {
      const element = app.scene.getNonDeletedElement(id);
      if (!element) {
        return [];
      }
      return isFrameLikeElement(element)
        ? [element.id]
        : element.frameId
        ? [element.frameId]
        : [];
    },
  );
  const startIndex =
    startAt ??
    getStartSlideIndex(frames, {
      selectedFrameIds,
      viewport: {
        x: -state.scrollX,
        y: -state.scrollY,
        width: state.width / state.zoom.value,
        height: state.height / state.zoom.value,
      },
    });

  app.updateEditorAtom(presentationAtom, {
    appId: app.id,
    frameIds: frames.map((frame) => frame.id),
    index: startIndex,
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
  goToSlide(app, startIndex);
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
