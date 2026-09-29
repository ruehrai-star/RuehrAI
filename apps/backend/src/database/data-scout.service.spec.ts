import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DataScoutService } from "./data-scout.service";

const query = jest.fn();
const end = jest.fn();
const on = jest.fn();

jest.mock("pg", () => ({
  Pool: jest.fn(() => ({ query, end, on })),
}));

import { Pool } from "pg";

describe("DataScoutService", () => {
  const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  const error = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);

  beforeEach(() => {
    query.mockReset();
    end.mockReset();
    on.mockReset();
    (Pool as unknown as jest.Mock).mockClear();
    warn.mockClear();
    error.mockClear();
  });

  it("stays disabled when DATASCOUT_DATABASE_URL is unset", async () => {
    const service = new DataScoutService(config(undefined));
    await expect(service.query("SELECT 1")).resolves.toBeNull();
    expect(service.enabled).toBe(false);
    expect(Pool).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("DATASCOUT_DATABASE_URL is unset"));
  });

  it("reads through the Data-Scout pool and refuses writes", async () => {
    const service = new DataScoutService(
      config("postgres://ruehrai:super-secret-password@localhost:5432/Data-Scout"),
    );
    query.mockResolvedValue({ rows: [{ lon: 13.3, lat: 52.4 }], rowCount: 1 });
    await expect(service.query("SELECT lon, lat FROM geo_ref_address WHERE plz = $1", ["12247"])).resolves.toEqual({
      rows: [{ lon: 13.3, lat: 52.4 }],
      rowCount: 1,
    });
    expect(Pool).toHaveBeenCalledWith(
      expect.objectContaining({
        application_name: "ruehrai-backend-datascout",
        options: "-c default_transaction_read_only=on",
      }),
    );
    await expect(service.query("UPDATE geo_ref_address SET lon = 1")).resolves.toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("not a single SELECT"));
    expect(JSON.stringify(warn.mock.calls)).not.toContain("super-secret-password");
    expect(JSON.stringify(error.mock.calls)).not.toContain("super-secret-password");
  });

  it("returns null when the read fails and does not log the URL", async () => {
    const service = new DataScoutService(
      config("postgres://ruehrai:super-secret-password@localhost:5432/Data-Scout"),
    );
    query.mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:5432"));
    await expect(service.query("SELECT 1")).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ECONNREFUSED"));
    expect(JSON.stringify(warn.mock.calls)).not.toContain("super-secret-password");
  });
});

function config(url: string | undefined): ConfigService {
  return {
    get: (key: string) => (key === "DATASCOUT_DATABASE_URL" ? url : undefined),
  } as unknown as ConfigService;
}
