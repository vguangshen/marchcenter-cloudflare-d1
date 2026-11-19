-- An in-flight catalog refresh belongs to the software identifier it started with.
ALTER TABLE paas_v2_platforms ADD COLUMN catalog_generation INTEGER NOT NULL DEFAULT 0;
