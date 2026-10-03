import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { GeoModule } from "../geo/geo.module";
import { SearchController } from "./search.controller";
import { SearchService } from "./search.service";

@Module({
  imports: [DatabaseModule, GeoModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
