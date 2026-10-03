-- Remove the axis-aligned München rectangle from demo-gemeinden.
--
-- 001_init.sql seeded app.map_features id ags:09162000, layer demo-gemeinden,
-- properties stub true, label München, as a closed Polygon
-- [[11.36,48.06],[11.72,48.06],[11.72,48.25],[11.36,48.25],[11.36,48.06]].
-- GET /layers/demo-gemeinden draws that box even when München is not the
-- selected target region. There is no official outline to substitute.
--
-- app.schema_migrations stores the filename only (no checksum). An already
-- applied 001 is skipped, so editing that seed does not delete this row.
-- 001 no longer inserts it. This forward migration deletes it. A fresh
-- database never inserts the row, and this DELETE then matches nothing.
--
-- Berlin ags:11000000 and Hamburg ags:02000000 stay Points on demo-gemeinden.
-- app.search_places ags:09162000 stays (search hit, not a map outline).
-- Do not insert a replacement rectangle, bbox, or stub polygon.

DELETE FROM app.map_features
WHERE id = 'ags:09162000'
  AND layer_id = 'demo-gemeinden';

UPDATE app.map_layers
SET description = 'Synthetische Punkte für den Dev-Slice. Keine amtlichen Grenzen.'
WHERE id = 'demo-gemeinden'
  AND description = 'Synthetische Punkte und ein Kasten für den Dev-Slice. Keine amtlichen Grenzen.';
