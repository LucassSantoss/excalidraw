import {
  isTransparent,
  MAX_CUSTOM_COLORS_USED_IN_CANVAS,
} from "@excalidraw/common";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import type { ColorPickerColor, ColorPaletteCustom } from "@excalidraw/common";

import { atom } from "../../editor-jotai";

export const getColorNameAndShadeFromColor = ({
  palette,
  color,
}: {
  palette: ColorPaletteCustom;
  color: string | null;
}): {
  colorName: ColorPickerColor;
  shade: number | null;
} | null => {
  if (!color) {
    return null;
  }
  for (const [colorName, colorVal] of Object.entries(palette)) {
    if (Array.isArray(colorVal)) {
      const shade = colorVal.indexOf(color);
      if (shade > -1) {
        return { colorName: colorName as ColorPickerColor, shade };
      }
    } else if (colorVal === color) {
      return { colorName: colorName as ColorPickerColor, shade: null };
    }
  }
  return null;
};

/**
 * the built-in top picks with the host's per-position defaults applied.
 * A built-in pick whose color a default already shows elsewhere is replaced
 * by the built-in color that default displaced, so no color is shown twice.
 */
export const applyTopPicksDefaults = (
  builtInPicks: readonly string[],
  defaults: readonly (string | null)[] | undefined,
): readonly string[] => {
  if (!defaults?.some(Boolean)) {
    return builtInPicks;
  }
  const fromDefaults = new Set(defaults.filter(Boolean));
  const picks = builtInPicks.map(
    (color, index) =>
      defaults[index] || (fromDefaults.has(color) ? null : color),
  );
  const used = new Set(picks);
  const leftover = builtInPicks.filter((color) => !used.has(color));
  return picks.map(
    (pick, index) => pick ?? leftover.shift() ?? builtInPicks[index],
  );
};

export const colorPickerHotkeyBindings = [
  ["q", "w", "e", "r", "t"],
  ["a", "s", "d", "f", "g"],
  ["z", "x", "c", "v", "b"],
].flat();

export const isCustomColor = ({
  color,
  palette,
}: {
  color: string;
  palette: ColorPaletteCustom;
}) => {
  const paletteValues = Object.values(palette).flat();
  return !paletteValues.includes(color);
};

export const getMostUsedCustomColors = (
  elements: readonly ExcalidrawElement[],
  type: "elementBackground" | "elementStroke",
  palette: ColorPaletteCustom,
) => {
  const elementColorTypeMap = {
    elementBackground: "backgroundColor",
    elementStroke: "strokeColor",
  };

  const colors = elements.filter((element) => {
    if (element.isDeleted) {
      return false;
    }

    const color =
      element[elementColorTypeMap[type] as "backgroundColor" | "strokeColor"];

    // fully-transparent colors are "no color", not a reusable custom color
    // (matters for palettes that exclude `transparent`, e.g. bucket fill)
    return !isTransparent(color) && isCustomColor({ color, palette });
  });

  const colorCountMap = new Map<string, number>();
  colors.forEach((element) => {
    const color =
      element[elementColorTypeMap[type] as "backgroundColor" | "strokeColor"];
    if (colorCountMap.has(color)) {
      colorCountMap.set(color, colorCountMap.get(color)! + 1);
    } else {
      colorCountMap.set(color, 1);
    }
  });

  return [...colorCountMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map((c) => c[0])
    .slice(0, MAX_CUSTOM_COLORS_USED_IN_CANVAS);
};

export type ActiveColorPickerSectionAtomType =
  | "custom"
  | "baseColors"
  | "shades"
  | "hex"
  | null;
export const activeColorPickerSectionAtom =
  atom<ActiveColorPickerSectionAtomType>(null);

export type ColorPickerType =
  | "canvasBackground"
  | "elementBackground"
  | "elementStroke";
