const dailyTitleFormatter = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** local YYYY-MM-DD (identifies the daily note of that day) */
export const toISODate = (date: Date) =>
  [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");

/** e.g. "Sexta-feira, 23 de outubro de 2026" */
export const getDailyNoteTitle = (date: Date) => {
  const title = dailyTitleFormatter.format(date);
  return title.charAt(0).toUpperCase() + title.slice(1);
};

/** the words that find today's note in the quick search */
const TODAY_KEYWORDS = ["hoje", "today"];
/** shortest prefix of a keyword that counts ("hoj", "tod") */
const MIN_KEYWORD_PREFIX = 3;

const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();

/** whether a quick search query asks for today's note: "hoje", "today" or the
 * start of either, ignoring case and accents */
export const isTodayQuery = (query: string) => {
  const normalized = normalize(query);
  return (
    normalized.length >= MIN_KEYWORD_PREFIX &&
    TODAY_KEYWORDS.some((keyword) => keyword.startsWith(normalized))
  );
};
