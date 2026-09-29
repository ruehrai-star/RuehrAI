import { DataScoutService } from "../database/data-scout.service";
import { AddressGeocoderService } from "./address-geocoder.service";

describe("AddressGeocoderService", () => {
  it("skips Data-Scout when the pool is disabled", async () => {
    const query = jest.fn();
    const scout = { enabled: false, query } as unknown as DataScoutService;
    const geocoder = new AddressGeocoderService(scout);
    await expect(geocoder.lookupAddress("Hauptstraße 1", "12247")).resolves.toBeNull();
    await expect(geocoder.lookupPlzCentroid("12247")).resolves.toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it("returns null when the Data-Scout query fails", async () => {
    const query = jest.fn().mockResolvedValue(null);
    const scout = { enabled: true, query } as unknown as DataScoutService;
    const geocoder = new AddressGeocoderService(scout);
    await expect(geocoder.lookupAddress("Hauptstraße 1", "12247")).resolves.toBeNull();
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("public.geo_ref_address"),
      expect.any(Array),
    );
  });
});
