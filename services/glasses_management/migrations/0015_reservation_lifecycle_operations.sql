CREATE TABLE `reservation_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`reservation_id` text NOT NULL,
	`action` text NOT NULL,
	`reason` text,
	`before_json` text NOT NULL,
	`after_json` text NOT NULL,
	`actor_id` text NOT NULL,
	`occurred_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `reservation_changes_org_reservation_idx` ON `reservation_changes` (`organization_id`,`reservation_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `walkin_daily_sequences` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`service_date` text NOT NULL,
	`next_sequence` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `walkin_daily_sequences_org_store_date_idx` ON `walkin_daily_sequences` (`organization_id`,`store_id`,`service_date`);--> statement-breakpoint
ALTER TABLE `reservations` ADD `customer_phone_normalized` text;--> statement-breakpoint
-- Keep legacy snapshot phone search equivalent to the runtime normalizer:
-- ASCII/full-width digits are retained; all formatting or other characters are dropped.
WITH RECURSIVE phone_chars(id, source, position, normalized) AS (
  SELECT id, customer_phone, 1, '' FROM reservations
  UNION ALL
  SELECT
    id,
    source,
    position + 1,
    normalized || CASE substr(source, position, 1)
      WHEN '0' THEN '0' WHEN '1' THEN '1' WHEN '2' THEN '2' WHEN '3' THEN '3' WHEN '4' THEN '4'
      WHEN '5' THEN '5' WHEN '6' THEN '6' WHEN '7' THEN '7' WHEN '8' THEN '8' WHEN '9' THEN '9'
      WHEN '０' THEN '0' WHEN '１' THEN '1' WHEN '２' THEN '2' WHEN '３' THEN '3' WHEN '４' THEN '4'
      WHEN '５' THEN '5' WHEN '６' THEN '6' WHEN '７' THEN '7' WHEN '８' THEN '8' WHEN '９' THEN '9'
      ELSE ''
    END
  FROM phone_chars
  WHERE position <= length(source)
)
UPDATE reservations
SET customer_phone_normalized = (
  SELECT normalized
  FROM phone_chars
  WHERE phone_chars.id = reservations.id
    AND phone_chars.position = length(phone_chars.source) + 1
);--> statement-breakpoint
CREATE INDEX `reservations_org_store_customer_phone_normalized_idx`
ON `reservations` (`organization_id`, `store_id`, `customer_phone_normalized`);--> statement-breakpoint
CREATE TRIGGER `reservation_changes_no_update`
BEFORE UPDATE ON `reservation_changes`
BEGIN
  SELECT RAISE(ABORT, 'reservation changes are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `reservation_changes_no_delete`
BEFORE DELETE ON `reservation_changes`
BEGIN
  SELECT RAISE(ABORT, 'reservation changes are append-only');
END;--> statement-breakpoint
-- Preserve provisional labels when this table is introduced to an existing store.
INSERT INTO `walkin_daily_sequences` (`id`, `organization_id`, `store_id`, `service_date`, `next_sequence`)
SELECT lower(hex(randomblob(16))), organization_id, store_id, service_date, MAX(sequence) + 1
FROM walkins
GROUP BY organization_id, store_id, service_date
ON CONFLICT(`organization_id`, `store_id`, `service_date`) DO UPDATE SET
  next_sequence = MAX(walkin_daily_sequences.next_sequence, excluded.next_sequence);
