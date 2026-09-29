import {
  houseNumberMatchKeys,
  parseGermanStreet,
  streetMatchKeys,
} from "./parse-german-address";

describe("parseGermanStreet", () => {
  it.each([
    ["Marienplatz 1", "Marienplatz", "1"],
    ["Hauptstraße 12a", "Hauptstraße", "12a"],
    ["Hauptstraße 12 a", "Hauptstraße", "12a"],
    ["Hauptstraße 12-14", "Hauptstraße", "12-14"],
    ["Musterweg 4/5", "Musterweg", "4/5"],
    ["Sendlinger Str. 2", "Sendlinger Str.", "2"],
    ["Hauptstr 9", "Hauptstr", "9"],
    ["Straße des 17. Juni 135", "Straße des 17. Juni", "135"],
    ["Hauptstraße Nr. 12", "Hauptstraße", "12"],
    ["Hauptstraße, 12 b", "Hauptstraße", "12b"],
    ["Schönhauser Allee 12a", "Schönhauser Allee", "12a"],
  ])("parses %s", (input, street, houseNumber) => {
    expect(parseGermanStreet(input)).toEqual({ street, houseNumber });
  });

  it("returns null when the street has no house number", () => {
    expect(parseGermanStreet("Unter den Linden")).toBeNull();
    expect(parseGermanStreet("17. Juni")).toBeNull();
    expect(parseGermanStreet("")).toBeNull();
  });

  it("builds street and house-number keys for an index lookup", () => {
    expect(streetMatchKeys("Sendlinger Str.")).toEqual(
      expect.arrayContaining(["sendlinger str.", "sendlinger straße", "sendlinger strasse"]),
    );
    expect(streetMatchKeys("Hauptstraße")).toEqual(
      expect.arrayContaining(["hauptstraße", "hauptstrasse"]),
    );
    expect(houseNumberMatchKeys("12 a")).toEqual(["12a"]);
    expect(houseNumberMatchKeys("4/5")).toEqual(["4/5", "4-5"]);
  });
});
