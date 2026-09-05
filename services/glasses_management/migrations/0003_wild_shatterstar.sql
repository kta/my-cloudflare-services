CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text,
	`actor_type` text NOT NULL,
	`actor_id` text,
	`terminal_id` text,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`before_json` text,
	`after_json` text,
	`correlation_id` text,
	`occurred_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_events_org_occurred_idx` ON `audit_events` (`organization_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `audit_events_org_target_idx` ON `audit_events` (`organization_id`,`target_type`,`target_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `idempotency_records` (
	`key` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`scope` text NOT NULL,
	`request_hash` text NOT NULL,
	`response_json` text,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idempotency_records_expires_idx` ON `idempotency_records` (`expires_at`);--> statement-breakpoint
CREATE TABLE `reception_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`reservation_id` text,
	`terminal_id` text,
	`actor_id` text,
	`started_at` text NOT NULL,
	`ended_at` text,
	`outcome` text,
	`draft_json` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `reception_sessions_org_store_started_idx` ON `reception_sessions` (`organization_id`,`store_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `reception_sessions_org_reservation_idx` ON `reception_sessions` (`organization_id`,`reservation_id`);