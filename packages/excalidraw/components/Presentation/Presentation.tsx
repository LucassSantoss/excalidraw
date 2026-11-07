import clsx from "clsx";
import { useEffect, useRef, useState } from "react";

import { t } from "../../i18n";
import { CloseIcon, chevronLeft, chevronRight } from "../icons";

import { goToSlide, stopPresentation } from "./presentation";

import "./Presentation.scss";

import type { PresentationState } from "./presentation";
import type { AppClassProperties } from "../../types";

/** the controls fade out after the pointer rests for this long */
const CONTROLS_IDLE_TIMEOUT = 2500;
const RESIZE_DEBOUNCE = 150;

const NEXT_KEYS = new Set([
  "ArrowRight",
  "ArrowDown",
  "PageDown",
  " ",
  "Enter",
]);
const PREVIOUS_KEYS = new Set(["ArrowLeft", "ArrowUp", "PageUp", "Backspace"]);

/**
 * the UI of a running presentation (replacing the editor UI): keyboard
 * navigation between frames, plus on-screen controls
 */
export const Presentation = ({
  app,
  presentation,
}: {
  app: AppClassProperties;
  presentation: PresentationState;
}) => {
  const { index, frameIds } = presentation;
  const [isIdle, setIsIdle] = useState(false);

  // read by the listeners, registered once
  const indexRef = useRef(index);
  indexRef.current = index;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      let handled = true;
      if (NEXT_KEYS.has(event.key)) {
        goToSlide(app, indexRef.current + 1);
      } else if (PREVIOUS_KEYS.has(event.key)) {
        goToSlide(app, indexRef.current - 1);
      } else if (event.key === "Home") {
        goToSlide(app, 0);
      } else if (event.key === "End") {
        goToSlide(app, Infinity);
      } else if (event.key === "Escape") {
        stopPresentation(app);
      } else {
        handled = false;
      }
      if (handled) {
        // before the editor's own shortcuts (e.g. space to pan, arrows to
        // move the selection), registered on the document
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    // the viewport size changed (e.g. entering fullscreen): fit the current
    // slide again, once the editor has measured its new size
    let resizeTimer = 0;
    const onResize = () => {
      app.ownerWindow.clearTimeout(resizeTimer);
      resizeTimer = app.ownerWindow.setTimeout(
        () => goToSlide(app, indexRef.current),
        RESIZE_DEBOUNCE,
      );
    };

    const { ownerWindow } = app;
    ownerWindow.addEventListener("keydown", onKeyDown, { capture: true });
    ownerWindow.addEventListener("resize", onResize);
    return () => {
      ownerWindow.removeEventListener("keydown", onKeyDown, { capture: true });
      ownerWindow.removeEventListener("resize", onResize);
      ownerWindow.clearTimeout(resizeTimer);
    };
  }, [app]);

  // leaving the fullscreen the presentation entered (e.g. the browser's own
  // Escape handling) ends it
  useEffect(() => {
    if (!presentation.enteredFullscreen) {
      return;
    }
    const { ownerDocument } = app;
    const onFullscreenChange = () => {
      if (!ownerDocument.fullscreenElement) {
        stopPresentation(app);
      }
    };
    ownerDocument.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      ownerDocument.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, [app, presentation.enteredFullscreen]);

  useEffect(() => {
    let timer = 0;
    const onPointerMove = () => {
      setIsIdle(false);
      app.ownerWindow.clearTimeout(timer);
      timer = app.ownerWindow.setTimeout(
        () => setIsIdle(true),
        CONTROLS_IDLE_TIMEOUT,
      );
    };
    onPointerMove();
    app.ownerWindow.addEventListener("pointermove", onPointerMove);
    return () => {
      app.ownerWindow.clearTimeout(timer);
      app.ownerWindow.removeEventListener("pointermove", onPointerMove);
    };
  }, [app]);

  return (
    <div
      className={clsx("Presentation__controls", {
        "Presentation__controls--idle": isIdle,
      })}
      role="toolbar"
      aria-label={t("presentation.title")}
    >
      <button
        type="button"
        className="Presentation__button"
        onClick={() => goToSlide(app, index - 1)}
        disabled={index === 0}
        title={t("presentation.previous")}
        aria-label={t("presentation.previous")}
      >
        {chevronLeft}
      </button>
      <span className="Presentation__counter" aria-live="polite">
        {index + 1} / {frameIds.length}
      </span>
      <button
        type="button"
        className="Presentation__button"
        onClick={() => goToSlide(app, index + 1)}
        disabled={index === frameIds.length - 1}
        title={t("presentation.next")}
        aria-label={t("presentation.next")}
      >
        {chevronRight}
      </button>
      <div className="Presentation__divider" />
      <button
        type="button"
        className="Presentation__button"
        onClick={() => stopPresentation(app)}
        title={t("presentation.exit")}
        aria-label={t("presentation.exit")}
      >
        {CloseIcon}
      </button>
    </div>
  );
};
