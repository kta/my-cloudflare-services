CREATE TABLE `visit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`stage` text NOT NULL,
	`occurred_at` text NOT NULL,
	`staff_id` text,
	`note` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `visit_events_org_subject_idx` ON `visit_events` (`organization_id`,`subject_type`,`subject_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `visit_events_org_store_occurred_idx` ON `visit_events` (`organization_id`,`store_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `walk_ins` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`visit_date` text NOT NULL,
	`ticket_no` integer NOT NULL,
	`arrived_at` text NOT NULL,
	`purpose_id` text,
	`purpose_note` text,
	`customer_id` text,
	`reservation_id` text NOT NULL,
	`status` text NOT NULL,
	`left_at` text,
	`version` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `walk_ins_org_store_date_ticket_idx` ON `walk_ins` (`organization_id`,`store_id`,`visit_date`,`ticket_no`);--> statement-breakpoint
CREATE INDEX `walk_ins_org_store_arrived_idx` ON `walk_ins` (`organization_id`,`store_id`,`arrived_at`);--> statement-breakpoint
CREATE INDEX `walk_ins_org_store_date_status_idx` ON `walk_ins` (`organization_id`,`store_id`,`visit_date`,`status`);