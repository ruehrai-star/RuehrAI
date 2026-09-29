import { Injectable } from "@nestjs/common";
import { DataScoutService } from "../database/data-scout.service";
import { queryAddressPin, queryPlzCentroid } from "./address-lookup";
import { PinPoint } from "./pin-resolution";

/** Read-only Data-Scout geocoder. Disabled or failed reads return null. */
@Injectable()
export class AddressGeocoderService {
  constructor(private readonly scout: DataScoutService) {}

  lookupAddress(street: string, postalCode: string): Promise<PinPoint | null> {
    if (!this.scout.enabled) return Promise.resolve(null);
    return queryAddressPin(
      (text, params) => this.scout.query(text, params),
      street,
      postalCode.trim(),
    );
  }

  lookupPlzCentroid(postalCode: string): Promise<PinPoint | null> {
    if (!this.scout.enabled) return Promise.resolve(null);
    return queryPlzCentroid((text, params) => this.scout.query(text, params), postalCode.trim());
  }
}
