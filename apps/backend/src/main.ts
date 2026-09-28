import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { configureApp } from "./configure-app";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  app.enableShutdownHooks();

  const config = app.get(ConfigService);
  const parsed = Number(config.get<string>("PORT") ?? 3000);
  const port = Number.isFinite(parsed) && parsed > 0 ? parsed : 3000;
  await app.listen(port);
  Logger.log(`Listening on http://localhost:${port}`, "Bootstrap");
}

void bootstrap();
