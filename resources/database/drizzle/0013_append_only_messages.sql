CREATE TABLE IF NOT EXISTS agent_message_events (
 position INTEGER PRIMARY KEY AUTOINCREMENT,
 entity_type TEXT NOT NULL,
 entity_id TEXT NOT NULL,
 session_id TEXT NOT NULL,
 operation TEXT NOT NULL CHECK(operation IN ('put','delete')),
 payload TEXT NOT NULL,
 recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_agent_message_events_entity ON agent_message_events(entity_type,entity_id,position);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_agent_message_events_session ON agent_message_events(session_id, position);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS agent_message_events_immutable_update AFTER UPDATE ON agent_message_events BEGIN SELECT RAISE(ABORT, 'message events are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS agent_message_events_immutable_delete BEFORE DELETE ON agent_message_events BEGIN SELECT RAISE(ABORT, 'message events are immutable'); END;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS agent_message_snapshots (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 session_id TEXT NOT NULL,
 event_position INTEGER NOT NULL,
 payload TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
--> statement-breakpoint
INSERT INTO agent_message_events(entity_type,entity_id,session_id,operation,payload) SELECT 'agent_messages',CAST(id AS TEXT),session_id,'put',json_object('id',id,'session_id',session_id,'sequence',sequence,'turn_id',turn_id,'parent_message_id',parent_message_id,'role',role,'status',status,'semantics_json',semantics_json,'provider_json',provider_json,'usage_json',usage_json,'error_json',error_json,'finish_json',finish_json,'created_at',created_at,'completed_at',completed_at,'updated_at',updated_at) FROM agent_messages source WHERE NOT EXISTS (SELECT 1 FROM agent_message_events e WHERE e.entity_type='agent_messages' AND e.entity_id=CAST(source.id AS TEXT));
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS journal_agent_messages_insert AFTER INSERT ON agent_messages BEGIN INSERT INTO agent_message_events(entity_type,entity_id,session_id,operation,payload) VALUES ('agent_messages',CAST(NEW.id AS TEXT),NEW.session_id,'put',json_object('id',NEW.id,'session_id',NEW.session_id,'sequence',NEW.sequence,'turn_id',NEW.turn_id,'parent_message_id',NEW.parent_message_id,'role',NEW.role,'status',NEW.status,'semantics_json',NEW.semantics_json,'provider_json',NEW.provider_json,'usage_json',NEW.usage_json,'error_json',NEW.error_json,'finish_json',NEW.finish_json,'created_at',NEW.created_at,'completed_at',NEW.completed_at,'updated_at',NEW.updated_at)); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS journal_agent_messages_update AFTER UPDATE ON agent_messages BEGIN INSERT INTO agent_message_events(entity_type,entity_id,session_id,operation,payload) VALUES ('agent_messages',CAST(NEW.id AS TEXT),NEW.session_id,'put',json_object('id',NEW.id,'session_id',NEW.session_id,'sequence',NEW.sequence,'turn_id',NEW.turn_id,'parent_message_id',NEW.parent_message_id,'role',NEW.role,'status',NEW.status,'semantics_json',NEW.semantics_json,'provider_json',NEW.provider_json,'usage_json',NEW.usage_json,'error_json',NEW.error_json,'finish_json',NEW.finish_json,'created_at',NEW.created_at,'completed_at',NEW.completed_at,'updated_at',NEW.updated_at)); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS journal_agent_messages_delete BEFORE DELETE ON agent_messages BEGIN INSERT INTO agent_message_events(entity_type,entity_id,session_id,operation,payload) VALUES ('agent_messages',CAST(OLD.id AS TEXT),OLD.session_id,'delete',json_object('id',OLD.id,'session_id',OLD.session_id,'sequence',OLD.sequence,'turn_id',OLD.turn_id,'parent_message_id',OLD.parent_message_id,'role',OLD.role,'status',OLD.status,'semantics_json',OLD.semantics_json,'provider_json',OLD.provider_json,'usage_json',OLD.usage_json,'error_json',OLD.error_json,'finish_json',OLD.finish_json,'created_at',OLD.created_at,'completed_at',OLD.completed_at,'updated_at',OLD.updated_at)); END;
--> statement-breakpoint
CREATE VIEW IF NOT EXISTS replay_agent_messages AS SELECT json_extract(e.payload,'$.id') AS id,json_extract(e.payload,'$.session_id') AS session_id,json_extract(e.payload,'$.sequence') AS sequence,json_extract(e.payload,'$.turn_id') AS turn_id,json_extract(e.payload,'$.parent_message_id') AS parent_message_id,json_extract(e.payload,'$.role') AS role,json_extract(e.payload,'$.status') AS status,json_extract(e.payload,'$.semantics_json') AS semantics_json,json_extract(e.payload,'$.provider_json') AS provider_json,json_extract(e.payload,'$.usage_json') AS usage_json,json_extract(e.payload,'$.error_json') AS error_json,json_extract(e.payload,'$.finish_json') AS finish_json,json_extract(e.payload,'$.created_at') AS created_at,json_extract(e.payload,'$.completed_at') AS completed_at,json_extract(e.payload,'$.updated_at') AS updated_at FROM agent_message_events e WHERE e.entity_type='agent_messages' AND e.operation='put' AND NOT EXISTS (SELECT 1 FROM agent_message_events newer WHERE newer.entity_type=e.entity_type AND newer.entity_id=e.entity_id AND newer.position>e.position);
--> statement-breakpoint
INSERT INTO agent_message_events(entity_type,entity_id,session_id,operation,payload) SELECT 'agent_message_parts',CAST(id AS TEXT),session_id,'put',json_object('id',id,'session_id',session_id,'message_id',message_id,'sequence',sequence,'type',type,'data_json',data_json,'created_at',created_at,'updated_at',updated_at) FROM agent_message_parts source WHERE NOT EXISTS (SELECT 1 FROM agent_message_events e WHERE e.entity_type='agent_message_parts' AND e.entity_id=CAST(source.id AS TEXT));
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS journal_agent_message_parts_insert AFTER INSERT ON agent_message_parts BEGIN INSERT INTO agent_message_events(entity_type,entity_id,session_id,operation,payload) VALUES ('agent_message_parts',CAST(NEW.id AS TEXT),NEW.session_id,'put',json_object('id',NEW.id,'session_id',NEW.session_id,'message_id',NEW.message_id,'sequence',NEW.sequence,'type',NEW.type,'data_json',NEW.data_json,'created_at',NEW.created_at,'updated_at',NEW.updated_at)); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS journal_agent_message_parts_update AFTER UPDATE ON agent_message_parts BEGIN INSERT INTO agent_message_events(entity_type,entity_id,session_id,operation,payload) VALUES ('agent_message_parts',CAST(NEW.id AS TEXT),NEW.session_id,'put',json_object('id',NEW.id,'session_id',NEW.session_id,'message_id',NEW.message_id,'sequence',NEW.sequence,'type',NEW.type,'data_json',NEW.data_json,'created_at',NEW.created_at,'updated_at',NEW.updated_at)); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS journal_agent_message_parts_delete BEFORE DELETE ON agent_message_parts BEGIN INSERT INTO agent_message_events(entity_type,entity_id,session_id,operation,payload) VALUES ('agent_message_parts',CAST(OLD.id AS TEXT),OLD.session_id,'delete',json_object('id',OLD.id,'session_id',OLD.session_id,'message_id',OLD.message_id,'sequence',OLD.sequence,'type',OLD.type,'data_json',OLD.data_json,'created_at',OLD.created_at,'updated_at',OLD.updated_at)); END;
--> statement-breakpoint
CREATE VIEW IF NOT EXISTS replay_agent_message_parts AS SELECT json_extract(e.payload,'$.id') AS id,json_extract(e.payload,'$.session_id') AS session_id,json_extract(e.payload,'$.message_id') AS message_id,json_extract(e.payload,'$.sequence') AS sequence,json_extract(e.payload,'$.type') AS type,json_extract(e.payload,'$.data_json') AS data_json,json_extract(e.payload,'$.created_at') AS created_at,json_extract(e.payload,'$.updated_at') AS updated_at FROM agent_message_events e WHERE e.entity_type='agent_message_parts' AND e.operation='put' AND NOT EXISTS (SELECT 1 FROM agent_message_events newer WHERE newer.entity_type=e.entity_type AND newer.entity_id=e.entity_id AND newer.position>e.position);
--> statement-breakpoint
INSERT INTO agent_message_events(entity_type,entity_id,session_id,operation,payload) SELECT 'session_messages',CAST(id AS TEXT),session_id,'put',json_object('id',id,'session_id',session_id,'agent_session_id',agent_session_id,'role',role,'content',content,'metadata',metadata,'created_at',created_at,'updated_at',updated_at) FROM session_messages source WHERE NOT EXISTS (SELECT 1 FROM agent_message_events e WHERE e.entity_type='session_messages' AND e.entity_id=CAST(source.id AS TEXT));
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS journal_session_messages_insert AFTER INSERT ON session_messages BEGIN INSERT INTO agent_message_events(entity_type,entity_id,session_id,operation,payload) VALUES ('session_messages',CAST(NEW.id AS TEXT),NEW.session_id,'put',json_object('id',NEW.id,'session_id',NEW.session_id,'agent_session_id',NEW.agent_session_id,'role',NEW.role,'content',NEW.content,'metadata',NEW.metadata,'created_at',NEW.created_at,'updated_at',NEW.updated_at)); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS journal_session_messages_update AFTER UPDATE ON session_messages BEGIN INSERT INTO agent_message_events(entity_type,entity_id,session_id,operation,payload) VALUES ('session_messages',CAST(NEW.id AS TEXT),NEW.session_id,'put',json_object('id',NEW.id,'session_id',NEW.session_id,'agent_session_id',NEW.agent_session_id,'role',NEW.role,'content',NEW.content,'metadata',NEW.metadata,'created_at',NEW.created_at,'updated_at',NEW.updated_at)); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS journal_session_messages_delete BEFORE DELETE ON session_messages BEGIN INSERT INTO agent_message_events(entity_type,entity_id,session_id,operation,payload) VALUES ('session_messages',CAST(OLD.id AS TEXT),OLD.session_id,'delete',json_object('id',OLD.id,'session_id',OLD.session_id,'agent_session_id',OLD.agent_session_id,'role',OLD.role,'content',OLD.content,'metadata',OLD.metadata,'created_at',OLD.created_at,'updated_at',OLD.updated_at)); END;
--> statement-breakpoint
CREATE VIEW IF NOT EXISTS replay_session_messages AS SELECT json_extract(e.payload,'$.id') AS id,json_extract(e.payload,'$.session_id') AS session_id,json_extract(e.payload,'$.agent_session_id') AS agent_session_id,json_extract(e.payload,'$.role') AS role,json_extract(e.payload,'$.content') AS content,json_extract(e.payload,'$.metadata') AS metadata,json_extract(e.payload,'$.created_at') AS created_at,json_extract(e.payload,'$.updated_at') AS updated_at FROM agent_message_events e WHERE e.entity_type='session_messages' AND e.operation='put' AND NOT EXISTS (SELECT 1 FROM agent_message_events newer WHERE newer.entity_type=e.entity_type AND newer.entity_id=e.entity_id AND newer.position>e.position);
