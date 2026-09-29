import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { TargetRegionController } from "./target-region.controller";
import { TargetRegionService } from "./target-region.service";

@Module({
  imports: [DatabaseModule],
  controllers: [TargetRegionController],
  providers: [TargetRegionService],
})
export class TargetRegionModule {}
