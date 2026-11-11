import React from "react";

import { KEYS } from "@excalidraw/common";
import { CaptureUpdateAction } from "@excalidraw/element";

import { Excalidraw } from "../index";
import { editorJotaiStore } from "../editor-jotai";
import {
  getPresentationFrames,
  getStartSlideIndex,
  setSlideOrder,
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

describe("getStartSlideIndex", () => {
  const frames = [
    createFrame("A", 0),
    createFrame("B", 200),
    createFrame("C", 400),
  ];
  const offscreen = { x: 5000, y: 5000, width: 100, height: 100 };

  it("starts on the frame of the selection", () => {
    expect(
      getStartSlideIndex(frames, {
        selectedFrameIds: ["missing", frames[2].id],
        viewport: { x: 0, y: 0, width: 100, height: 100 },
      }),
    ).toBe(2);
  });

  it("else on the frame taking up most of the screen", () => {
    expect(
      getStartSlideIndex(frames, {
        selectedFrameIds: [],
        // mostly over B, a bit over C
        viewport: { x: 220, y: 0, width: 250, height: 80 },
      }),
    ).toBe(1);
  });

  it("among frames as much in view, on the one closest to the center", () => {
    expect(
      getStartSlideIndex(frames, {
        selectedFrameIds: [],
        // all three fully in view, centered on C
        viewport: { x: -200, y: -500, width: 1300, height: 1000 },
      }),
    ).toBe(2);
  });

  it("else on the first frame", () => {
    expect(
      getStartSlideIndex(frames, { selectedFrameIds: [], viewport: offscreen }),
    ).toBe(0);
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
    // no frame in view: starts on the first one
    API.setAppState({ scrollX: -5000, scrollY: -5000 });

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

describe("presentation: starting slide", () => {
  beforeEach(async () => {
    mockBoundingClientRect();
    await render(<Excalidraw handleKeyboardGlobally={true} />);
    await waitFor(() => expect(h.state.width).toBe(200));
  });

  afterEach(() => {
    act(() => editorJotaiStore.set(presentationAtom, null));
    restoreOriginalGetBoundingClientRect();
  });

  it("starts on the selected frame, or the frame of the selection", () => {
    const first = createFrame("1", 0);
    const second = createFrame("2", 2000);
    const inSecond = API.createElement({
      type: "rectangle",
      x: 2010,
      y: 10,
      width: 20,
      height: 20,
      frameId: second.id,
    });
    API.setElements([first, second, inSecond]);

    API.setSelectedElements([second]);
    act(() => startPresentation(h.app));
    expect(currentFrameId()).toBe(second.id);
    Keyboard.keyPress(KEYS.ESCAPE);

    API.setSelectedElements([inSecond]);
    act(() => startPresentation(h.app));
    expect(currentFrameId()).toBe(second.id);
  });

  it("starts on the frame in view", () => {
    const first = createFrame("1", 0);
    const second = createFrame("2", 2000);
    API.setElements([first, second]);
    API.setAppState({ scrollX: -1990, scrollY: 0 });

    act(() => startPresentation(h.app));
    expect(currentFrameId()).toBe(second.id);
  });
});

describe("presentation: slide order", () => {
  beforeEach(async () => {
    mockBoundingClientRect();
    await render(<Excalidraw handleKeyboardGlobally={true} />);
    await waitFor(() => expect(h.state.width).toBe(200));
  });

  afterEach(() => {
    restoreOriginalGetBoundingClientRect();
  });

  const order = () =>
    getPresentationFrames(h.app.scene.getNonDeletedFramesLikes()).map(
      (frame) => frame.name,
    );

  it("follows the order set, then sorts new frames by name", () => {
    API.setElements([
      createFrame("B", 0),
      createFrame("A", 200),
      createFrame("C", 400),
    ]);
    expect(order()).toEqual(["A", "B", "C"]);

    const [a, b, c] = getPresentationFrames(
      h.app.scene.getNonDeletedFramesLikes(),
    );
    act(() => setSlideOrder(h.app, [c.id, a.id, b.id]));
    expect(order()).toEqual(["C", "A", "B"]);

    // a frame added since goes last
    API.setElements([...h.elements, createFrame("0", 600)]);
    expect(order()).toEqual(["C", "A", "B", "0"]);

    act(() => setSlideOrder(h.app, null));
    expect(order()).toEqual(["0", "A", "B", "C"]);
    expect(
      h.app.scene
        .getNonDeletedFramesLikes()
        .every((frame) => !("presentationOrder" in (frame.customData ?? {}))),
    ).toBe(true);
  });

  it("is an undoable change of the drawing", () => {
    // drawn: part of the history
    API.updateScene({
      elements: [createFrame("A", 0), createFrame("B", 200)],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    const [a, b] = getPresentationFrames(
      h.app.scene.getNonDeletedFramesLikes(),
    );
    act(() => setSlideOrder(h.app, [b.id, a.id]));
    expect(order()).toEqual(["B", "A"]);

    Keyboard.withModifierKeys({ ctrl: true }, () => {
      Keyboard.keyPress(KEYS.Z);
    });
    expect(order()).toEqual(["A", "B"]);
  });

  it("is changed from the slides dialog", async () => {
    API.setElements([createFrame("A", 0), createFrame("B", 200)]);
    const { container, getByTestId, findAllByRole, findByText } =
      GlobalTestState.renderResult;

    fireEvent.click(
      container.querySelector(".App-toolbar__extra-tools-trigger")!,
    );
    fireEvent.click(await waitFor(() => getByTestId("toolbar-slides")));
    await findByText(
      "Drag the slides (or use the arrows) to change the order of the presentation.",
    );

    const [moveADown] = (await findAllByRole("button", {
      name: /Move down/,
    })) as HTMLButtonElement[];
    fireEvent.click(moveADown);
    expect(order()).toEqual(["B", "A"]);
    expect(
      // the dialog is rendered in a portal
      [...document.querySelectorAll(".SlidesDialog__title")].map(
        (title) => title.textContent,
      ),
    ).toEqual(["B", "A"]);
  });
});
