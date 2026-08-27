DROP INDEX `store_memberships_org_store_user_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `store_memberships_org_store_user_idx` ON `store_memberships` (`organization_id`,`store_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `stores_organization_slug_unique_idx` ON `stores` (`organization_id`,`slug`);