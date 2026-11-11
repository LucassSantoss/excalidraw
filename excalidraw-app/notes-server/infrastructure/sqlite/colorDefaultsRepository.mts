import type { DatabaseSync } from "node:sqlite";

import type { ColorDefaultsRepository } from "../../application/ports.mts";
import type { ColorDefaults } from "../../domain/colorDefaults.mts";

/** one row per slot and position that has a default color */
export const createColorDefaultsRepository = (
  db: DatabaseSync,
): ColorDefaultsRepository => {
  const list = db.prepare(
    `SELECT slot, position, color FROM color_top_pick_defaults
     ORDER BY slot, position`,
  );
  const deleteSlot = db.prepare(
    `DELETE FROM color_top_pick_defaults WHERE slot = ?`,
  );
  const insert = db.prepare(
    `INSERT INTO color_top_pick_defaults (slot, position, color)
     VALUES (?, ?, ?)`,
  );

  return {
    list: () => {
      const defaults: ColorDefaults = {};
      for (const row of list.all() as {
        slot: string;
        position: number;
        color: string;
      }[]) {
        const slot = (defaults[row.slot] ??= []);
        while (slot.length < row.position) {
          slot.push(null);
        }
        slot[row.position] = row.color;
      }
      return defaults;
    },
    replace: (slot, defaults) => {
      deleteSlot.run(slot);
      defaults.forEach((color, position) => {
        if (color) {
          insert.run(slot, position, color);
        }
      });
    },
  };
};
