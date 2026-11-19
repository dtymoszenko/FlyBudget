-- A color for each category (#RRGGBB, like goals have), so it's part of the budget instead of
-- being chosen again on every device. Null = the client picks one.
ALTER TABLE `categories` ADD `color` text;
