ALTER TABLE `web_booking_records` ADD `confirmation_key_hash` text;
--> statement-breakpoint
CREATE INDEX `web_booking_records_confirmation_key_idx` ON `web_booking_records` (`confirmation_key_hash`);
