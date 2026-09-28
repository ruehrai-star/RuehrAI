import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { LayersController } from "./layers.controller";
import { LayersService } from "./layers.service";

@Module({
  imports: [DatabaseModule],
  controllers: [LayersController],
  providers: [LayersService],
})
export class LayersModule {}
