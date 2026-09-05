DROP TABLE IF EXISTS guestbook_entries;

ALTER TABLE user_pages
  DROP COLUMN IF EXISTS guestbook_enabled;

UPDATE user_pages
SET configuration = jsonb_set(
  configuration,
  '{elements}',
  COALESCE((
    SELECT jsonb_agg(element)
    FROM jsonb_array_elements(COALESCE(configuration->'elements', '[]'::jsonb)) AS element
    WHERE element->>'type' <> 'widget'
      OR element->'widgetData'->>'kind' IN ('characters', 'games', 'counter', 'clock')
  ), '[]'::jsonb),
  TRUE
);
