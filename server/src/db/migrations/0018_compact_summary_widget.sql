-- The Summary widget now fits in one grid row (title, dates and figures on one line), so
-- shrink the ones still at the old default of two rows
UPDATE `dashboard_widgets` SET `height` = 1 WHERE `type` = 'summary' AND `height` = 2;
