import { describe, expect, it } from "vitest";
import { parseStartParameter, splitCommand } from "@/lib/tracking";

describe("parseStartParameter", () => {
  it("parses source links", () => {
    expect(parseStartParameter("src_ig")).toEqual({ source: "ig", campaign: null, productId: null });
  });

  it("parses campaign links", () => {
    expect(parseStartParameter("campaign_launch")).toEqual({ source: "campaign", campaign: "launch", productId: null });
  });

  it("parses product links", () => {
    expect(parseStartParameter("product_vkus_zhizni")).toEqual({ source: "product", campaign: null, productId: "vkus_zhizni" });
  });
});

describe("splitCommand", () => {
  it("handles bot-qualified start commands", () => {
    expect(splitCommand("/start@ira_bot product_marshrut")).toEqual({ command: "/start", parameter: "product_marshrut" });
  });

  it("ignores normal text", () => {
    expect(splitCommand("hello")).toEqual({ command: null, parameter: undefined });
  });
});
