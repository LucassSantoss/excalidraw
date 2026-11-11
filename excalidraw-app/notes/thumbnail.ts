import {
  exportScene,
  getDataURL,
  getNonDeletedElements,
  restoreElements,
} from "@excalidraw/excalidraw";
import { cleanAppStateForExport } from "@excalidraw/excalidraw/appState";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";

const THUMBNAIL_MAX_SIZE = 480;

/**
 * PNG data URL of a note's thumbnail (`null`: nothing to show). The scene may
 * come straight from the API, so its elements are normalized first.
 */
export const renderThumbnail = async ({
  elements,
  appState,
  files,
}: {
  elements: readonly ExcalidrawElement[];
  appState: Partial<AppState>;
  files: BinaryFiles;
}) => {
  const visibleElements = getNonDeletedElements(
    restoreElements(elements, null),
  );
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
