CREATE TABLE `recording_retention_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`confirmed_retention_days` integer NOT NULL,
	`discarded_retention_hours` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recording_retention_org_store_unique_idx` ON `recording_retention_settings` (`organization_id`,`store_id`);--> statement-breakpoint
CREATE TABLE `recordings` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`reception_session_id` text NOT NULL,
	`reservation_id` text,
	`recorder_type` text NOT NULL,
	`recorder_id` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text NOT NULL,
	`duration_seconds` integer NOT NULL,
	`end_reason` text NOT NULL,
	`state` text NOT NULL,
	`content_type` text NOT NULL,
	`storage_key` text NOT NULL,
	`retention_until` text,
	`hold_reason` text,
	`held_by` text,
	`held_at` text,
	`failure_reason` text,
	`deleted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `recordings_org_store_state_idx` ON `recordings` (`organization_id`,`store_id`,`state`);--> statement-breakpoint
CREATE INDEX `recordings_org_retention_idx` ON `recordings` (`organization_id`,`retention_until`);--> statement-breakpoint
CREATE INDEX `recordings_org_reservation_idx` ON `recordings` (`organization_id`,`reservation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `recordings_org_session_unique_idx` ON `recordings` (`organization_id`,`reception_session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `recordings_storage_key_unique_idx` ON `recordings` (`storage_key`);