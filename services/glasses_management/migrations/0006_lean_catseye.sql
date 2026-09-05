CREATE TABLE `alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`code` text NOT NULL,
	`severity` text NOT NULL,
	`audience` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`target_type` text,
	`target_id` text,
	`occurred_at` text NOT NULL,
	`read_at` text,
	`resolved_at` text,
	`resolved_by` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `alerts_org_store_occurred_idx` ON `alerts` (`organization_id`,`store_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `alerts_org_store_resolved_idx` ON `alerts` (`organization_id`,`store_id`,`resolved_at`);--> statement-breakpoint
CREATE TABLE `recordings` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`code` text NOT NULL,
	`reception_session_id` text NOT NULL,
	`reservation_id` text,
	`r2_key` text NOT NULL,
	`content_type` text NOT NULL,
	`duration_seconds` integer,
	`bytes` integer,
	`state` text NOT NULL,
	`retain_until` text,
	`legal_hold` text NOT NULL,
	`upload_attempts` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recordings_org_code_idx` ON `recordings` (`organization_id`,`code`);--> statement-breakpoint
CREATE INDEX `recordings_org_state_retain_idx` ON `recordings` (`organization_id`,`state`,`retain_until`);--> statement-breakpoint
CREATE INDEX `recordings_org_session_idx` ON `recordings` (`organization_id`,`reception_session_id`);--> statement-breakpoint
CREATE INDEX `recordings_org_reservation_idx` ON `recordings` (`organization_id`,`reservation_id`);