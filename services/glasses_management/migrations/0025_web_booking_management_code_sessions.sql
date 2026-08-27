CREATE TABLE `web_booking_management_code_issues` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `store_id` text NOT NULL,
  `reservation_id` text NOT NULL,
  `code_hash` text NOT NULL,
  `issued_at` text NOT NULL,
  `expires_at` text NOT NULL,
  `revoked_at` text,
  `failed_attempts` integer NOT NULL,
  `issued_by` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `web_booking_management_code_issues_hash_unique_idx` ON `web_booking_management_code_issues` (`code_hash`);
--> statement-breakpoint
CREATE INDEX `web_booking_management_code_issues_org_reservation_idx` ON `web_booking_management_code_issues` (`organization_id`,`reservation_id`,`issued_at`);
--> statement-breakpoint
CREATE TABLE `web_booking_verified_sessions` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `store_id` text NOT NULL,
  `reservation_id` text NOT NULL,
  `token_hash` text NOT NULL,
  `created_at` text NOT NULL,
  `expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `web_booking_verified_sessions_token_hash_unique_idx` ON `web_booking_verified_sessions` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `web_booking_verified_sessions_org_reservation_idx` ON `web_booking_verified_sessions` (`organization_id`,`reservation_id`,`expires_at`);
--> statement-breakpoint
-- Preserve the management-code capability of Web bookings created before
-- this history table existed. The source hash is already non-plaintext.
-- Non-confirmed reservations are migrated as revoked so they cannot regain
-- customer self-service access merely by applying this schema migration.
INSERT INTO `web_booking_management_code_issues`
  (`id`, `organization_id`, `store_id`, `reservation_id`, `code_hash`, `issued_at`, `expires_at`, `revoked_at`, `failed_attempts`, `issued_by`)
SELECT
  w.`id`,
  w.`organization_id`,
  w.`store_id`,
  w.`reservation_id`,
  w.`management_code_hash`,
  w.`created_at`,
  r.`end_at`,
  CASE WHEN r.`status` = 'confirmed' THEN NULL ELSE COALESCE(r.`updated_at`, w.`created_at`) END,
  0,
  'migration:0025'
FROM `web_booking_records` AS w
INNER JOIN `reservations` AS r
  ON r.`organization_id` = w.`organization_id`
 AND r.`store_id` = w.`store_id`
 AND r.`id` = w.`reservation_id`
WHERE NOT EXISTS (
  SELECT 1 FROM `web_booking_management_code_issues` AS i
  WHERE i.`organization_id` = w.`organization_id`
    AND i.`reservation_id` = w.`reservation_id`
);
