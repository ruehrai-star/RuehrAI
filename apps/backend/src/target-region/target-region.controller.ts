import { Body, Controller, Delete, Get, HttpCode, Put } from "@nestjs/common";
import { AuthUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { TargetRegionWriteDto } from "./dto";
import { TargetRegionService } from "./target-region.service";

@Controller("target-region")
export class TargetRegionController {
  constructor(private readonly regions: TargetRegionService) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.regions.get(user.id);
  }

  @Put()
  put(@CurrentUser() user: AuthUser, @Body() dto: TargetRegionWriteDto) {
    return this.regions.put(user.id, dto);
  }

  @Delete()
  @HttpCode(204)
  delete(@CurrentUser() user: AuthUser): Promise<void> {
    return this.regions.delete(user.id);
  }
}
