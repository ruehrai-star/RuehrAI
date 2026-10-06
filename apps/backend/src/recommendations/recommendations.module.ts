import { Module, forwardRef } from "@nestjs/common";
import { AnalysisModule } from "../analysis/analysis.module";
import { DatabaseModule } from "../database/database.module";
import { AreaCandidateService } from "./area-candidate.service";
import { RationaleService } from "./rationale.service";
import { RecommendationsController } from "./recommendations.controller";
import { RecommendationsService } from "./recommendations.service";

@Module({
  imports: [DatabaseModule, forwardRef(() => AnalysisModule)],
  controllers: [RecommendationsController],
  providers: [AreaCandidateService, RationaleService, RecommendationsService],
  exports: [RecommendationsService],
})
export class RecommendationsModule {}
