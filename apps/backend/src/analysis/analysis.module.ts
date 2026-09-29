import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AnalysisController } from "./analysis.controller";
import { AnalysisService } from "./analysis.service";
import { BrainSearchService } from "./brain-search.service";
import { OmlxClient } from "./omlx.client";
import { PatternService } from "./pattern.service";

@Module({
  imports: [DatabaseModule],
  controllers: [AnalysisController],
  providers: [OmlxClient, BrainSearchService, PatternService, AnalysisService],
})
export class AnalysisModule {}
