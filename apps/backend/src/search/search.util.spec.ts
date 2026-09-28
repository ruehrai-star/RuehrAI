import { toContainsPattern } from "./search.util";

describe("toContainsPattern", () => {
  it("wraps a plain value", () => {
    expect(toContainsPattern("München")).toBe("%München%");
  });

  it("escapes LIKE wildcards", () => {
    expect(toContainsPattern("100%_a\\b")).toBe("%100\\%\\_a\\\\b%");
  });
});
