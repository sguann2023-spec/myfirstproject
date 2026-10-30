-- Index the exact expressions exposed by the command views. Without these,
-- every id/sequence validation decodes the payload of every historical event.
CREATE INDEX idx_event_projection_id ON agent_message_events(entity_type,json_extract(payload,'$.id'),position);
--> statement-breakpoint
CREATE INDEX idx_event_projection_session_sequence ON agent_message_events(entity_type,json_extract(payload,'$.session_id'),json_extract(payload,'$.sequence'),position);
--> statement-breakpoint
CREATE INDEX idx_event_projection_message_sequence ON agent_message_events(entity_type,json_extract(payload,'$.message_id'),json_extract(payload,'$.sequence'),position);
--> statement-breakpoint
CREATE INDEX idx_event_projection_parent ON agent_message_events(entity_type,json_extract(payload,'$.parent_message_id'),position);
--> statement-breakpoint
CREATE INDEX idx_event_projection_legacy_identity ON agent_message_events(entity_type,json_extract(payload,'$.session_id'),json_extract(payload,'$.role'),json_extract(json_extract(payload,'$.content'),'$.message.id'),position) WHERE entity_type='session_messages';
--> statement-breakpoint
CREATE INDEX idx_event_legacy_numeric_id ON agent_message_events(entity_type,CAST(entity_id AS INTEGER));
--> statement-breakpoint
-- Build checkpoints from the previous checkpoint plus its bounded event tail,
-- not by rescanning every version ever written to this session.
DROP TRIGGER automatic_message_snapshot;
--> statement-breakpoint
CREATE TRIGGER automatic_message_snapshot AFTER INSERT ON agent_message_events
WHEN (SELECT count(*) FROM (SELECT 1 FROM agent_message_events WHERE session_id=NEW.session_id AND position>coalesce((SELECT max(event_position) FROM agent_message_snapshots WHERE session_id=NEW.session_id),0) LIMIT 128)) >= 128
BEGIN
 INSERT INTO agent_message_snapshots(session_id,event_position,payload)
 WITH checkpoint AS (
   SELECT event_position,payload FROM agent_message_snapshots WHERE session_id=NEW.session_id ORDER BY event_position DESC,id DESC LIMIT 1
 ), tail AS MATERIALIZED (
   SELECT * FROM agent_message_events WHERE session_id=NEW.session_id AND position>coalesce((SELECT event_position FROM checkpoint),0)
 ), records AS (
   SELECT json_extract(j.value,'$[0]') AS key,json_extract(j.value,'$[1]') AS payload
   FROM checkpoint,json_each(checkpoint.payload) j
   WHERE json_extract(j.value,'$[0]') NOT IN (SELECT entity_type || ':' || entity_id FROM tail)
   UNION ALL
   SELECT entity_type || ':' || entity_id,payload FROM tail e WHERE operation='put'
   AND NOT EXISTS (SELECT 1 FROM agent_message_events n WHERE n.entity_type=e.entity_type AND n.entity_id=e.entity_id AND n.position>e.position)
 )
 SELECT NEW.session_id,NEW.position,coalesce(json_group_array(json_array(key,json(payload))),'[]') FROM records;
END;
