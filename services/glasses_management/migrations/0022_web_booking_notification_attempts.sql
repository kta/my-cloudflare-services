CREATE TABLE `web_booking_notification_attempts` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `store_id` text NOT NULL,
  `reservation_id` text NOT NULL,
  `notification_id` text NOT NULL,
  `notification_type` text NOT NULL,
  `status` text NOT NULL,
  `attempted_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `web_booking_notification_attempts_org_reservation_idx` ON `web_booking_notification_attempts` (`organization_id`,`reservation_id`,`attempted_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `web_booking_notification_attempts_notification_status_unique_idx` ON `web_booking_notification_attempts` (`organization_id`,`notification_id`,`status`);
