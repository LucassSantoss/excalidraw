import { COLOR_TOP_PICKS_SLOTS } from "@excalidraw/common";

import { applyTopPicksDefaults } from "../components/ColorPicker/colorPickerUtils";
import { restoreAppState } from "../data/restore";

describe("restore appState.colorTopPicks", () => {
  it("dedupes notation variants and drops non-strings", () => {
    const restored = restoreAppState(
      {
        colorTopPicks: {
          elementStroke: null,
          elementBackground: [
            "#FFF",
            "#ffffff",
            "white",
            "#a5d8ff",
            "rgb(165, 216, 255)",
            "#eebefa",
            42,
            "transparent",
            "rgba(0, 0, 0, 0)",
          ],
        },
      } as any,
      null,
    );
    expect(restored.colorTopPicks.elementBackground).toEqual([
      "#FFF",
      "#a5d8ff",
      "#eebefa",
      "transparent",
    ]);
    expect(restored.colorTopPicks.elementStroke).toBe(null);
  });

  it("caps at the strip slot count and nulls malformed input", () => {
    const many = Array.from(
      { length: 20 },
      (_, i) => `#0000${String(i).padStart(2, "0")}`,
    );
    const restored = restoreAppState(
      {
        colorTopPicks: { elementStroke: many, elementBackground: "junk" },
      } as any,
      null,
    );
    expect(restored.colorTopPicks.elementStroke).toEqual(
      many.slice(0, COLOR_TOP_PICKS_SLOTS),
    );
    expect(restored.colorTopPicks.elementBackground).toBe(null);
  });
});

describe("applyTopPicksDefaults", () => {
  const builtIn = ["#a", "#b", "#c", "#d", "#e"];

  it("keeps the built-in picks without defaults", () => {
    expect(applyTopPicksDefaults(builtIn, undefined)).toBe(builtIn);
    expect(applyTopPicksDefaults(builtIn, [null, null])).toBe(builtIn);
  });

  it("replaces only the positions that have a default", () => {
    expect(applyTopPicksDefaults(builtIn, [null, "#x", null, "#y"])).toEqual([
      "#a",
      "#x",
      "#c",
      "#y",
      "#e",
    ]);
  });

  it("never shows a color twice", () => {
    // "#a" is moved to the 4th position: the displaced "#d" takes its place
    expect(applyTopPicksDefaults(builtIn, [null, null, null, "#a"])).toEqual([
      "#d",
      "#b",
      "#c",
      "#a",
      "#e",
    ]);
  });
});
