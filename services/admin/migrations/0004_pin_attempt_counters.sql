CREATE TABLE `pin_attempt_counters` (
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`failures` integer NOT NULL,
	`locked_until` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pin_attempt_counters_org_user_unique_idx` ON `pin_attempt_counters` (`organization_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `pin_attempt_counters_org_user_idx` ON `pin_attempt_counters` (`organization_id`,`user_id`);