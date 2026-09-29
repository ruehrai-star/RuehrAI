import { Body, Controller, Get, HttpCode, Post } from "@nestjs/common";
import { AuthUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { CreateRecommendationsDto } from "./dto";
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
  latest(@CurrentUser() user: AuthUser) {
    return this.recommendations.latest(user.id);
  }
}
