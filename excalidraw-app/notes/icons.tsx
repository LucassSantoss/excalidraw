import { createIcon } from "@excalidraw/excalidraw/components/icons";

// tabler icons (https://tabler.io/icons), same style as the editor's
const tablerIconProps = {
  width: 24,
  height: 24,
  fill: "none",
  strokeWidth: 2,
  stroke: "currentColor",
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export const folderIcon = createIcon(
  <path d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2" />,
  tablerIconProps,
);

export const folderPlusIcon = createIcon(
  <g>
    <path d="M12 19h-7a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2h4l3 3h7a2 2 0 0 1 2 2v3.5" />
    <path d="M16 19h6" />
    <path d="M19 16v6" />
  </g>,
  tablerIconProps,
);

export const calendarIcon = createIcon(
  <g>
    <path d="M4 7a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12z" />
    <path d="M16 3v4" />
    <path d="M8 3v4" />
    <path d="M4 11h16" />
    <path d="M11 15h1" />
    <path d="M12 15v3" />
  </g>,
  tablerIconProps,
);

export const chevronRightIcon = createIcon(
  <path d="M9 6l6 6l-6 6" />,
  tablerIconProps,
);
