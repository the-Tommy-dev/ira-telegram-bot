export function parseStartParameter(raw?: string) {
  if (!raw) return { source: "direct", campaign: null as string | null, productId: null as string | null };
  if (raw.startsWith("src_")) return { source: raw.slice(4) || "direct", campaign: null, productId: null };
  if (raw.startsWith("campaign_")) return { source: "campaign", campaign: raw.slice(9) || null, productId: null };
  if (raw.startsWith("product_")) return { source: "product", campaign: null, productId: raw.slice(8) || null };
  return { source: "other", campaign: null, productId: null };
}

export function splitCommand(text?: string) {
  if (!text?.startsWith("/")) return { command: null, parameter: undefined };
  const [rawCommand, parameter] = text.trim().split(/\s+/, 2);
  return { command: rawCommand.split("@")[0].toLowerCase(), parameter };
}

export function html(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
