CREATE TABLE `agent_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`turn_id` text,
	`parent_message_id` text,
	`role` text NOT NULL,
	`status` text NOT NULL,
	`semantics_json` text,
	`provider_json` text,
	`usage_json` text,
	`error_json` text,
	`finish_json` text,
	`created_at` text NOT NULL,
	`completed_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_message_id`) REFERENCES `agent_messages`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "agent_messages_role_check" CHECK("agent_messages"."role" IN ('user', 'assistant', 'system', 'tool')),
	CONSTRAINT "agent_messages_status_check" CHECK("agent_messages"."status" IN ('pending', 'streaming', 'completed', 'cancelled', 'failed', 'interrupted'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_agent_messages_session_sequence` ON `agent_messages` (`session_id`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_agent_messages_session_id` ON `agent_messages` (`session_id`,`id`);--> statement-breakpoint
CREATE INDEX `idx_agent_messages_session_status` ON `agent_messages` (`session_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_agent_messages_turn_id` ON `agent_messages` (`turn_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_messages_parent_message_id` ON `agent_messages` (`parent_message_id`);--> statement-breakpoint
CREATE TABLE `agent_message_parts` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`message_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`type` text NOT NULL,
	`data_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`,`message_id`) REFERENCES `agent_messages`(`session_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_agent_message_parts_message_sequence` ON `agent_message_parts` (`message_id`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_agent_message_parts_message_id` ON `agent_message_parts` (`message_id`,`id`);--> statement-breakpoint
CREATE INDEX `idx_agent_message_parts_session_message` ON `agent_message_parts` (`session_id`,`message_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_message_parts_type` ON `agent_message_parts` (`type`);
--> statement-breakpoint
CREATE TABLE `pi_sessions` (
	`topic_id` text PRIMARY KEY NOT NULL,
	`pi_session_id` text NOT NULL,
	`created_at` text NOT NULL,
	`active_leaf_id` text,
	`metadata_json` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`topic_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_pi_sessions_pi_session_id` ON `pi_sessions` (`pi_session_id`);
--> statement-breakpoint
CREATE TABLE `pi_session_entries` (
	`topic_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`entry_id` text NOT NULL,
	`parent_entry_id` text,
	`entry_type` text NOT NULL,
	`entry_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`topic_id`) REFERENCES `pi_sessions`(`topic_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_pi_session_entries_topic_sequence` ON `pi_session_entries` (`topic_id`,`sequence`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_pi_session_entries_topic_entry` ON `pi_session_entries` (`topic_id`,`entry_id`);
--> statement-breakpoint
CREATE INDEX `idx_pi_session_entries_topic_type` ON `pi_session_entries` (`topic_id`,`entry_type`);
--> statement-breakpoint
CREATE INDEX `idx_pi_session_entries_topic_parent` ON `pi_session_entries` (`topic_id`,`parent_entry_id`);
--> statement-breakpoint
CREATE TABLE `pi_invocation_entries` (
	`topic_id` text NOT NULL,
	`invocation_id` text NOT NULL,
	`entry_kind` text NOT NULL,
	`entry_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`topic_id`) REFERENCES `pi_sessions`(`topic_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_pi_invocation_entries_topic_kind` ON `pi_invocation_entries` (`topic_id`,`invocation_id`,`entry_kind`);
--> statement-breakpoint
CREATE INDEX `idx_pi_invocation_entries_topic_entry` ON `pi_invocation_entries` (`topic_id`,`entry_id`);
