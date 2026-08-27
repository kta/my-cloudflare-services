CREATE TABLE `walkin_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`walkin_id` text NOT NULL,
	`event_type` text NOT NULL,
	`from_customer_id` text,
	`to_customer_id` text,
	`from_progress` text,
	`to_progress` text,
	`version` integer NOT NULL,
	`occurred_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `walkin_events_org_walkin_idx` ON `walkin_events` (`organization_id`,`walkin_id`,`occurred_at`);--> statement-breakpoint
CREATE TRIGGER `walkin_events_no_update` BEFORE UPDATE ON `walkin_events` BEGIN SELECT RAISE(ABORT, 'walkin events are append-only'); END;--> statement-breakpoint
CREATE TRIGGER `walkin_events_no_delete` BEFORE DELETE ON `walkin_events` BEGIN SELECT RAISE(ABORT, 'walkin events are append-only'); END;
