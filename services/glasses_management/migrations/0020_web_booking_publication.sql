CREATE TABLE `web_booking_publications` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `store_id` text NOT NULL,
  `public_slug` text NOT NULL,
  `status` text NOT NULL,
  `starts_at` text,
  `ends_at` text,
  `contact_phone` text NOT NULL,
  `access_text` text NOT NULL,
  `notice` text NOT NULL,
  `region` text NOT NULL,
  `nearest_station` text NOT NULL,
  `latitude` text,
  `longitude` text,
  `public_purpose_ids_json` text NOT NULL,
  `public_purposes_json` text,
  `version` integer NOT NULL,
  `published_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `web_booking_publications_org_store_unique_idx` ON `web_booking_publications` (`organization_id`,`store_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `web_booking_publications_public_slug_unique_idx` ON `web_booking_publications` (`public_slug`);
--> statement-breakpoint
CREATE INDEX `web_booking_publications_status_window_idx` ON `web_booking_publications` (`status`,`starts_at`,`ends_at`);
