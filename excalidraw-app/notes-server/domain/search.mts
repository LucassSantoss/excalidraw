/**
 * Searching notes by title and by the text written in their drawings,
 * regardless of case and accents ("reuniao" finds "Reunião").
 */

import type { NoteSummary } from "./notes.mts";

export type SearchableNote = {
  note: NoteSummary;
  /** the text written in the drawing (see `extractNoteText`) */
  contentText: string;
};

export type SearchResult = NoteSummary & {
  /** where the query was found */
  matchedIn: "title" | "content" | null;
  /** an excerpt of the drawing's text around the match */
  snippet: string | null;
};

const SNIPPET_BEFORE = 30;
const SNIPPET_AFTER = 70;

/** the text written in a drawing: its texts and frame names */
export const extractNoteText = (elements: unknown[]) =>
  elements
    .flatMap((element) => {
      const { type, isDeleted, text, originalText, name } = element as {
        type?: string;
        isDeleted?: boolean;
        text?: unknown;
        originalText?: unknown;
        name?: unknown;
      };
      if (isDeleted) {
        return [];
      }
      if (type === "text") {
        const value = originalText ?? text;
        return typeof value === "string" && value.trim() ? [value.trim()] : [];
      }
      if ((type === "frame" || type === "magicframe") && name) {
        return typeof name === "string" ? [name] : [];
      }
      return [];
    })
    .join("\n");

/**
 * lowercase, without accents, along with the position in `text` of each of
 * its characters (to cut the snippet out of the original text)
 */
const normalize = (text: string) => {
  let normalized = "";
  const positions: number[] = [];
  for (let index = 0; index < text.length; index++) {
    const part = text[index]
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
    normalized += part;
    for (let i = 0; i < part.length; i++) {
      positions.push(index);
    }
  }
  return { normalized, positions };
};

const getSnippet = (text: string, words: readonly string[]) => {
  const { normalized, positions } = normalize(text);
  for (const word of words) {
    const index = normalized.indexOf(word);
    if (index === -1) {
      continue;
    }
    const start = Math.max(0, positions[index] - SNIPPET_BEFORE);
    const end = Math.min(
      text.length,
      positions[index + word.length - 1] + 1 + SNIPPET_AFTER,
    );
    return `${start > 0 ? "…" : ""}${text
      .slice(start, end)
      .replace(/\s+/g, " ")
      .trim()}${end < text.length ? "…" : ""}`;
  }
  return null;
};

/**
 * the notes matching every word of the query, in the title or the drawing's
 * text: titles containing the query first, then titles containing its
 * words, then the others, most recently updated first within each group.
 * An empty query lists the most recently updated notes.
 */
export const searchNotes = (
  notes: readonly SearchableNote[],
  query: string,
  limit: number,
): SearchResult[] => {
  const normalizedQuery = normalize(query.trim()).normalized;
  const words = normalizedQuery.split(/\s+/).filter(Boolean);
  const byRecency = [...notes].sort(
    (a, b) => b.note.updatedAt - a.note.updatedAt,
  );

  if (!words.length) {
    return byRecency.slice(0, limit).map(({ note }) => ({
      ...note,
      matchedIn: null,
      snippet: null,
    }));
  }

  const results: (SearchResult & { rank: number })[] = [];
  for (const { note, contentText } of byRecency) {
    const title = normalize(note.title).normalized;
    const content = normalize(contentText).normalized;
    if (
      !words.every((word) => title.includes(word) || content.includes(word))
    ) {
      continue;
    }
    const rank = title.includes(normalizedQuery)
      ? 0
      : words.every((word) => title.includes(word))
      ? 1
      : 2;
    results.push({
      ...note,
      rank,
      matchedIn: rank < 2 ? "title" : "content",
      snippet: rank < 2 ? null : getSnippet(contentText, words),
    });
  }
  return results
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map(({ rank, ...result }) => result);
};
