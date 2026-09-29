import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AnalysisModule } from "./analysis/analysis.module";
import { AuthModule } from "./auth/auth.module";
import { DatabaseModule } from "./database/database.module";
import { HealthModule } from "./health/health.module";
import { LayersModule } from "./layers/layers.module";
import { RecommendationsModule } from "./recommendations/recommendations.module";
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
    AnalysisModule,
    RecommendationsModule,
  ],
})
export class AppModule {}
