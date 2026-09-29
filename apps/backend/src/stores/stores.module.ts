import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { GeoModule } from "../geo/geo.module";
import { StoresController } from "./stores.controller";
import { StoresService } from "./stores.service";

@Module({
  imports: [DatabaseModule, GeoModule],
  controllers: [StoresController],
  providers: [StoresService],
})
export class StoresModule {}
