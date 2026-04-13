-- ============================================================================
-- FCONF-08: 6 JSONB enrichment columns on master_wine_library
-- ============================================================================
-- These structured JSONB columns hold nested enrichment data from Haiku.
-- critic_scores is a stub here — populated by Phase 10.

ALTER TABLE master_wine_library
ADD COLUMN IF NOT EXISTS grape_family          JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS wine_structure        JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS sensory_profile       JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS practical_attributes  JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS region_hierarchy      JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS critic_scores         JSONB DEFAULT '{}';

COMMENT ON COLUMN master_wine_library.grape_family IS
'{"primary": "Nebbiolo", "blend": false, "percentages": null, "family": "Italian Reds"}';

COMMENT ON COLUMN master_wine_library.wine_structure IS
'{"body": "full", "tannin": "high", "acidity": "medium", "finish": "long"}';

COMMENT ON COLUMN master_wine_library.sensory_profile IS
'{"aromas": ["tar", "roses"], "palate": ["dark fruit", "leather"], "color_descriptor": "garnet"}';

COMMENT ON COLUMN master_wine_library.practical_attributes IS
'{"serving_temp_c": 18, "decant_minutes": 60, "aging_potential_years": "10-20", "glass_type": "Burgundy"}';

COMMENT ON COLUMN master_wine_library.region_hierarchy IS
'{"country": "Italy", "region": "Piedmont", "sub_region": "Langhe", "appellation": "Barolo DOCG", "classification": "DOCG", "commune": "Serralunga d Alba"}';

COMMENT ON COLUMN master_wine_library.critic_scores IS
'Stub — populated by Phase 10. Schema: {"wine_advocate": {"score": 93, ...}, "vivino": {...}, "composite": 91.5}';
