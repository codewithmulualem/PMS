-- 002_weights_percent.sql
-- Scoring weights are now expressed as percentages (summing to 100) instead
-- of fractions (summing to 1.0). Convert any existing rows stored as fractions
-- (values <= 1.0) to their percentage equivalent.
-- The scoring engine normalizes by the weight sum, so scores are unchanged.

UPDATE score_weights
SET kpi_weight        = ROUND(kpi_weight        * 100, 4),
    goal_weight       = ROUND(goal_weight       * 100, 4),
    competency_weight = ROUND(competency_weight * 100, 4),
    behavior_weight   = ROUND(behavior_weight   * 100, 4),
    project_weight    = ROUND(project_weight    * 100, 4)
WHERE kpi_weight IS NOT NULL AND kpi_weight <= 1.0;
