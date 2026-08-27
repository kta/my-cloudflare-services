CREATE TABLE `web_booking_records` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `store_id` text NOT NULL,
  `reservation_id` text NOT NULL,
  `management_code_hash` text NOT NULL,
  `consent_version` text NOT NULL,
  `consented_at` text NOT NULL,
  `input_history_json` text NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `web_booking_records_org_reservation_unique_idx` ON `web_booking_records` (`organization_id`,`reservation_id`);
--> statement-breakpoint
CREATE INDEX `web_booking_records_org_store_created_idx` ON `web_booking_records` (`organization_id`,`store_id`,`created_at`);
