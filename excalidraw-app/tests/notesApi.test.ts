import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { createNotesApi } from "../notes-server/notesApi.mts";

import type { AddressInfo } from "node:net";

/**
 * Behavior of the local notes API (`/api/*`), route by route, including its
 * error statuses and messages: scripts and agents rely on it (see
 * `notes-server/README.md`).
 */

// 1×1 transparent PNG
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const PNG_DATA_URL = `data:image/png;base64,${PNG_BASE64}`;

let dir: string;
let dbFile: string;
let server: http.Server | null;
let baseURL: string;

const startServer = async () => {
  const api = createNotesApi(dbFile);
  server = http.createServer((req, res) =>
    api(req, res, () => {
      // requests the API doesn't handle fall through to the next handler
      res.statusCode = 418;
      res.end("next");
    }),
  );
  await new Promise<void>((resolve) => server!.listen(0, resolve));
  baseURL = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
};

const stopServer = async () => {
  await new Promise((resolve) => server?.close(resolve));
  server = null;
};

const request = async (
  method: string,
  url: string,
  body?: unknown,
  { raw }: { raw?: string } = {},
) => {
  const response = await fetch(`${baseURL}${url}`, {
    method,
    headers:
      body !== undefined || raw !== undefined
        ? { "Content-Type": "application/json" }
        : undefined,
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const text = await response.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return {
    status: response.status,
    body: json,
    headers: response.headers,
  };
};

const createNote = async (fields: Record<string, unknown> = {}) =>
  (await request("POST", "/api/notes", fields)).body;

const createFolder = async (name: string) =>
  (await request("POST", "/api/folders", { name })).body;

/** waits so the next write gets a later `Date.now()` */
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "notes-api-"));
  dbFile = path.join(dir, "notes.db");
  await startServer();
});

afterEach(async () => {
  await stopServer();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("notes API: routing", () => {
  it("passes requests outside its routes to the next handler", async () => {
    expect((await request("GET", "/")).status).toBe(418);
    expect((await request("GET", "/api/other")).status).toBe(418);
    expect((await request("GET", "/api/notesx")).status).toBe(418);
  });

  it("answers unknown methods and actions with 405", async () => {
    const note = await createNote();
    expect(await request("PATCH", "/api/notes")).toMatchObject({
      status: 405,
      body: { error: "method not allowed" },
    });
    expect((await request("POST", `/api/notes/${note.id}`)).status).toBe(405);
    expect((await request("GET", `/api/notes/${note.id}/other`)).status).toBe(
      405,
    );
    expect((await request("DELETE", "/api/library")).status).toBe(405);
    // deeper paths under the API's resources are unknown routes
    expect(await request("POST", "/api/folders/x/y")).toMatchObject({
      status: 404,
      body: { error: "not found" },
    });
  });

  it("rejects invalid JSON", async () => {
    expect(
      await request("POST", "/api/notes", undefined, { raw: "{nope" }),
    ).toMatchObject({ status: 400, body: { error: "invalid JSON" } });
  });

  it("sends JSON that isn't cached", async () => {
    const response = await request("GET", "/api/notes");
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("notes API: notes", () => {
  it("creates notes and lists them, most recently updated first", async () => {
    expect((await request("GET", "/api/notes")).body).toEqual([]);

    const created = await request("POST", "/api/notes", { title: "First" });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({
      id: expect.any(String),
      title: "First",
      folderId: null,
      isDaily: false,
      createdAt: expect.any(Number),
      updatedAt: created.body.createdAt,
      hasThumbnail: false,
      needsThumbnail: false,
      thumbnailVersion: 0,
    });

    await tick();
    const second = await createNote();
    expect(second.title).toBe("");
    await tick();
    await request("PUT", `/api/notes/${created.body.id}`, { title: "First!" });

    const titles = (await request("GET", "/api/notes")).body.map(
      (note: { title: string }) => note.title,
    );
    expect(titles).toEqual(["First!", ""]);
  });

  it("creates notes inside a folder, but not inside the daily one", async () => {
    const folder = await createFolder("Work");
    expect((await createNote({ folderId: folder.id })).folderId).toBe(
      folder.id,
    );
    expect(
      await request("POST", "/api/notes", { folderId: "missing" }),
    ).toMatchObject({ status: 400, body: { error: "folder not found" } });

    const daily = await request("POST", "/api/notes/daily", {
      date: "2026-01-02",
    });
    expect(
      await request("POST", "/api/notes", { folderId: daily.body.folderId }),
    ).toMatchObject({
      status: 403,
      body: { error: "only daily notes can be in this folder" },
    });
  });

  it("loads a note with its scene", async () => {
    const note = await createNote({ title: "A" });
    expect((await request("GET", `/api/notes/${note.id}`)).body).toEqual({
      ...note,
      elements: [],
      appState: {},
      files: {},
    });
    expect(await request("GET", "/api/notes/missing")).toMatchObject({
      status: 404,
      body: { error: "note not found" },
    });
  });

  it("updates the title, scene and files", async () => {
    const note = await createNote();
    await tick();
    const elements = [
      { id: "a", type: "image", fileId: "f1" },
      { id: "b", type: "image", fileId: "f2" },
    ];
    const files = {
      f1: { id: "f1", dataURL: "data:x", mimeType: "image/png" },
      f2: { id: "f2", dataURL: "data:y", mimeType: "image/png" },
    };
    const updated = await request("PUT", `/api/notes/${note.id}`, {
      title: "  Trimmed  ",
      elements,
      appState: { viewBackgroundColor: "#fff" },
      files,
    });
    expect(updated.status).toBe(200);
    expect(updated.body.title).toBe("Trimmed");
    expect(updated.body.updatedAt).toBeGreaterThan(note.updatedAt);

    const loaded = (await request("GET", `/api/notes/${note.id}`)).body;
    expect(loaded.elements).toEqual(elements);
    expect(loaded.appState).toEqual({ viewBackgroundColor: "#fff" });
    expect(loaded.files).toEqual(files);

    // files already stored are kept as they are
    await request("PUT", `/api/notes/${note.id}`, {
      files: { f1: { id: "f1", dataURL: "data:changed" } },
    });
    expect(
      (await request("GET", `/api/notes/${note.id}`)).body.files.f1.dataURL,
    ).toBe("data:x");

    // images no element references anymore are dropped
    await request("PUT", `/api/notes/${note.id}`, {
      elements: [elements[0]],
    });
    expect(
      Object.keys((await request("GET", `/api/notes/${note.id}`)).body.files),
    ).toEqual(["f1"]);

    expect(
      (await request("PUT", "/api/notes/missing", { title: "x" })).status,
    ).toBe(404);
  });

  it("stores, serves and clears thumbnails", async () => {
    const note = await createNote();
    expect(
      await request("GET", `/api/notes/${note.id}/thumbnail`),
    ).toMatchObject({ status: 404, body: { error: "thumbnail not found" } });

    const updated = await request("PUT", `/api/notes/${note.id}`, {
      thumbnail: PNG_DATA_URL,
    });
    expect(updated.body.hasThumbnail).toBe(true);
    const thumbnail = await fetch(`${baseURL}/api/notes/${note.id}/thumbnail`);
    expect(thumbnail.status).toBe(200);
    expect(thumbnail.headers.get("content-type")).toBe("image/png");
    expect(thumbnail.headers.get("cache-control")).toBe("no-cache");
    expect(Buffer.from(await thumbnail.arrayBuffer()).toString("base64")).toBe(
      PNG_BASE64,
    );

    expect(
      await request("PUT", `/api/notes/${note.id}`, { thumbnail: "nope" }),
    ).toMatchObject({ status: 400, body: { error: "invalid thumbnail" } });

    await request("PUT", `/api/notes/${note.id}`, { thumbnail: null });
    expect(
      (await request("GET", `/api/notes/${note.id}/thumbnail`)).status,
    ).toBe(404);
  });

  it("moves notes between folders without bumping updatedAt", async () => {
    const folder = await createFolder("Work");
    const note = await createNote();
    await tick();

    const moved = await request("PUT", `/api/notes/${note.id}`, {
      folderId: folder.id,
    });
    expect(moved.body.folderId).toBe(folder.id);
    expect(moved.body.updatedAt).toBe(note.updatedAt);

    const back = await request("PUT", `/api/notes/${note.id}`, {
      folderId: null,
    });
    expect(back.body.folderId).toBe(null);

    expect(
      await request("PUT", `/api/notes/${note.id}`, { folderId: "missing" }),
    ).toMatchObject({ status: 400, body: { error: "folder not found" } });
  });

  it("deletes a note", async () => {
    const note = await createNote();
    const response = await fetch(`${baseURL}/api/notes/${note.id}`, {
      method: "DELETE",
    });
    expect(response.status).toBe(204);
    expect((await request("GET", `/api/notes/${note.id}`)).status).toBe(404);
    expect((await request("DELETE", `/api/notes/${note.id}`)).status).toBe(404);
  });

  it("duplicates a note with its scene, images and thumbnail", async () => {
    const folder = await createFolder("Work");
    const note = await createNote({ title: "Plan", folderId: folder.id });
    await request("PUT", `/api/notes/${note.id}`, {
      elements: [{ id: "a", type: "image", fileId: "f1" }],
      appState: { zoom: { value: 2 } },
      files: { f1: { id: "f1", dataURL: "data:x" } },
      thumbnail: PNG_DATA_URL,
    });

    const copy = await request("POST", `/api/notes/${note.id}/duplicate`);
    expect(copy.status).toBe(201);
    expect(copy.body).toMatchObject({
      title: "Plan (cópia)",
      folderId: folder.id,
      isDaily: false,
      hasThumbnail: true,
    });
    expect(copy.body.id).not.toBe(note.id);
    const loaded = (await request("GET", `/api/notes/${copy.body.id}`)).body;
    expect(loaded.elements).toEqual([{ id: "a", type: "image", fileId: "f1" }]);
    expect(loaded.appState).toEqual({ zoom: { value: 2 } });
    expect(loaded.files).toEqual({ f1: { id: "f1", dataURL: "data:x" } });

    const untitled = await createNote();
    expect(
      (await request("POST", `/api/notes/${untitled.id}/duplicate`)).body.title,
    ).toBe("Sem título (cópia)");
    expect((await request("POST", "/api/notes/missing/duplicate")).status).toBe(
      404,
    );
  });
});

describe("notes API: daily notes", () => {
  it("creates the note of the day once, in the daily notes folder", async () => {
    const first = await request("POST", "/api/notes/daily", {
      date: "2026-03-04",
      title: "  Quarta  ",
    });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ title: "Quarta", isDaily: true });

    const folders = (await request("GET", "/api/folders")).body;
    expect(folders).toEqual([
      {
        id: first.body.folderId,
        name: "Notas Diárias",
        kind: "daily",
        createdAt: expect.any(Number),
        noteCount: 1,
      },
    ]);

    const again = await request("POST", "/api/notes/daily", {
      date: "2026-03-04",
      title: "Other",
    });
    expect(again.body.id).toBe(first.body.id);

    // a title defaults to the date; the daily folder is reused
    const other = await request("POST", "/api/notes/daily", {
      date: "2026-03-05",
    });
    expect(other.body.title).toBe("2026-03-05");
    expect(other.body.folderId).toBe(first.body.folderId);
  });

  it("finds the note of a day without creating it", async () => {
    expect(
      await request("GET", "/api/notes/daily?date=2026-03-04"),
    ).toMatchObject({ status: 200, body: null });
    expect((await request("GET", "/api/notes")).body).toEqual([]);

    const created = await request("POST", "/api/notes/daily", {
      date: "2026-03-04",
      title: "Quarta",
    });
    const found = await request("GET", "/api/notes/daily?date=2026-03-04");
    expect(found.body).toEqual(created.body);

    expect(await request("GET", "/api/notes/daily?date=hoje")).toMatchObject({
      status: 400,
      body: { error: "date must be YYYY-MM-DD" },
    });
  });

  it("validates the date", async () => {
    for (const date of [undefined, "2026-3-4", "hoje", 20260304]) {
      expect(await request("POST", "/api/notes/daily", { date })).toMatchObject(
        { status: 400, body: { error: "date must be YYYY-MM-DD" } },
      );
    }
  });

  it("keeps the daily folder for daily notes only", async () => {
    const daily = (
      await request("POST", "/api/notes/daily", { date: "2026-03-04" })
    ).body;
    const note = await createNote();
    expect(
      await request("PUT", `/api/notes/${note.id}`, {
        folderId: daily.folderId,
      }),
    ).toMatchObject({
      status: 403,
      body: { error: "only daily notes can be in this folder" },
    });

    // a daily note can leave its folder, and come back
    expect(
      (await request("PUT", `/api/notes/${daily.id}`, { folderId: null })).body
        .folderId,
    ).toBe(null);
    expect(
      (
        await request("PUT", `/api/notes/${daily.id}`, {
          folderId: daily.folderId,
        })
      ).body.folderId,
    ).toBe(daily.folderId);

    // a copy isn't a daily note: it goes to the root
    const copy = (await request("POST", `/api/notes/${daily.id}/duplicate`))
      .body;
    expect(copy).toMatchObject({ isDaily: false, folderId: null });
  });
});

describe("notes API: deleting several notes", () => {
  it("deletes all the given notes", async () => {
    const a = await createNote({ title: "A" });
    await createNote({ title: "B" });
    const c = await createNote({ title: "C" });

    const response = await request("DELETE", "/api/notes", {
      ids: [a.id, c.id, a.id],
    });

    expect(response).toMatchObject({ status: 200, body: { deleted: 2 } });
    expect(
      (await request("GET", "/api/notes")).body.map(
        (note: { title: string }) => note.title,
      ),
    ).toEqual(["B"]);
  });

  it("deletes none if one of the notes doesn't exist", async () => {
    const a = await createNote({ title: "A" });
    await createNote({ title: "B" });

    expect(
      await request("DELETE", "/api/notes", { ids: [a.id, "missing"] }),
    ).toMatchObject({ status: 404, body: { error: "note not found" } });
    expect((await request("GET", "/api/notes")).body).toHaveLength(2);
  });

  it("rejects a missing or empty list of ids", async () => {
    await createNote({ title: "A" });

    for (const body of [{ ids: [] }, {}, { ids: [1] }, { ids: "x" }]) {
      expect(await request("DELETE", "/api/notes", body)).toMatchObject({
        status: 400,
        body: { error: "ids must be a non-empty array of note ids" },
      });
    }
    expect((await request("GET", "/api/notes")).body).toHaveLength(1);
  });
});

describe("notes API: folders", () => {
  it("creates, lists, renames and deletes folders", async () => {
    const created = await request("POST", "/api/folders", { name: "  zeta " });
    expect(created).toMatchObject({
      status: 201,
      body: { name: "zeta", kind: null, noteCount: 0 },
    });
    await createFolder("Alpha");
    await request("POST", "/api/notes/daily", { date: "2026-01-01" });
    await createNote({ folderId: created.body.id });

    // app-managed folders first, then alphabetically (case-insensitive)
    expect(
      (await request("GET", "/api/folders")).body.map(
        (folder: { name: string; noteCount: number }) => [
          folder.name,
          folder.noteCount,
        ],
      ),
    ).toEqual([
      ["Notas Diárias", 1],
      ["Alpha", 0],
      ["zeta", 1],
    ]);

    const renamed = await request("PUT", `/api/folders/${created.body.id}`, {
      name: " Zeta ",
    });
    expect(renamed).toMatchObject({
      status: 200,
      body: { name: "Zeta", noteCount: 1 },
    });

    const note = (await request("GET", "/api/notes")).body.find(
      (note: { folderId: string }) => note.folderId === created.body.id,
    );
    const deleted = await fetch(`${baseURL}/api/folders/${created.body.id}`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(204);
    // its notes go back to the root
    expect((await request("GET", `/api/notes/${note.id}`)).body.folderId).toBe(
      null,
    );
  });

  it("validates folder names and ids", async () => {
    for (const body of [{}, { name: "   " }, { name: 3 }]) {
      expect(await request("POST", "/api/folders", body)).toMatchObject({
        status: 400,
        body: { error: "folder name is required" },
      });
    }
    const folder = await createFolder("Work");
    expect(
      (await request("PUT", `/api/folders/${folder.id}`, { name: "" })).status,
    ).toBe(400);
    expect(
      await request("PUT", "/api/folders/missing", { name: "x" }),
    ).toMatchObject({ status: 404, body: { error: "folder not found" } });
    expect((await request("DELETE", "/api/folders/missing")).status).toBe(404);
    expect((await request("POST", `/api/folders/${folder.id}`)).status).toBe(
      405,
    );
  });

  it("protects the daily notes folder", async () => {
    const { folderId } = (
      await request("POST", "/api/notes/daily", { date: "2026-01-01" })
    ).body;
    const error = {
      status: 403,
      body: { error: "this folder can't be renamed or deleted" },
    };
    expect(
      await request("PUT", `/api/folders/${folderId}`, { name: "x" }),
    ).toMatchObject(error);
    expect(await request("DELETE", `/api/folders/${folderId}`)).toMatchObject(
      error,
    );
  });
});

describe("notes API: shape library", () => {
  it("stores the library", async () => {
    expect(await request("GET", "/api/library")).toMatchObject({
      status: 200,
      body: null,
    });
    expect(
      await request("PUT", "/api/library", { libraryItems: "x" }),
    ).toMatchObject({
      status: 400,
      body: { error: "libraryItems must be an array" },
    });

    const library = { libraryItems: [{ id: "item", elements: [] }] };
    const saved = await fetch(`${baseURL}/api/library`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(library),
    });
    expect(saved.status).toBe(204);
    expect((await request("GET", "/api/library")).body).toEqual(library);
  });
});

describe("notes API: color defaults", () => {
  it("stores the default colors of each color picker", async () => {
    expect((await request("GET", "/api/color-defaults")).body).toEqual({});

    expect(
      await request("PUT", "/api/color-defaults/elementStroke", {
        defaults: [null, "#e03131", "", "#1971c2"],
      }),
    ).toMatchObject({
      status: 200,
      body: { elementStroke: [null, "#e03131", null, "#1971c2"] },
    });
    await request("PUT", "/api/color-defaults/stickyNoteBackground", {
      defaults: ["#ffec99"],
    });
    // replaces the slot's defaults
    expect(
      (
        await request("PUT", "/api/color-defaults/elementStroke", {
          defaults: [null, null, "#2f9e44"],
        })
      ).body,
    ).toEqual({
      elementStroke: [null, null, "#2f9e44"],
      stickyNoteBackground: ["#ffec99"],
    });
  });

  it("validates the slot and the colors", async () => {
    expect(
      await request("PUT", "/api/color-defaults/nope", { defaults: [] }),
    ).toMatchObject({ status: 404, body: { error: "unknown color picker" } });
    for (const defaults of ["x", new Array(21).fill("#000")]) {
      expect(
        await request("PUT", "/api/color-defaults/bucketFill", { defaults }),
      ).toMatchObject({
        status: 400,
        body: { error: "defaults must be an array of up to 20 colors" },
      });
    }
    for (const color of [3, "#".repeat(65)]) {
      expect(
        await request("PUT", "/api/color-defaults/bucketFill", {
          defaults: [color],
        }),
      ).toMatchObject({ status: 400, body: { error: "invalid color" } });
    }
    expect(
      (await request("GET", "/api/color-defaults/bucketFill")).status,
    ).toBe(405);
    expect((await request("PUT", "/api/color-defaults")).status).toBe(405);
  });
});

describe("notes API: database", () => {
  it("keeps the data across restarts", async () => {
    const note = await createNote({ title: "Persisted" });
    await stopServer();
    await startServer();
    expect((await request("GET", `/api/notes/${note.id}`)).body.title).toBe(
      "Persisted",
    );
  });

  it("migrates databases from before folders and daily notes", async () => {
    await stopServer();
    fs.rmSync(dbFile, { force: true });
    fs.rmSync(`${dbFile}-wal`, { force: true });
    fs.rmSync(`${dbFile}-shm`, { force: true });
    const old = new DatabaseSync(dbFile);
    old.exec(`
      CREATE TABLE notes (
        id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '',
        elements TEXT NOT NULL DEFAULT '[]', app_state TEXT NOT NULL DEFAULT '{}',
        thumbnail BLOB, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      INSERT INTO notes (id, title, created_at, updated_at)
        VALUES ('old', 'Old note', 1, 1);
      INSERT INTO notes (id, title, elements, created_at, updated_at)
        VALUES ('drawn', 'Drawn', '[{"id":"a"}]', 0, 0);
    `);
    old.close();

    await startServer();
    const notes = (await request("GET", "/api/notes")).body;
    // a scene without a thumbnail (e.g. saved through the API) needs one
    expect(notes[1]).toMatchObject({ id: "drawn", needsThumbnail: true });
    expect(notes.slice(0, 1)).toEqual([
      {
        id: "old",
        title: "Old note",
        folderId: null,
        isDaily: false,
        createdAt: 1,
        updatedAt: 1,
        hasThumbnail: false,
        needsThumbnail: false,
        thumbnailVersion: 0,
      },
    ]);
    expect(
      (await request("POST", "/api/notes/daily", { date: "2026-01-01" }))
        .status,
    ).toBe(200);
  });

  it("moves regular notes out of the daily folder on start", async () => {
    const daily = (
      await request("POST", "/api/notes/daily", { date: "2026-01-01" })
    ).body;
    const note = await createNote();
    await stopServer();
    // older versions allowed any note in the daily folder
    const db = new DatabaseSync(dbFile);
    db.prepare("UPDATE notes SET folder_id = ? WHERE id = ?").run(
      daily.folderId,
      note.id,
    );
    db.close();

    await startServer();
    expect((await request("GET", `/api/notes/${note.id}`)).body.folderId).toBe(
      null,
    );
    expect((await request("GET", `/api/notes/${daily.id}`)).body.folderId).toBe(
      daily.folderId,
    );
  });
});

describe("notes API: concurrent changes", () => {
  it("refuses changes made on an outdated version of the note", async () => {
    const note = await createNote({ title: "Shared" });
    await tick();
    // another window saves first
    const other = (
      await request("PUT", `/api/notes/${note.id}`, {
        elements: [{ id: "theirs" }],
        baseUpdatedAt: note.updatedAt,
      })
    ).body;
    expect(other.updatedAt).toBeGreaterThan(note.updatedAt);

    expect(
      await request("PUT", `/api/notes/${note.id}`, {
        elements: [{ id: "mine" }],
        baseUpdatedAt: note.updatedAt,
      }),
    ).toMatchObject({
      status: 409,
      body: { error: "note was changed elsewhere" },
    });
    expect(
      (await request("GET", `/api/notes/${note.id}`)).body.elements,
    ).toEqual([{ id: "theirs" }]);

    // up to date: saved
    await tick();
    expect(
      (
        await request("PUT", `/api/notes/${note.id}`, {
          elements: [{ id: "mine" }],
          baseUpdatedAt: other.updatedAt,
        })
      ).status,
    ).toBe(200);
  });

  it("always writes without a base version, and validates it", async () => {
    const note = await createNote();
    await tick();
    await request("PUT", `/api/notes/${note.id}`, { title: "Changed" });
    expect(
      (await request("PUT", `/api/notes/${note.id}`, { title: "Again" }))
        .status,
    ).toBe(200);
    expect(
      await request("PUT", `/api/notes/${note.id}`, {
        title: "x",
        baseUpdatedAt: "yesterday",
      }),
    ).toMatchObject({
      status: 400,
      body: { error: "baseUpdatedAt must be a number" },
    });
  });
});

describe("notes API: thumbnails to render", () => {
  it("flags notes whose scene changed without a thumbnail", async () => {
    const note = await createNote();
    expect(note.needsThumbnail).toBe(false);

    const saved = await request("PUT", `/api/notes/${note.id}`, {
      elements: [{ id: "a" }],
    });
    expect(saved.body.needsThumbnail).toBe(true);
    const copy = await request("POST", `/api/notes/${note.id}/duplicate`);
    expect(copy.body.needsThumbnail).toBe(true);

    const withThumbnail = await request("PUT", `/api/notes/${note.id}`, {
      elements: [{ id: "b" }],
      thumbnail: PNG_DATA_URL,
    });
    expect(withThumbnail.body).toMatchObject({
      hasThumbnail: true,
      needsThumbnail: false,
      thumbnailVersion: 1,
    });

    // other changes don't outdate the thumbnail
    const renamed = await request("PUT", `/api/notes/${note.id}`, {
      title: "Renamed",
      appState: { zoom: { value: 2 } },
    });
    expect(renamed.body.needsThumbnail).toBe(false);
  });

  it("saves a thumbnail without bumping updatedAt", async () => {
    const note = await createNote();
    const saved = (
      await request("PUT", `/api/notes/${note.id}`, {
        elements: [{ id: "a" }],
      })
    ).body;
    await tick();

    const response = await request("PUT", `/api/notes/${note.id}/thumbnail`, {
      thumbnail: PNG_DATA_URL,
      baseUpdatedAt: saved.updatedAt,
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      hasThumbnail: true,
      needsThumbnail: false,
      updatedAt: saved.updatedAt,
      thumbnailVersion: saved.thumbnailVersion + 1,
    });
    const thumbnail = await fetch(`${baseURL}/api/notes/${note.id}/thumbnail`);
    expect(Buffer.from(await thumbnail.arrayBuffer()).toString("base64")).toBe(
      PNG_BASE64,
    );

    // an empty scene has no thumbnail
    expect(
      (
        await request("PUT", `/api/notes/${note.id}/thumbnail`, {
          thumbnail: null,
        })
      ).body,
    ).toMatchObject({ hasThumbnail: false, needsThumbnail: false });
  });

  it("refuses a thumbnail of an outdated scene, and validates it", async () => {
    const note = await createNote();
    await tick();
    await request("PUT", `/api/notes/${note.id}`, { elements: [{ id: "a" }] });

    expect(
      await request("PUT", `/api/notes/${note.id}/thumbnail`, {
        thumbnail: PNG_DATA_URL,
        baseUpdatedAt: note.updatedAt,
      }),
    ).toMatchObject({
      status: 409,
      body: { error: "note was changed elsewhere" },
    });
    expect(
      (await request("GET", `/api/notes/${note.id}`)).body.needsThumbnail,
    ).toBe(true);

    expect(
      await request("PUT", `/api/notes/${note.id}/thumbnail`, {}),
    ).toMatchObject({ status: 400, body: { error: "thumbnail is required" } });
    expect(
      await request("PUT", `/api/notes/${note.id}/thumbnail`, {
        thumbnail: "nope",
      }),
    ).toMatchObject({ status: 400, body: { error: "invalid thumbnail" } });
    expect(
      (
        await request("PUT", "/api/notes/missing/thumbnail", {
          thumbnail: null,
        })
      ).status,
    ).toBe(404);
  });
});

describe("notes API: search", () => {
  const text = (id: string, value: string, extra = {}) => ({
    id,
    type: "text",
    text: value,
    originalText: value,
    ...extra,
  });

  const createDrawnNote = async (title: string, elements: unknown[]) => {
    const note = await createNote({ title });
    await request("PUT", `/api/notes/${note.id}`, { elements });
    await tick();
    return note;
  };

  const search = async (q: string) =>
    (await request("GET", `/api/notes/search?q=${encodeURIComponent(q)}`))
      .body as {
      title: string;
      matchedIn: string | null;
      snippet: string | null;
    }[];

  it("finds notes by title and by the text in their drawings", async () => {
    await createDrawnNote("Reunião de equipe", [text("a", "pauta")]);
    await createDrawnNote("Ideias", [
      text("b", "Uma reunião com o cliente sobre o orçamento do projeto"),
      { id: "f", type: "frame", name: "Slide da reunião" },
    ]);
    await createDrawnNote("Compras", [text("c", "leite, pão")]);

    // case and accents don't matter; titles first
    expect(
      (await search("REUNIAO")).map(({ title, matchedIn }) => [
        title,
        matchedIn,
      ]),
    ).toEqual([
      ["Reunião de equipe", "title"],
      ["Ideias", "content"],
    ]);
    const [, content] = await search("reuniao");
    expect(content.snippet).toBe(
      // the drawing's texts, one after the other
      "Uma reunião com o cliente sobre o orçamento do projeto Slide da reunião",
    );

    // every word has to match, in the title or the drawing
    expect((await search("ideias orcamento")).map((r) => r.title)).toEqual([
      "Ideias",
    ]);
    expect(await search("ideias leite")).toEqual([]);
    // frame names count as text
    expect((await search("slide")).map((r) => r.title)).toEqual(["Ideias"]);
  });

  it("ignores deleted text and follows the drawing's changes", async () => {
    const note = await createDrawnNote("Nota", [
      text("a", "segredo", { isDeleted: true }),
    ]);
    expect(await search("segredo")).toEqual([]);

    await request("PUT", `/api/notes/${note.id}`, {
      elements: [text("a", "segredo revelado")],
    });
    expect((await search("revelado")).map((r) => r.title)).toEqual(["Nota"]);
    const copy = (await request("POST", `/api/notes/${note.id}/duplicate`))
      .body;
    expect((await search("revelado")).map((r) => r.title)).toEqual([
      copy.title,
      "Nota",
    ]);
  });

  it("lists the most recent notes without a query", async () => {
    await createNote({ title: "Velha" });
    await tick();
    await createNote({ title: "Nova" });
    const results = await search("");
    expect(results.map((r) => r.title)).toEqual(["Nova", "Velha"]);
    expect(results[0]).toMatchObject({ matchedIn: null, snippet: null });
  });

  it("indexes the drawings of existing databases", async () => {
    await stopServer();
    const old = new DatabaseSync(dbFile);
    old.exec(`ALTER TABLE notes DROP COLUMN content_text`);
    old.exec(`INSERT INTO notes (id, title, elements, created_at, updated_at)
      VALUES ('old', 'Antiga', '[{"id":"t","type":"text","text":"tesouro"}]', 1, 1)`);
    old.close();
    await startServer();
    expect((await search("tesouro")).map((r) => r.title)).toEqual(["Antiga"]);
  });
});
