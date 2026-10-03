-- Stop serving the demo-gemeinden search layer.
--
-- 001 inserts Berlin and Hamburg points. 009 inserts the München
-- MultiPolygon after 008 deletes that id. This migration runs after 009
-- and removes every feature on demo-gemeinden, including that polygon.
-- Nothing is inserted in their place.
--
-- The map_layers row stays, so GET /layers/demo-gemeinden is an empty
-- FeatureCollection. app.search_places and app.target_regions are unchanged.
-- Berlin and Hamburg points on this layer are deleted with it. Points on
-- other layers stay.

DELETE FROM app.map_features
WHERE layer_id = 'demo-gemeinden';

UPDATE app.map_layers
SET description = 'Leer. Keine Demo-Gemeinden.'
WHERE id = 'demo-gemeinden';
