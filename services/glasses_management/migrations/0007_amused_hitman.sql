CREATE TABLE `web_booking_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`is_published` text NOT NULL,
	`opens_at` text NOT NULL,
	`closes_at` text NOT NULL,
	`accept_from_hours` integer NOT NULL,
	`accept_until_days` integer NOT NULL,
	`change_deadline_days` integer NOT NULL,
	`requires_approval` text NOT NULL,
	`message` text,
	`version` integer NOT NULL,
	`updated_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `web_booking_settings_org_store_idx` ON `web_booking_settings` (`organization_id`,`store_id`);--> statement-breakpoint
CREATE TABLE `web_bookings` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`reservation_id` text NOT NULL,
	`public_code` text NOT NULL,
	`confirmation_key_hash` text NOT NULL,
	`management_code_hash` text NOT NULL,
	`contact_name` text NOT NULL,
	`contact_kana` text,
	`contact_phone` text NOT NULL,
	`contact_email` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`confirmed_at` text,
	`cancelled_at` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `web_bookings_org_reservation_idx` ON `web_bookings` (`organization_id`,`reservation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `web_bookings_org_public_code_idx` ON `web_bookings` (`organization_id`,`public_code`);--> statement-breakpoint
CREATE INDEX `web_bookings_org_store_status_idx` ON `web_bookings` (`organization_id`,`store_id`,`status`);