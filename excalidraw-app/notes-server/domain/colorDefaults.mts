import { InvalidInputError, NotFoundError } from "./errors.mts";

/**
 * Default colors of the color pickers' top picks, per picker ("slot") and
 * position, used by notes without their own picks. `null` (or a missing
 * position): the built-in color.
 */
export type ColorDefaults = Record<string, (string | null)[]>;

/** the color pickers whose top picks can get default colors
 * (`AppState["colorTopPicks"]` keys) */
const COLOR_TOP_PICKS_SLOTS = new Set([
  "elementStroke",
  "elementBackground",
  "bucketFill",
  "stickyNoteStroke",
  "stickyNoteBackground",
]);
const MAX_COLOR_TOP_PICKS = 20;
const MAX_COLOR_LENGTH = 64;

export const assertColorTopPicksSlot = (slot: string) => {
  if (!COLOR_TOP_PICKS_SLOTS.has(slot)) {
    throw new NotFoundError("unknown color picker");
  }
};

/** validates the per-position defaults of a color picker (`null`: none) */
export const parseColorDefaults = (defaults: unknown) => {
  if (!Array.isArray(defaults) || defaults.length > MAX_COLOR_TOP_PICKS) {
    throw new InvalidInputError(
      `defaults must be an array of up to ${MAX_COLOR_TOP_PICKS} colors`,
    );
  }
  return defaults.map((color) => {
    if (color === null || color === "") {
      return null;
    }
    if (typeof color !== "string" || color.length > MAX_COLOR_LENGTH) {
      throw new InvalidInputError("invalid color");
    }
    return color;
  });
};
