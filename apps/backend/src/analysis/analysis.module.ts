import { Module, forwardRef } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { GeoModule } from "../geo/geo.module";
import { RecommendationsModule } from "../recommendations/recommendations.module";
import { AnalysisController } from "./analysis.controller";
import { AnalysisService } from "./analysis.service";
import { BrainSearchService } from "./brain-search.service";
import { OmlxClient } from "./omlx.client";
import { PatternService } from "./pattern.service";
import { AreaBaselineService } from "./area-baseline.service";
import { StoreSurroundingsService } from "./store-surroundings.service";
import { YearlySeriesService } from "./yearly-series.service";

@Module({
  imports: [DatabaseModule, GeoModule, forwardRef(() => RecommendationsModule)],
  controllers: [AnalysisController],
  providers: [
    OmlxClient,
    BrainSearchService,
    StoreSurroundingsService,
    PatternService,
    AreaBaselineService,
    YearlySeriesService,
    AnalysisService,
  ],
  exports: [OmlxClient, YearlySeriesService, StoreSurroundingsService],
})
export class AnalysisModule {}
