import { Body, Controller, Get, HttpCode, Post } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { AuthUser } from "./auth.types";
import { CurrentUser } from "./current-user.decorator";
import { CredentialsDto } from "./dto";
import { Public } from "./public.decorator";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @HttpCode(200)
  @Post("login")
  login(@Body() dto: CredentialsDto) {
    return this.auth.login(dto);
  }

  @Public()
  @Post("register")
  register(@Body() dto: CredentialsDto) {
    return this.auth.register(dto);
  }

  @Get("me")
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }
}
