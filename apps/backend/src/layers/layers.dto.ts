import { Matches } from "class-validator";

export class LayerParamsDto {
  @Matches(/^[a-z0-9][a-z0-9-]{0,63}$/)
  id!: string;
}
