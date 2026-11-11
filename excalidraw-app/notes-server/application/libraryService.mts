import { parseLibrary } from "../domain/library.mts";

import type { LibraryRepository } from "./ports.mts";

export const createLibraryService = ({
  library,
}: {
  library: LibraryRepository;
}) => ({
  /** `null` until the library is first saved */
  load: () => library.find(),
  save: (data: Record<string, unknown>) =>
    library.save(parseLibrary(data), Date.now()),
});

export type LibraryService = ReturnType<typeof createLibraryService>;
