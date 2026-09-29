-- Balance corrections (reconciliation, "Update value"), so income and spending reports can
-- leave them out. Existing ones are recognized by the notes the app gave them.
ALTER TABLE `transactions` ADD `is_adjustment` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE `transactions` SET `is_adjustment` = 1
WHERE `notes` IN ('Reconciliation adjustment', 'Value update', 'Balance update')
  AND `category_id` IS NULL AND `payee_id` IS NULL AND `transfer_transaction_id` IS NULL;
