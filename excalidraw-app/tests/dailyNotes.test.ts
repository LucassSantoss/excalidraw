import { isTodayQuery } from "../notes/dailyNotes";

describe("isTodayQuery", () => {
  it("finds today's note by 'hoje' or 'today', ignoring case and accents", () => {
    for (const query of ["hoje", "HOJE", " Hojé ", "hoj", "today", "Tod"]) {
      expect(isTodayQuery(query)).toBe(true);
    }
  });

  it("not for other searches", () => {
    for (const query of [
      "",
      "ho",
      "to",
      "Reunião semanal",
      "hojes",
      "plano de hoje",
      "today notes",
      "novembro",
    ]) {
      expect(isTodayQuery(query)).toBe(false);
    }
  });
});
