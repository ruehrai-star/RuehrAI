import {
  buildRegionSql,
  buildStoreSql,
  chooseRelation,
  flagsFromColumns,
} from "./brain-search.sql";

const viewColumns = new Set([
  "id",
  "geo_key",
  "grain",
  "ref_period",
  "name",
  "title",
  "lon",
  "lat",
]);

describe("brain search SQL", () => {
  it("prefers the document table and otherwise uses the search view", () => {
    const table = new Set([...viewColumns, "content", "metadata", "embedding"]);
    expect(chooseRelation(table, viewColumns)?.relation).toBe("location_feature_docs");
    expect(chooseRelation(null, viewColumns)?.relation).toBe("v_location_search");
    expect(chooseRelation(new Set(["id"]), null)).toBeNull();
  });

  it("filters region grains without a vector operator", () => {
    const flags = flagsFromColumns(viewColumns);
    const sql = buildRegionSql("v_location_search", flags, false);
    expect(sql).toContain("features.v_location_search");
    expect(sql).toContain("grain IN ('ags', 'ags5')");
    expect(sql).toContain("grain IN ('plz5', 'plz8')");
    expect(sql).toContain("geo_key = $3");
    expect(sql).not.toContain("<=>");
    expect(sql).not.toContain("population");
    expect(sql).not.toContain("kaufkraft");
  });

  it("orders a vector query by cosine distance on the embedding column", () => {
    const flags = flagsFromColumns(new Set([...viewColumns, "embedding", "content", "metadata"]));
    const sql = buildRegionSql("location_feature_docs", flags, true);
    expect(sql).toContain("embedding <=> $5::vector");
    expect(sql).toContain("embedding IS NOT NULL");
    expect(sql).toContain("FROM features.location_feature_docs");
    const store = buildStoreSql("location_feature_docs", flags, true);
    expect(store).toContain("unnest($1::text[])");
    expect(store).toContain("embedding <=> $2::vector");
  });
});
