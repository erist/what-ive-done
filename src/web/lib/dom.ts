export function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function formatDateTime(value: string | undefined | null): string {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString();
}

export function formatDuration(seconds: number | string | undefined): string {
  const rounded = Math.round(Number(seconds) || 0);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainingSeconds = rounded % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${remainingSeconds}s`;
}

export function formatSignedNumber(value: number | string | undefined): string {
  const numeric = Number(value) || 0;
  return numeric > 0 ? `+${numeric}` : String(numeric);
}

export function formatSignedDuration(seconds: number | string | undefined): string {
  const numeric = Number(seconds) || 0;
  if (numeric === 0) {
    return "0s";
  }
  return `${numeric > 0 ? "+" : "-"}${formatDuration(Math.abs(numeric))}`;
}

export function toBooleanChoice(value: boolean | undefined): string {
  if (value === true) return "true";
  if (value === false) return "false";
  return "";
}

export function fromBooleanChoice(value: string): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}
