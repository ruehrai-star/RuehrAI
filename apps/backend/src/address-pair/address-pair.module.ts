import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AddressPairController } from "./address-pair.controller";
import { AddressPairService } from "./address-pair.service";

@Module({
  imports: [DatabaseModule],
  controllers: [AddressPairController],
  providers: [AddressPairService],
})
export class AddressPairModule {}
