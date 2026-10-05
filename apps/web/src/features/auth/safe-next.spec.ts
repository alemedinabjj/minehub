import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it.each(["https://evil.com", "//evil.com", "/\\evil.com", "javascript:alert(1)", "", null])("rejects %j", (v) => {
    expect(safeNext(v)).toBe("/servers");
  });
  it("keeps relative paths and queries", () => {
    expect(safeNext("/servers/abc?created=1")).toBe("/servers/abc?created=1");
  });
});
