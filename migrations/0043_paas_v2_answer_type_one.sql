UPDATE competitions
SET paas_v2_answer_type = '1'
WHERE sso_method = 'paasV2' AND paas_v2_answer_type IS NOT '1';
