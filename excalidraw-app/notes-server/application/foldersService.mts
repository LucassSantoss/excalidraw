import { randomUUID } from "node:crypto";

import { NotFoundError } from "../domain/errors.mts";
import { assertEditableFolder, parseFolderName } from "../domain/folders.mts";

import type { FoldersRepository } from "./ports.mts";

export const createFoldersService = ({
  folders,
}: {
  folders: FoldersRepository;
}) => {
  const find = (id: string) => {
    const folder = folders.find(id);
    if (!folder) {
      throw new NotFoundError("folder not found");
    }
    return folder;
  };

  /** `kind` marks app-managed folders */
  const create = (name: string, kind: string | null = null) => {
    const id = randomUUID();
    folders.insert({ id, name, kind, now: Date.now() });
    return find(id);
  };

  return {
    list: () => folders.list(),
    find,
    create,
    createFromInput: (name: unknown) => create(parseFolderName(name)),
    /** throws unless the folder can be renamed or deleted */
    assertEditable: (id: string) => assertEditableFolder(find(id)),
    rename: (id: string, name: unknown) => {
      assertEditableFolder(find(id));
      folders.rename(id, parseFolderName(name));
      return find(id);
    },
    delete: (id: string) => {
      assertEditableFolder(find(id));
      folders.delete(id);
    },
  };
};

export type FoldersService = ReturnType<typeof createFoldersService>;
