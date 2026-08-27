CREATE TABLE `alert_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`conditions_json` text NOT NULL,
	`notification_targets_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `alert_settings_org_store_unique_idx` ON `alert_settings` (`organization_id`,`store_id`);--> statement-breakpoint
CREATE TABLE `analytics_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`small_sample_threshold` integer NOT NULL,
	`targets_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_settings_org_unique_idx` ON `analytics_settings` (`organization_id`);--> statement-breakpoint
CREATE TABLE `operational_alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`kind` text NOT NULL,
	`code` text NOT NULL,
	`title` text NOT NULL,
	`reason` text NOT NULL,
	`subject` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`occurred_at` text NOT NULL,
	`next_action` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`read_at` text,
	`read_by` text,
	`resolved_at` text,
	`resolved_by` text,
	`resolution_note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `operational_alerts_org_dedupe_unique_idx` ON `operational_alerts` (`organization_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `operational_alerts_org_store_occurred_idx` ON `operational_alerts` (`organization_id`,`store_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `web_booking_funnel_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`session_id` text NOT NULL,
	`stage` text NOT NULL,
	`occurred_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `web_booking_funnel_org_session_stage_unique_idx` ON `web_booking_funnel_events` (`organization_id`,`session_id`,`stage`);--> statement-breakpoint
CREATE INDEX `web_booking_funnel_org_store_occurred_idx` ON `web_booking_funnel_events` (`organization_id`,`store_id`,`occurred_at`);