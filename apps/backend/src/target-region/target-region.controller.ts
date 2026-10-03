import { Body, Controller, Delete, Get, HttpCode, Param, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { AuthUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { TargetRegionGeoKeyDto, TargetRegionWriteDto } from "./dto";
import { TargetRegionService } from "./target-region.service";

@Controller("target-region")
export class TargetRegionController {
  constructor(private readonly regions: TargetRegionService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.regions.list(user.id);
  }

  @Post()
  async add(
    @CurrentUser() user: AuthUser,
    @Body() dto: TargetRegionWriteDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { item, created } = await this.regions.add(user.id, dto);
    res.status(created ? 201 : 200);
    return item;
  }

  @Delete()
  @HttpCode(204)
  clear(@CurrentUser() user: AuthUser): Promise<void> {
    return this.regions.clear(user.id);
  }

  @Delete(":geoKey")
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param() params: TargetRegionGeoKeyDto): Promise<void> {
    return this.regions.remove(user.id, params.geoKey);
  }
}
