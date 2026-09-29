import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { PlaceCatalogService } from "./place-catalog.service";

@Module({
  imports: [DatabaseModule],
  providers: [PlaceCatalogService],
  exports: [PlaceCatalogService],
})
export class GeoModule {}
