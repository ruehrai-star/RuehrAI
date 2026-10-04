import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { AuthUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { AddressPairService } from "./address-pair.service";
import { AddressPairRequestDto } from "./dto";

@Controller("address-pair")
export class AddressPairController {
  constructor(private readonly addressPair: AddressPairService) {}

  @Post()
  @HttpCode(200)
  evaluate(@CurrentUser() _user: AuthUser, @Body() dto: AddressPairRequestDto) {
    return this.addressPair.evaluate(dto);
  }
}
