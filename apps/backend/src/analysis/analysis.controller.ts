import { Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { AuthUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { AnalysisService } from "./analysis.service";
import { AnalysisPatternQueryDto, AnalysisRunParamsDto } from "./dto";

@Controller("analysis")
export class AnalysisController {
  constructor(private readonly analysis: AnalysisService) {}

  @Get("input")
  input(@CurrentUser() user: AuthUser) {
    return this.analysis.getInput(user.id);
  }

  @Post("runs")
  @HttpCode(202)
  createRun(@CurrentUser() user: AuthUser) {
    return this.analysis.createRun(user.id);
  }

  @Get("pattern")
  pattern(@CurrentUser() user: AuthUser, @Query() query: AnalysisPatternQueryDto) {
    return this.analysis.latestPattern(user.id, query.geoKey);
  }

  @Get("runs/:id")
  getRun(@CurrentUser() user: AuthUser, @Param() params: AnalysisRunParamsDto) {
    return this.analysis.getRun(user.id, params.id);
  }
}
