ALTER TABLE `rules` ADD `conditions_op` text DEFAULT 'and' NOT NULL;
--> statement-breakpoint
ALTER TABLE `rules` ADD `enabled` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `transactions` ADD `imported_payee` text;