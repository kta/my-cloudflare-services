CREATE TABLE `reservation_slot_locks` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`reservation_id` text NOT NULL,
	`kind` text NOT NULL,
	`target_key` text NOT NULL,
	`slot_start` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `reservation_slot_locks_org_store_target_slot_idx` ON `reservation_slot_locks` (`organization_id`,`store_id`,`kind`,`target_key`,`slot_start`);--> statement-breakpoint
CREATE INDEX `reservation_slot_locks_org_reservation_idx` ON `reservation_slot_locks` (`organization_id`,`reservation_id`);