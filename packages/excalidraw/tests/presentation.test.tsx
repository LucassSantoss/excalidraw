import React from "react";

import { KEYS } from "@excalidraw/common";

import { Excalidraw } from "../index";
import { editorJotaiStore } from "../editor-jotai";
import {
  getPresentationFrames,
  presentationAtom,
  startPresentation,
} from "../components/Presentation/presentationState";

import { API } from "./helpers/api";
import { Keyboard } from "./helpers/ui";
import {
  act,
  fireEvent,
  GlobalTestState,
  mockBoundingClientRect,
  render,
  restoreOriginalGetBoundingClientRect,
  waitFor,
} from "./test-utils";

const { h } = window;

// `API.createElement` doesn't set frame names
const createFrame = (name: string | null, x: number) => ({
  ...API.createElement({ type: "frame", x, y: 0, width: 100, height: 80 }),
  name,
});

const currentFrameId = () => {
  const presentation = editorJotaiStore.get(presentationAtom);
  return presentation && presentation.frameIds[presentation.index];
};

describe("getPresentationFrames", () => {
  it("sorts frames alphabetically and numerically, keeping ties in order", () => {
    const frames = [
      createFrame("Slide 10", 0),
      createFrame("slide 2", 0),
      createFrame("Intro", 0),
      createFrame("Slide 1", 0),
      createFrame(null, 0), // "Frame"
      createFrame("Slide 2", 0),
    ];
    expect(getPresentationFrames(frames).map((frame) => frame.name)).toEqual([
      null,
      "Intro",
      "Slide 1",
      "slide 2",
      "Slide 2",
      "Slide 10",
    ]);
  });
});

describe("presentation", () => {
  beforeEach(async () => {
    mockBoundingClientRect();
    await render(<Excalidraw handleKeyboardGlobally={true} />);
    await waitFor(() => expect(h.state.width).toBe(200));
  });

  afterEach(() => {
    act(() => editorJotaiStore.set(presentationAtom, null));
    restoreOriginalGetBoundingClientRect();
  });

  it("is started from the extra tools menu", async () => {
    const frame = createFrame("Slide", 0);
    API.setElements([frame]);

    fireEvent.click(
      GlobalTestState.renderResult.container.querySelector(
        ".App-toolbar__extra-tools-trigger",
      )!,
    );
    fireEvent.click(
      await waitFor(() =>
        GlobalTestState.renderResult.getByTestId("toolbar-presentation"),
      ),
    );

    expect(currentFrameId()).toBe(frame.id);
    expect(h.state.viewModeEnabled).toBe(true);
  });

  it("goes through the frames in order with the keyboard", async () => {
    const third = createFrame("3", 0);
    const first = createFrame("1", 200);
    const second = createFrame("2", 400);
    API.setElements([third, first, second]);

    act(() => startPresentation(h.app));
    expect(currentFrameId()).toBe(first.id);

    Keyboard.keyPress(KEYS.ARROW_RIGHT);
    expect(currentFrameId()).toBe(second.id);
    Keyboard.keyPress(KEYS.SPACE);
    expect(currentFrameId()).toBe(third.id);
    // stays on the last frame
    Keyboard.keyPress(KEYS.ARROW_RIGHT);
    expect(currentFrameId()).toBe(third.id);
    Keyboard.keyPress(KEYS.ARROW_LEFT);
    expect(currentFrameId()).toBe(second.id);
    Keyboard.keyPress("Home");
    expect(currentFrameId()).toBe(first.id);
    Keyboard.keyPress("End");
    expect(currentFrameId()).toBe(third.id);
  });

  it("hides the editor UI, frame names and outlines while presenting", async () => {
    API.setElements([createFrame("Slide", 0)]);
    const { container } = GlobalTestState.renderResult;
    expect(container.querySelector(".App-toolbar")).not.toBe(null);

    act(() => startPresentation(h.app));

    expect(container.querySelector(".App-toolbar")).toBe(null);
    expect(container.querySelector(".Presentation__controls")).not.toBe(null);
    expect(h.state.frameRendering.name).toBe(false);
    expect(h.state.frameRendering.outline).toBe(false);
  });

  it("restores the editor state on Escape", async () => {
    const frame = createFrame("Slide", 0);
    API.setElements([frame]);
    API.setSelectedElements([frame]);
    const before = {
      scrollX: h.state.scrollX,
      scrollY: h.state.scrollY,
      zoom: h.state.zoom.value,
    };

    act(() => startPresentation(h.app));
    Keyboard.keyPress(KEYS.ESCAPE);

    expect(editorJotaiStore.get(presentationAtom)).toBe(null);
    expect(h.state.viewModeEnabled).toBe(false);
    expect(h.state.frameRendering.name).toBe(true);
    expect(h.state.frameRendering.outline).toBe(true);
    expect(h.state.selectedElementIds).toEqual({ [frame.id]: true });
    expect({
      scrollX: h.state.scrollX,
      scrollY: h.state.scrollY,
      zoom: h.state.zoom.value,
    }).toEqual(before);
    expect(
      GlobalTestState.renderResult.container.querySelector(".App-toolbar"),
    ).not.toBe(null);
  });

  it("explains that there's nothing to present without frames", async () => {
    API.setElements([API.createElement({ type: "rectangle" })]);

    act(() => startPresentation(h.app));

    expect(editorJotaiStore.get(presentationAtom)).toBe(null);
    expect(h.state.viewModeEnabled).toBe(false);
    expect(h.state.toast?.message).toBe(
      "Add frames to the drawing to present them",
    );
  });
});
