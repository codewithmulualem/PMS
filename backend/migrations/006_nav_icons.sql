-- Distinct sidebar icons: "My Evaluations" uses clipboard, "Audit Log" uses clock.
UPDATE navigation_items SET icon = 'clipboard' WHERE item_key = 'evaluations';
UPDATE navigation_items SET icon = 'clock' WHERE item_key = 'audit';
