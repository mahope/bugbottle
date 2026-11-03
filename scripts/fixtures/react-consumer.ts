import { createElement, type ReactElement } from "react";
import { useBugReport, type UseBugReportOptions } from "bugbottle/react";
import { enMessages } from "bugbottle/locales";

const options: UseBugReportOptions = {
  endpoint: "/local-delivery",
  messages: enMessages,
  onSent(id) { const result: string | undefined = id; void result; },
};
export function ReportForm(): ReactElement {
  const report = useBugReport(options);
  const sending: boolean = report.isSending;
  return createElement("button", { disabled: sending, onClick: () => void report.submit() }, report.statusMessage);
}
