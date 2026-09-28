ALTER TABLE `dashboard_pages` ADD `date_range` text;
--> statement-breakpoint
-- Widgets now follow their dashboard's date range unless they're frozen, so drop the live
-- ranges they were created with and keep only frozen ones.
UPDATE `dashboard_widgets` SET `meta` = json_remove(`meta`, '$.dateRange')
WHERE json_extract(`meta`, '$.dateRange.preset') IS NOT 'custom';
