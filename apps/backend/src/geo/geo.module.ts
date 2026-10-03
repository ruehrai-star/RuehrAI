import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AddressGeocoderService } from "./address-geocoder.service";
import { GeoCatalogService } from "./geo-catalog.service";
import { PlaceCatalogService } from "./place-catalog.service";

@Module({
  imports: [DatabaseModule],
  providers: [PlaceCatalogService, AddressGeocoderService, GeoCatalogService],
  exports: [PlaceCatalogService, AddressGeocoderService, GeoCatalogService],
})
export class GeoModule {}
