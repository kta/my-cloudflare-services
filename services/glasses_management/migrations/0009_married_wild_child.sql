CREATE TABLE `reservation_progress_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`reservation_id` text NOT NULL,
	`from_progress` text,
	`to_progress` text NOT NULL,
	`assigned_staff_id` text,
	`assigned_equipment_ids_json` text NOT NULL,
	`next_guidance` text,
	`version` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `reservation_progress_events_org_reservation_idx` ON `reservation_progress_events` (`organization_id`,`reservation_id`,`created_at`);--> statement-breakpoint
CREATE TRIGGER `reservation_progress_events_no_update`
BEFORE UPDATE ON `reservation_progress_events`
BEGIN
	SELECT RAISE(ABORT, 'reservation progress events are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `reservation_progress_events_no_delete`
BEFORE DELETE ON `reservation_progress_events`
BEGIN
	SELECT RAISE(ABORT, 'reservation progress events are append-only');
END;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_availability_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`version` integer NOT NULL,
	`reception_status` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text
);
--> statement-breakpoint
INSERT INTO `__new_availability_settings`("id", "organization_id", "store_id", "version", "reception_status", "updated_by", "updated_at") SELECT "id", "organization_id", "store_id", "version", "reception_status", "updated_by", "updated_at" FROM `availability_settings`;--> statement-breakpoint
DROP TABLE `availability_settings`;--> statement-breakpoint
ALTER TABLE `__new_availability_settings` RENAME TO `availability_settings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `availability_settings_org_store_idx` ON `availability_settings` (`organization_id`,`store_id`);
