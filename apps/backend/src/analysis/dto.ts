import { Matches } from "class-validator";

export class AnalysisRunParamsDto {
  @Matches(/^[1-9][0-9]{0,18}$/)
  id!: string;
}
