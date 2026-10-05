import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { GeoModule } from "../geo/geo.module";
import { AnalysisController } from "./analysis.controller";
import { AnalysisService } from "./analysis.service";
import { BrainSearchService } from "./brain-search.service";
import { OmlxClient } from "./omlx.client";
import { PatternService } from "./pattern.service";
import { YearlySeriesService } from "./yearly-series.service";

@Module({
  imports: [DatabaseModule, GeoModule],
  controllers: [AnalysisController],
  providers: [OmlxClient, BrainSearchService, PatternService, YearlySeriesService, AnalysisService],
  exports: [OmlxClient],
})
export class AnalysisModule {}
