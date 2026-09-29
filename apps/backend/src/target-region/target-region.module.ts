import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { GeoModule } from "../geo/geo.module";
import { TargetRegionController } from "./target-region.controller";
import { TargetRegionService } from "./target-region.service";

@Module({
  imports: [DatabaseModule, GeoModule],
  controllers: [TargetRegionController],
  providers: [TargetRegionService],
})
export class TargetRegionModule {}
