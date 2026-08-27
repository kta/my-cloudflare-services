CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text,
	`actor_type` text NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`request_id` text,
	`metadata` text NOT NULL,
	`occurred_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_events_org_occurred_idx` ON `audit_events` (`organization_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `audit_events_org_entity_idx` ON `audit_events` (`organization_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `idempotency_records` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`operation` text NOT NULL,
	`key` text NOT NULL,
	`request_hash` text NOT NULL,
	`status` text NOT NULL,
	`result_json` text,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idempotency_org_operation_key_idx` ON `idempotency_records` (`organization_id`,`operation`,`key`);--> statement-breakpoint
CREATE INDEX `idempotency_expires_at_idx` ON `idempotency_records` (`expires_at`);--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`plan` text NOT NULL,
	`is_disabled` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `store_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`user_id` text NOT NULL,
	`permissions` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `store_memberships_org_user_idx` ON `store_memberships` (`organization_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `store_memberships_org_store_user_idx` ON `store_memberships` (`organization_id`,`store_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `stores` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`is_active` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `stores_organization_id_idx` ON `stores` (`organization_id`);--> statement-breakpoint
CREATE INDEX `stores_organization_active_idx` ON `stores` (`organization_id`,`is_active`);--> statement-breakpoint
CREATE TRIGGER `audit_events_no_update`
BEFORE UPDATE ON `audit_events`
BEGIN
	SELECT RAISE(ABORT, 'audit_events are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `audit_events_no_delete`
BEFORE DELETE ON `audit_events`
BEGIN
	SELECT RAISE(ABORT, 'audit_events are append-only');
END;
