import { isDarwin } from "@excalidraw/common";
import { searchIcon } from "@excalidraw/excalidraw/components/icons";
import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";

import { folderIcon } from "./icons";
import { foldersApi, notesApi } from "./notesApi";

import "./QuickSearch.scss";

import type { NoteSummary, SearchResult } from "./notesApi";

const UNTITLED = "Sem título";
const SEARCH_DEBOUNCE_MS = 120;

/** the shortcut opening the quick search: Cmd+O on macOS, Ctrl+O elsewhere */
export const QUICK_SEARCH_SHORTCUT = isDarwin ? "⌘O" : "Ctrl+O";

export const isQuickSearchShortcut = (event: KeyboardEvent) =>
  event.key.toLowerCase() === "o" &&
  (isDarwin ? event.metaKey : event.ctrlKey) &&
  !event.shiftKey &&
  !event.altKey;

/**
 * Spotlight-like search across every note, by title and by the text written
 * in the drawings: mouse or arrow keys to pick a note, Enter to open it.
 */
export const QuickSearch = ({
  theme,
  onOpenNote,
  onClose,
}: {
  theme: "light" | "dark";
  onOpenNote: (note: NoteSummary) => void;
  onClose: () => void;
}) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [folderNames, setFolderNames] = useState<Map<string, string>>(
    () => new Map(),
  );
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    foldersApi
      .list()
      .then((folders) =>
        setFolderNames(
          new Map(folders.map((folder) => [folder.id, folder.name])),
        ),
      )
      .catch(() => {});
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      notesApi
        .search(query, { signal: controller.signal })
        .then((results) => {
          setResults(results);
          setActiveIndex(0);
        })
        .catch((error) => {
          if (error.name !== "AbortError") {
            console.error("Failed to search notes", error);
            setResults([]);
          }
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  // keeps the note picked with the keyboard in view
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const open = (note: NoteSummary | undefined) => {
    if (note) {
      onClose();
      onOpenNote(note);
    }
  };

  const describe = useMemo(
    () => (result: SearchResult) =>
      result.matchedIn === "content" && result.snippet
        ? result.snippet
        : result.folderId
        ? folderNames.get(result.folderId) ?? ""
        : "Minhas notas",
    [folderNames],
  );

  return (
    <div
      className={clsx("quick-search", {
        "quick-search--dark": theme === "dark",
      })}
      onPointerDown={(event) => {
        // a click outside the panel closes it
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="quick-search__panel"
        role="dialog"
        aria-modal="true"
        aria-label="Buscar notas"
      >
        <label className="quick-search__input">
          {searchIcon}
          <input
            autoFocus
            value={query}
            placeholder="Buscar notas por título ou conteúdo"
            aria-label="Buscar notas por título ou conteúdo"
            role="combobox"
            aria-expanded={!!results?.length}
            aria-controls="quick-search-results"
            aria-activedescendant={
              results?.length ? `quick-search-result-${activeIndex}` : undefined
            }
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              const count = results?.length ?? 0;
              if (event.key === "ArrowDown" && count) {
                setActiveIndex((index) => (index + 1) % count);
              } else if (event.key === "ArrowUp" && count) {
                setActiveIndex((index) => (index - 1 + count) % count);
              } else if (event.key === "Enter") {
                open(results?.[activeIndex]);
              } else if (event.key === "Escape") {
                onClose();
              } else {
                return;
              }
              event.preventDefault();
              // not for the editor's own shortcuts
              event.stopPropagation();
            }}
          />
          <kbd className="quick-search__kbd">esc</kbd>
        </label>

        {results && !results.length ? (
          <p className="quick-search__empty">
            {query.trim()
              ? `Nenhuma nota encontrada para "${query.trim()}".`
              : "Nenhuma nota ainda."}
          </p>
        ) : (
          <ul
            ref={listRef}
            id="quick-search-results"
            className="quick-search__results"
            role="listbox"
            aria-label={query.trim() ? "Resultados" : "Notas recentes"}
          >
            {!query.trim() && !!results?.length && (
              <li className="quick-search__section" role="presentation">
                Recentes
              </li>
            )}
            {results?.map((result, index) => (
              <li
                key={result.id}
                id={`quick-search-result-${index}`}
                data-index={index}
                role="option"
                aria-selected={index === activeIndex}
                className={clsx("quick-search__result", {
                  "quick-search__result--active": index === activeIndex,
                })}
                onPointerMove={() => setActiveIndex(index)}
                onClick={() => open(result)}
              >
                <span className="quick-search__thumbnail">
                  {result.hasThumbnail && (
                    <img
                      src={notesApi.thumbnailURL(result)}
                      alt=""
                      loading="lazy"
                      draggable={false}
                    />
                  )}
                </span>
                <span className="quick-search__text">
                  <span
                    className={clsx("quick-search__title", {
                      "quick-search__title--untitled": !result.title,
                    })}
                  >
                    {result.title || UNTITLED}
                  </span>
                  <span className="quick-search__detail">
                    {result.matchedIn !== "content" && folderIcon}
                    {describe(result)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="quick-search__footer" aria-hidden="true">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> navegar
          </span>
          <span>
            <kbd>Enter</kbd> abrir
          </span>
          <span>
            <kbd>{QUICK_SEARCH_SHORTCUT}</kbd> buscar de qualquer lugar
          </span>
        </div>
      </div>
    </div>
  );
};
