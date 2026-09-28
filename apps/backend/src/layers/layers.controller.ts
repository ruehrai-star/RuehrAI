import { Controller, Get, Param } from "@nestjs/common";
import { LayerParamsDto } from "./layers.dto";
import { LayersService } from "./layers.service";

@Controller("layers")
export class LayersController {
  constructor(private readonly layers: LayersService) {}

  @Get(":id")
  getLayer(@Param() params: LayerParamsDto) {
    return this.layers.getFeatureCollection(params.id);
  }
}
