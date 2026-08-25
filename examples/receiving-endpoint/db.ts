/**
 * Stand-in for your database. Swap this for whatever you already use — the
 * shape that matters is: a report row remembers the storage *key*, never a
 * URL, so the GET route below can look it up server-side instead of trusting
 * whatever a client sends.
 */

export type ReportRow = {
  id: string;
  userId: string;
  type: string;
  message: string;
  url: string;
  screenshotKey: string | null;
};

const rows = new Map<string, ReportRow>();

export const db = {
  reports: {
    async insert(row: Omit<ReportRow, "id">): Promise<ReportRow> {
      const id = crypto.randomUUID();
      const saved = { ...row, id };
      rows.set(id, saved);
      return saved;
    },
    async findById(id: string): Promise<ReportRow | null> {
      return rows.get(id) ?? null;
    },
  },
};
