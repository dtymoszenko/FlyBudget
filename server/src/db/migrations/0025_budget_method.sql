-- How months add up: zero-based (as before) or category budgeting, where each month starts
-- fresh unless the budget or a category carries over.
ALTER TABLE `budget_settings` ADD `budget_method` text DEFAULT 'zero_based' NOT NULL;--> statement-breakpoint
ALTER TABLE `budget_settings` ADD `carry_over` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `categories` ADD `carry_over` integer;
