import {
  assertColorTopPicksSlot,
  parseColorDefaults,
} from "../domain/colorDefaults.mts";

import type { ColorDefaultsRepository, RunInTransaction } from "./ports.mts";

export const createColorDefaultsService = ({
  colorDefaults,
  transaction,
}: {
  colorDefaults: ColorDefaultsRepository;
  transaction: RunInTransaction;
}) => ({
  /** per slot, the default color of each position (`null`: built-in) */
  list: () => colorDefaults.list(),
  assertSlot: assertColorTopPicksSlot,
  /** replaces the slot's defaults; returns every slot's */
  replace: (slot: string, defaultsInput: unknown) => {
    assertColorTopPicksSlot(slot);
    const defaults = parseColorDefaults(defaultsInput);
    transaction(() => colorDefaults.replace(slot, defaults));
    return colorDefaults.list();
  },
});

export type ColorDefaultsService = ReturnType<
  typeof createColorDefaultsService
>;
