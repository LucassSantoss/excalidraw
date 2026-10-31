import clsx from "clsx";
import { useState } from "react";

import {
  applyDarkModeFilter,
  COLOR_OUTLINE_CONTRAST_THRESHOLD,
  DEFAULT_CANVAS_BACKGROUND_PICKS,
  DEFAULT_ELEMENT_BACKGROUND_PICKS,
  DEFAULT_ELEMENT_STROKE_PICKS,
  isColorDark,
  THEME,
} from "@excalidraw/common";

import type { Theme } from "@excalidraw/element/types";

import { t } from "../../i18n";
import { TopPicksContextMenu } from "../TopPicksDnD/TopPicksContextMenu";
import {
  getTopPickReorderOffset,
  TopPicksDnDOutline,
} from "../TopPicksDnD/topPicksDnD";

import { useColorPickerDnD } from "./colorTopPicksDnD";

import type { ColorPickerType } from "./colorPickerUtils";

interface TopPicksProps {
  theme: Theme;
  onChange: (color: string) => void;
  type: ColorPickerType;
  activeColor: string | null;
  topPicks?: readonly string[];
  /** present when the strip is user-customizable — enables the right-click
   * context menu resetting the strip to its default picks */
  onReset?: () => void;
  /** whether custom picks are currently applied (enables the reset item) */
  isCustomized?: boolean;
  /** present when picks can become the host-wide default of their position —
   * adds a context menu item for the right-clicked pick */
  onSetAsDefault?: (index: number, color: string) => void;
  /** whether the pick already is the default of its position (read when the
   * context menu opens) */
  isDefaultPick?: (index: number, color: string) => boolean;
}

export const TopPicks = ({
  theme,
  onChange,
  type,
  activeColor,
  topPicks,
  onReset,
  isCustomized,
  onSetAsDefault,
  isDefaultPick,
}: TopPicksProps) => {
  const dnd = useColorPickerDnD();
  const dragState = dnd?.dragState ?? null;
  // the pick the context menu was opened on (`null`: the strip's gaps)
  const [contextPick, setContextPick] = useState<{
    index: number;
    color: string;
    isDefault: boolean;
  } | null>(null);

  let colors;
  if (type === "elementStroke") {
    colors = DEFAULT_ELEMENT_STROKE_PICKS;
  }

  if (type === "elementBackground") {
    colors = DEFAULT_ELEMENT_BACKGROUND_PICKS;
  }

  if (type === "canvasBackground") {
    colors = DEFAULT_CANVAS_BACKGROUND_PICKS;
  }

  // this one can overwrite defaults
  if (topPicks) {
    colors = topPicks;
  }

  if (!colors) {
    console.error("Invalid type for TopPicks");
    return null;
  }

  return (
    <TopPicksContextMenu
      onReset={onReset}
      isCustomized={!!isCustomized}
      resetLabel={t("colorPicker.resetTopPicks")}
      items={
        onSetAsDefault
          ? [
              {
                label: t("colorPicker.setAsDefaultTopPick"),
                disabled: !contextPick || contextPick.isDefault,
                onSelect: () => {
                  if (contextPick) {
                    onSetAsDefault(contextPick.index, contextPick.color);
                  }
                },
              },
            ]
          : undefined
      }
    >
      <div
        className={clsx("color-picker__top-picks top-picks-dnd", {
          "is-dnd-active": !!dragState,
        })}
        ref={dnd?.setStripEl}
        onContextMenu={
          onSetAsDefault
            ? (event) => {
                const button = (
                  event.target as HTMLElement
                ).closest<HTMLElement>("[data-top-pick-index]");
                const index = Number(button?.dataset.topPickIndex);
                const color = colors?.[index];
                setContextPick(
                  button && color
                    ? {
                        index,
                        color,
                        isDefault: !!isDefaultPick?.(index, color),
                      }
                    : null,
                );
              }
            : undefined
        }
      >
        {dragState && <TopPicksDnDOutline />}
        {colors.map((color: string, index: number) => {
          const reorderOffset = getTopPickReorderOffset(dragState, index);
          const displayColor = applyDarkModeFilter(color, theme === THEME.DARK);
          return (
            <button
              className={clsx("color-picker__button top-picks-dnd__pick", {
                active: color === activeColor,
                "is-transparent": color === "transparent" || !color,
                "has-outline": !isColorDark(
                  color,
                  COLOR_OUTLINE_CONTRAST_THRESHOLD,
                ),
                "is-dnd-source":
                  dragState?.origin.kind === "pick" &&
                  dragState.origin.index === index,
                "is-dnd-target":
                  dragState?.origin.kind === "source" &&
                  dragState.overIndex === index,
                "is-dnd-duplicate": dragState?.duplicateIndex === index,
              })}
              style={{
                "--swatch-color": displayColor,
                transform: reorderOffset
                  ? `translateX(${reorderOffset}px)`
                  : undefined,
              }}
              key={color}
              type="button"
              title={color}
              onClick={() => onChange(color)}
              onPointerDown={
                dnd
                  ? (event) => dnd.startPickDrag(event, index, color)
                  : undefined
              }
              data-testid={`color-top-pick-${color}`}
              data-top-pick-index={index}
            >
              <div className="color-picker__button-outline" />
            </button>
          );
        })}
      </div>
    </TopPicksContextMenu>
  );
};
