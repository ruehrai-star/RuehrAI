import { Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";

interface LayerRow {
  id: string;
  name: string;
  description: string | null;
}

interface FeatureRow {
  id: string;
  properties: Record<string, unknown>;
  geometry: Record<string, unknown>;
}

@Injectable()
export class LayersService {
  constructor(private readonly db: DatabaseService) {}

  async getFeatureCollection(id: string) {
    const layers = await this.db.query<LayerRow>(
      `SELECT id, name, description
       FROM app.map_layers
       WHERE id = $1`,
      [id],
    );
    const layer = layers.rows[0];
    if (!layer) {
      throw new NotFoundException("Layer not found");
    }

    const features = await this.db.query<FeatureRow>(
      `SELECT id, properties, geometry
       FROM app.map_features
       WHERE layer_id = $1
       ORDER BY id ASC`,
      [id],
    );

    return {
      type: "FeatureCollection" as const,
      name: layer.name,
      ...(layer.description ? { description: layer.description } : {}),
      features: features.rows.map((row) => ({
        type: "Feature" as const,
        id: row.id,
        geometry: row.geometry,
        properties: row.properties ?? {},
      })),
    };
  }
}
