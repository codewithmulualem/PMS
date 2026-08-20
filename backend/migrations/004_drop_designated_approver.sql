-- 004_drop_designated_approver.sql
-- Approval depth is now derived from the employee's position in the org
-- hierarchy (leaves get more approval levels, root employees get none and are
-- scored on submission). Apex levels become a multi-approval process across
-- all top executives. The chain never runs out mid-flow, so the admin-assigned
-- designated-approver override (added in 003) is dead code and is removed.

ALTER TABLE evaluation_assignments DROP COLUMN designated_approver_id;
