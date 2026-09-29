import { Module } from "@nestjs/common";
import { DatabaseService } from "./database.service";
import { DataScoutService } from "./data-scout.service";

@Module({
  providers: [DatabaseService, DataScoutService],
  exports: [DatabaseService, DataScoutService],
})
export class DatabaseModule {}
