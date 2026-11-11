import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";

import { getFrameLikeTitle, getNonDeletedElements } from "@excalidraw/element";

import type {
  ExcalidrawFrameLikeElement,
  NonDeleted,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { t } from "../../i18n";
import { exportScene } from "../../scene/export";
import { Dialog } from "../Dialog";
import { FilledButton } from "../FilledButton";
import { chevronDownIcon, chevronUpIcon, gripVerticalIcon } from "../icons";

import {
  closeSlidesDialog,
  getPresentationFrames,
  hasCustomSlideOrder,
  setSlideOrder,
  startPresentation,
} from "./presentationState";

import "./SlidesDialog.scss";

import type { AppClassProperties } from "../../types";

const PREVIEW_SIZE = 160;

/**
 * small images of the frames, rendered one at a time and kept while a frame
 * doesn't change (by id and version)
 */
const useFramePreviews = (
  app: AppClassProperties,
  frames: readonly NonDeleted<ExcalidrawFrameLikeElement>[],
  elements: readonly NonDeletedExcalidrawElement[],
) => {
  const [previews, setPreviews] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  const urlsRef = useRef(new Map<string, string>());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const frame of frames) {
        const key = `${frame.id}:${frame.version}`;
        if (cancelled || urlsRef.current.has(key)) {
          continue;
        }
        try {
          const blob = await exportScene({
            type: "png",
            data: {
              elements,
              appState: {
                viewBackgroundColor: app.state.viewBackgroundColor,
              },
              files: app.files,
            },
            config: {
              exportingFrame: frame,
              maxWidthOrHeight: PREVIEW_SIZE,
            },
          });
          if (cancelled) {
            return;
          }
          urlsRef.current.set(key, URL.createObjectURL(blob));
          setPreviews(new Map(urlsRef.current));
        } catch (error) {
          console.error("Failed to render the slide preview", error);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [app, frames, elements]);

  useEffect(
    () => () => {
      urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    },
    [],
  );

  return (frame: ExcalidrawFrameLikeElement) =>
    previews.get(`${frame.id}:${frame.version}`);
};

/**
 * "Organizar slides": the frames in presentation order, reordered by
 * dragging them (or with the arrow buttons, e.g. on touch screens)
 */
export const SlidesDialog = ({
  app,
  elements,
}: {
  app: AppClassProperties;
  /** the scene, so the dialog follows its changes (e.g. undo) */
  elements: readonly NonDeletedExcalidrawElement[];
}) => {
  const frames = useMemo(
    () => getPresentationFrames(app.scene.getNonDeletedFramesLikes()),
    // recomputed with the scene
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [app, elements],
  );
  const getPreview = useFramePreviews(
    app,
    frames,
    useMemo(() => getNonDeletedElements(elements), [elements]),
  );
  const [draggedId, setDraggedId] = useState<string | null>(null);
  // where the dragged slide would go: before the slide at this index
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const close = () => closeSlidesDialog(app);

  const move = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex > frames.length - 1 || fromIndex === toIndex) {
      return;
    }
    const ids = frames.map((frame) => frame.id);
    const [moved] = ids.splice(fromIndex, 1);
    ids.splice(toIndex, 0, moved);
    setSlideOrder(app, ids);
  };

  const endDrag = () => {
    setDraggedId(null);
    setDropIndex(null);
  };

  return (
    <Dialog
      onCloseRequest={close}
      title={t("presentation.slides")}
      size="small"
      className="SlidesDialog"
    >
      {!frames.length ? (
        <p className="SlidesDialog__empty">{t("presentation.noFrames")}</p>
      ) : (
        <>
          <p className="SlidesDialog__hint">{t("presentation.reorderHint")}</p>
          <ol
            className="SlidesDialog__list"
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                setDropIndex(null);
              }
            }}
          >
            {frames.map((frame, index) => {
              const preview = getPreview(frame);
              const title = getFrameLikeTitle(frame);
              return (
                <li
                  key={frame.id}
                  className={clsx("SlidesDialog__slide", {
                    "SlidesDialog__slide--dragged": draggedId === frame.id,
                    "SlidesDialog__slide--drop-before": dropIndex === index,
                    "SlidesDialog__slide--drop-after":
                      dropIndex === frames.length &&
                      index === frames.length - 1,
                  })}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", frame.id);
                    setDraggedId(frame.id);
                  }}
                  onDragOver={(event) => {
                    if (!draggedId) {
                      return;
                    }
                    event.preventDefault();
                    const { top, height } =
                      event.currentTarget.getBoundingClientRect();
                    setDropIndex(
                      event.clientY < top + height / 2 ? index : index + 1,
                    );
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const fromIndex = frames.findIndex(
                      (frame) => frame.id === draggedId,
                    );
                    if (fromIndex !== -1 && dropIndex !== null) {
                      // the dragged slide leaves its place first
                      move(
                        fromIndex,
                        dropIndex > fromIndex ? dropIndex - 1 : dropIndex,
                      );
                    }
                    endDrag();
                  }}
                  onDragEnd={endDrag}
                >
                  <span className="SlidesDialog__grip" aria-hidden="true">
                    {gripVerticalIcon}
                  </span>
                  <span className="SlidesDialog__number">{index + 1}</span>
                  <span className="SlidesDialog__preview">
                    {preview && <img src={preview} alt="" draggable={false} />}
                  </span>
                  <span className="SlidesDialog__title" title={title}>
                    {title}
                  </span>
                  <span className="SlidesDialog__moves">
                    <button
                      type="button"
                      onClick={() => move(index, index - 1)}
                      disabled={index === 0}
                      title={t("presentation.moveUp")}
                      aria-label={`${t("presentation.moveUp")}: ${title}`}
                    >
                      {chevronUpIcon}
                    </button>
                    <button
                      type="button"
                      onClick={() => move(index, index + 1)}
                      disabled={index === frames.length - 1}
                      title={t("presentation.moveDown")}
                      aria-label={`${t("presentation.moveDown")}: ${title}`}
                    >
                      {chevronDownIcon}
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>
          <div className="SlidesDialog__actions">
            <FilledButton
              variant="outlined"
              label={t("presentation.alphabeticalOrder")}
              onClick={() => setSlideOrder(app, null)}
              disabled={!hasCustomSlideOrder(frames)}
            />
            <FilledButton
              label={t("presentation.present")}
              onClick={() => {
                close();
                startPresentation(app, 0);
              }}
            />
          </div>
        </>
      )}
    </Dialog>
  );
};
