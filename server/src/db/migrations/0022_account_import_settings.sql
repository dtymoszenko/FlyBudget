-- How each account's bank writes its CSV files (separator, encoding, column mapping, date and
-- amount formats), remembered from the last import so they don't have to be chosen again.
ALTER TABLE `accounts` ADD `import_settings` text;
