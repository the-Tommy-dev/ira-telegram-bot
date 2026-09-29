import { describe, expect, it } from "vitest";
import { localMinutes, withinSendWindow } from "@/lib/time";

describe("send window", () => {
  it("uses Europe/Helsinki local time", () => {
    const winterNoonUtc = new Date("2026-01-15T10:00:00Z");
    expect(localMinutes(winterNoonUtc, "Europe/Helsinki")).toBe(12 * 60);
  });

  it("allows configured daytime hours", () => {
    expect(withinSendWindow(new Date("2026-01-15T10:00:00Z"), "Europe/Helsinki", "09:00", "20:00")).toBe(true);
    expect(withinSendWindow(new Date("2026-01-15T20:00:00Z"), "Europe/Helsinki", "09:00", "20:00")).toBe(false);
  });
});
