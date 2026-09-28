CREATE TABLE `dashboard_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dashboard_widgets` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`type` text NOT NULL,
	`custom_report_id` text,
	`x` integer DEFAULT 0 NOT NULL,
	`y` integer DEFAULT 0 NOT NULL,
	`width` integer DEFAULT 6 NOT NULL,
	`height` integer DEFAULT 4 NOT NULL,
	`meta` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `dashboard_pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`custom_report_id`) REFERENCES `custom_reports`(`id`) ON UPDATE no action ON DELETE cascade
);
