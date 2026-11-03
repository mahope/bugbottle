import { handleReport } from "bugbottle/server";

// Local demonstration only: isolate memory is neither durable nor shared.
export const reports = new Map();
const options = {
  authorize: (request) => request.headers.get("Origin") === "https://app.example",
  store: (report) => {
    const id = `report_${reports.size + 1}`;
    reports.set(id, report);
    return { id };
  },
};

export default {
  fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/report") return handleReport(request, options);
    if (path === "/signed-report") {
      return handleReport(request, {
        ...options,
        signature: { key: "public-demo-key" },
      });
    }
    return new Response("Not found", { status: 404 });
  },
};
