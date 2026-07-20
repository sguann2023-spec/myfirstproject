CREATE TABLE `agent_conversation_segments` (
	`id` text PRIMARY KEY NOT NULL,
	`topic_id` text NOT NULL,
	`sdk_session_id` text DEFAULT '' NOT NULL,
	`parent_segment_id` text,
	`fork_from_sdk_session_id` text,
	`system_prompt_version` text NOT NULL,
	`system_prompt_hash` text NOT NULL,
	`base_prompt_snapshot` text,
	`raw_summary` text,
	`continuation_summary` text,
	`compact_reason` text,
	`summary_version` text,
	`start_message_id` text,
	`end_message_id` text,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`topic_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_segment_id`) REFERENCES `agent_conversation_segments`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_agent_conversation_segments_topic_id` ON `agent_conversation_segments` (`topic_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_conversation_segments_status` ON `agent_conversation_segments` (`status`);--> statement-breakpoint
CREATE INDEX `idx_agent_conversation_segments_sdk_session_id` ON `agent_conversation_segments` (`sdk_session_id`);--> statement-breakpoint
CREATE TABLE `agent_turns` (
	`id` text PRIMARY KEY NOT NULL,
	`topic_id` text NOT NULL,
	`segment_id` text NOT NULL,
	`trace_id` text,
	`user_message_id` text DEFAULT '' NOT NULL,
	`assistant_message_id` text,
	`user_text` text,
	`assistant_text` text,
	`cumulative_input_tokens` integer DEFAULT 0 NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`status` text NOT NULL,
	FOREIGN KEY (`topic_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`segment_id`) REFERENCES `agent_conversation_segments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_agent_turns_topic_id` ON `agent_turns` (`topic_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_turns_segment_id` ON `agent_turns` (`segment_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_turns_started_at` ON `agent_turns` (`started_at`);--> statement-breakpoint
CREATE TABLE `agent_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`topic_id` text NOT NULL,
	`segment_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`source_type` text NOT NULL,
	`tool_subtype` text,
	`tool_call_id` text,
	`file_path` text,
	`uri` text,
	`line_start` integer,
	`line_end` integer,
	`content` text NOT NULL,
	`content_hash` text NOT NULL,
	`summary` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`topic_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`segment_id`) REFERENCES `agent_conversation_segments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`turn_id`) REFERENCES `agent_turns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_agent_artifacts_topic_id` ON `agent_artifacts` (`topic_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_artifacts_turn_id` ON `agent_artifacts` (`turn_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_artifacts_tool_call_id` ON `agent_artifacts` (`tool_call_id`);--> statement-breakpoint
CREATE TABLE `agent_file_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`topic_id` text NOT NULL,
	`segment_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`message_id` text,
	`tool_call_id` text,
	`file_path` text NOT NULL,
	`operation` text NOT NULL,
	`before_snapshot` text,
	`after_snapshot` text,
	`patch` text,
	`before_hash` text,
	`after_hash` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`topic_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`segment_id`) REFERENCES `agent_conversation_segments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`turn_id`) REFERENCES `agent_turns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_agent_file_changes_topic_id` ON `agent_file_changes` (`topic_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_file_changes_turn_id` ON `agent_file_changes` (`turn_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_file_changes_file_path` ON `agent_file_changes` (`file_path`);
