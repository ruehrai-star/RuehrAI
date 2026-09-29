import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
} from "@nestjs/common";
import { AuthUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import {
  MonthlyRevenueWriteDto,
  RevenueMonthParamsDto,
  StoreLocationWriteDto,
  StoreParamsDto,
} from "./dto";
import { StoresService } from "./stores.service";

@Controller("stores")
export class StoresController {
  constructor(private readonly stores: StoresService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.stores.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: StoreLocationWriteDto) {
    return this.stores.create(user.id, dto);
  }

  @Get(":id/revenue")
  listRevenue(@CurrentUser() user: AuthUser, @Param() params: StoreParamsDto) {
    return this.stores.listRevenue(user.id, params.id);
  }

  @Put(":id/revenue")
  putRevenue(
    @CurrentUser() user: AuthUser,
    @Param() params: StoreParamsDto,
    @Body() dto: MonthlyRevenueWriteDto,
  ) {
    return this.stores.putRevenue(user.id, params.id, dto);
  }

  @Delete(":id/revenue/:year/:month")
  @HttpCode(204)
  deleteRevenueMonth(
    @CurrentUser() user: AuthUser,
    @Param() params: RevenueMonthParamsDto,
  ): Promise<void> {
    return this.stores.deleteRevenueMonth(user.id, params.id, params.year, params.month);
  }

  @Get(":id")
  get(@CurrentUser() user: AuthUser, @Param() params: StoreParamsDto) {
    return this.stores.get(user.id, params.id);
  }

  @Put(":id")
  update(
    @CurrentUser() user: AuthUser,
    @Param() params: StoreParamsDto,
    @Body() dto: StoreLocationWriteDto,
  ) {
    return this.stores.update(user.id, params.id, dto);
  }

  @Delete(":id")
  @HttpCode(204)
  delete(@CurrentUser() user: AuthUser, @Param() params: StoreParamsDto): Promise<void> {
    return this.stores.delete(user.id, params.id);
  }
}
