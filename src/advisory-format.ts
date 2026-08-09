import type { AdvisorMessageDetails, AdvisorNote, AdvisorSeverity } from "./types.ts";

const ADVISOR_GUIDANCE = "weigh, don't blindly obey";

export function normalizeAdvisoryText(value: string): string | undefined {
  const normalized = value
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "")
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return normalized || undefined;
}

export function isAdvisorSeverity(value: unknown): value is AdvisorSeverity {
  return value === "nit" || value === "concern" || value === "blocker";
}

export function isInterruptingSeverity(severity: AdvisorSeverity | undefined): boolean {
  return severity === "concern" || severity === "blocker";
}

export function formatAdvisorBatchContent(notes: readonly AdvisorNote[]): string {
  return notes
    .map((entry) => {
      const advisor = entry.advisor ? ` advisor="${escapeXml(entry.advisor)}"` : "";
      const severity = entry.severity ? ` severity="${entry.severity}"` : "";
      return `<advisory${advisor}${severity} guidance="${ADVISOR_GUIDANCE}">\n${escapeXml(entry.note)}\n</advisory>`;
    })
    .join("\n");
}

export function advisorMessageDetails(notes: readonly AdvisorNote[]): AdvisorMessageDetails {
  return { notes: [...notes] };
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
