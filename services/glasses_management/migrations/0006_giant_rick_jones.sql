CREATE TABLE `reservation_resource_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`reservation_id` text NOT NULL,
	`resource_kind` text NOT NULL,
	`resource_id` text NOT NULL,
	`slot_start_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reservation_resource_claim_unique_idx` ON `reservation_resource_allocations` (`organization_id`,`store_id`,`resource_kind`,`resource_id`,`slot_start_at`);--> statement-breakpoint
CREATE INDEX `reservation_resource_allocations_reservation_idx` ON `reservation_resource_allocations` (`organization_id`,`reservation_id`);