import { Test } from "@nestjs/testing";
import { DatabaseService } from "../database/database.service";
import { SearchService } from "./search.service";

describe("SearchService", () => {
  const query = jest.fn();
  let service: SearchService;

  beforeEach(async () => {
    query.mockReset();
    query.mockResolvedValue({
      rows: [
        {
          id: "ags:09162000",
          label: "München",
          grain: "ags",
          lon: "11.5755",
          lat: 48.1374,
        },
      ],
    });
    const moduleRef = await Test.createTestingModule({
      providers: [SearchService, { provide: DatabaseService, useValue: { query } }],
    }).compile();
    service = moduleRef.get(SearchService);
  });

  it("binds filters as parameters and coerces coordinates", async () => {
    const result = await service.search({
      q: "München%",
      type: "ags",
      ags: "09162000",
    });

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("ESCAPE '\\'");
    expect(sql).not.toContain("München");
    expect(sql).not.toContain("09162000");
    expect(params).toEqual(["09162000", null, null, "%München\\%%", "ags"]);
    expect(result.hits).toEqual([
      {
        id: "ags:09162000",
        label: "München",
        grain: "ags",
        lon: 11.5755,
        lat: 48.1374,
      },
    ]);
  });
});
