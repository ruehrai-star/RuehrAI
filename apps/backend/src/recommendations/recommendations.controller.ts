import { Body, Controller, Get, HttpCode, Post, Query } from "@nestjs/common";
import { AuthUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { CreateRecommendationsDto, RecommendationsQueryDto } from "./dto";
import { RecommendationsService } from "./recommendations.service";

@Controller("recommendations")
export class RecommendationsController {
  constructor(private readonly recommendations: RecommendationsService) {}

  @Post()
  @HttpCode(201)
  create(@CurrentUser() user: AuthUser, @Body() body?: CreateRecommendationsDto) {
    return this.recommendations.create(user.id, body?.runId);
  }

  @Get()
  latest(@CurrentUser() user: AuthUser, @Query() query: RecommendationsQueryDto) {
    return this.recommendations.latest(user.id, query.runId);
  }
}
