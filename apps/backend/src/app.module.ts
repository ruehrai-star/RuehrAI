import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "./auth/auth.module";
import { DatabaseModule } from "./database/database.module";
import { HealthModule } from "./health/health.module";
import { LayersModule } from "./layers/layers.module";
import { SearchModule } from "./search/search.module";
import { StoresModule } from "./stores/stores.module";
import { TargetRegionModule } from "./target-region/target-region.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    AuthModule,
    HealthModule,
    SearchModule,
    LayersModule,
    TargetRegionModule,
    StoresModule,
  ],
})
export class AppModule {}
