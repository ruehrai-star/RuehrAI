import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AddressGeocoderService } from "./address-geocoder.service";
import { PlaceCatalogService } from "./place-catalog.service";

@Module({
  imports: [DatabaseModule],
  providers: [PlaceCatalogService, AddressGeocoderService],
  exports: [PlaceCatalogService, AddressGeocoderService],
})
export class GeoModule {}
