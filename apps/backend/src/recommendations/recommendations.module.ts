import { Module } from "@nestjs/common";
import { AnalysisModule } from "../analysis/analysis.module";
import { DatabaseModule } from "../database/database.module";
import { CandidateSearchService } from "./candidate-search.service";
import { RationaleService } from "./rationale.service";
import { RecommendationsController } from "./recommendations.controller";
import { RecommendationsService } from "./recommendations.service";

@Module({
  imports: [DatabaseModule, AnalysisModule],
  controllers: [RecommendationsController],
  providers: [CandidateSearchService, RationaleService, RecommendationsService],
})
export class RecommendationsModule {}
