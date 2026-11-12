import { isDarwin } from "@excalidraw/common";
import { searchIcon } from "@excalidraw/excalidraw/components/icons";
import clsx from "clsx";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";

import { getDailyNoteTitle, isTodayQuery, toISODate } from "./dailyNotes";
import { calendarIcon, folderIcon } from "./icons";
import { foldersApi, notesApi } from "./notesApi";

import "./QuickSearch.scss";

import type { NoteSummary, SearchResult } from "./notesApi";

const UNTITLED = "Sem título";
const SEARCH_DEBOUNCE_MS = 120;

/** a row of the list: today's note (found by "hoje" or "today", offered for
 * creation if missing) or a note found by the search */
type Item =
  | { type: "today"; date: Date; note: NoteSummary | null }
  | { type: "result"; result: SearchResult };

const getItemKey = (item: Item) =>
  item.type === "today" ? "today" : item.result.id;

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
  const [items, setItems] = useState<Item[] | null>(null);
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
      const date = new Date();
      Promise.all([
        notesApi.search(query, { signal: controller.signal }),
        isTodayQuery(query)
          ? notesApi
              .findDaily(toISODate(date), { signal: controller.signal })
              .then((note) => ({ date, note }))
          : null,
      ])
        .then(([results, today]) => {
          setItems([
            ...(today ? [{ type: "today" as const, ...today }] : []),
            ...results
              .filter((result) => result.id !== today?.note?.id)
              .map((result): Item => ({ type: "result", result })),
          ]);
          setActiveIndex(0);
        })
        .catch((error) => {
          if (error.name !== "AbortError") {
            console.error("Failed to search notes", error);
            setItems([]);
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

  const openNote = (note: NoteSummary) => {
    onClose();
    onOpenNote(note);
  };

  const [isCreatingDaily, setIsCreatingDaily] = useState(false);

  const open = (item: Item | undefined) => {
    if (item?.type === "result") {
      openNote(item.result);
    } else if (item?.note) {
      openNote(item.note);
    } else if (item && !isCreatingDaily) {
      // a daily note like the gallery's "Nota de hoje": in "Notas Diárias"
      setIsCreatingDaily(true);
      notesApi
        .daily(toISODate(item.date), getDailyNoteTitle(item.date))
        .then(openNote)
        .catch((error) => {
          console.error("Failed to create today's note", error);
          setIsCreatingDaily(false);
        });
    }
  };

  const hasToday = items?.[0]?.type === "today";

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
            aria-expanded={!!items?.length}
            aria-controls="quick-search-results"
            aria-activedescendant={
              items?.length ? `quick-search-result-${activeIndex}` : undefined
            }
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              const count = items?.length ?? 0;
              if (event.key === "ArrowDown" && count) {
                setActiveIndex((index) => (index + 1) % count);
              } else if (event.key === "ArrowUp" && count) {
                setActiveIndex((index) => (index - 1 + count) % count);
              } else if (event.key === "Enter") {
                open(items?.[activeIndex]);
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

        {items && !items.length ? (
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
            {hasToday && (
              <li className="quick-search__section" role="presentation">
                Nota diária
              </li>
            )}
            {items?.map((item, index) => (
              <Fragment key={getItemKey(item)}>
                {item.type === "result" &&
                  (!query.trim() || hasToday) &&
                  (index === 0 || items[index - 1].type === "today") && (
                    <li className="quick-search__section" role="presentation">
                      {query.trim() ? "Notas" : "Recentes"}
                    </li>
                  )}
                <li
                  id={`quick-search-result-${index}`}
                  data-index={index}
                  role="option"
                  aria-selected={index === activeIndex}
                  className={clsx("quick-search__result", {
                    "quick-search__result--active": index === activeIndex,
                  })}
                  onPointerMove={() => setActiveIndex(index)}
                  onClick={() => open(item)}
                >
                  {item.type === "today" ? (
                    <TodayRow
                      date={item.date}
                      note={item.note}
                      isCreating={isCreatingDaily}
                    />
                  ) : (
                    <ResultRow
                      result={item.result}
                      detail={describe(item.result)}
                    />
                  )}
                </li>
              </Fragment>
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

const Thumbnail = ({ note }: { note: NoteSummary | null }) => (
  <span className="quick-search__thumbnail">
    {note?.hasThumbnail ? (
      <img
        src={notesApi.thumbnailURL(note)}
        alt=""
        loading="lazy"
        draggable={false}
      />
    ) : (
      !note && calendarIcon
    )}
  </span>
);

const ResultRow = ({
  result,
  detail,
}: {
  result: SearchResult;
  detail: string;
}) => (
  <>
    <Thumbnail note={result} />
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
        {detail}
      </span>
    </span>
  </>
);

/** today's note, or the option to create it when missing */
const TodayRow = ({
  date,
  note,
  isCreating,
}: {
  date: Date;
  note: NoteSummary | null;
  isCreating: boolean;
}) => (
  <>
    <Thumbnail note={note} />
    <span className="quick-search__text">
      <span className="quick-search__title">
        {note
          ? note.title || UNTITLED
          : isCreating
          ? "Criando a nota de hoje…"
          : "Criar a nota de hoje"}
      </span>
      <span className="quick-search__detail">
        {calendarIcon}
        {note ? "Nota de hoje · Notas Diárias" : getDailyNoteTitle(date)}
      </span>
    </span>
    {!note && <span className="quick-search__badge">Nova</span>}
  </>
);
