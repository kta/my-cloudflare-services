PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`reservation_number` text NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`start_at` text NOT NULL,
	`end_at` text NOT NULL,
	`purpose_ids_json` text NOT NULL,
	`customer_id` text,
	`customer_name` text NOT NULL,
	`customer_kana` text NOT NULL,
	`customer_phone` text NOT NULL,
	`customer_email` text,
	`recital` text NOT NULL,
	`reservation_memo` text,
	`handoff_note` text,
	`progress` text,
	`wait_started_at` text,
	`assigned_staff_id` text,
	`assigned_equipment_ids_json` text,
	`next_guidance` text,
	`progress_operation_id` text,
	`version` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text
);
--> statement-breakpoint
INSERT INTO `__new_reservations`("id", "organization_id", "store_id", "reservation_number", "source", "status", "start_at", "end_at", "purpose_ids_json", "customer_id", "customer_name", "customer_kana", "customer_phone", "customer_email", "recital", "reservation_memo", "handoff_note", "progress", "wait_started_at", "assigned_staff_id", "assigned_equipment_ids_json", "next_guidance", "progress_operation_id", "version", "created_at", "updated_at") SELECT "id", "organization_id", "store_id", "reservation_number", "source", "status", "start_at", "end_at", "purpose_ids_json", "customer_id", "customer_name", "customer_kana", "customer_phone", "customer_email", "recital", "reservation_memo", "handoff_note", "progress", "wait_started_at", "assigned_staff_id", "assigned_equipment_ids_json", "next_guidance", "progress_operation_id", "version", "created_at", "updated_at" FROM `reservations`;--> statement-breakpoint
DROP TABLE `reservations`;--> statement-breakpoint
ALTER TABLE `__new_reservations` RENAME TO `reservations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `reservations_org_number_unique_idx` ON `reservations` (`organization_id`,`reservation_number`);--> statement-breakpoint
CREATE INDEX `reservations_org_store_start_idx` ON `reservations` (`organization_id`,`store_id`,`start_at`);