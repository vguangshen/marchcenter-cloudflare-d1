import pool from '../config/db.js';

export async function isPlatformAccountReady(userId, competitionId, loginRole, studentIndex = 1) {
    const [rows] = await pool.query(
        `SELECT 1 FROM user_platform_account_status
         WHERE user_id = ? AND competition_id = ? AND login_role = ? AND student_index = ? LIMIT 1`,
        [userId, competitionId, loginRole === 'teacher' ? 'teacher' : 'student', Number(studentIndex) || 1]
    );
    return rows.length > 0;
}

export async function markPlatformAccountReady(userId, competitionId, loginRole, studentIndex = 1, binding) {
    const values = [userId, competitionId, loginRole === 'teacher' ? 'teacher' : 'student', Number(studentIndex) || 1];
    const agentBound = binding?.ssoMethod === 'paasV2';
    const source = binding ? `SELECT ?, ?, ?, ? WHERE EXISTS (
        SELECT 1 FROM competitions WHERE id = ? AND url IS ? AND sso_config_id IS ? AND sso_method IS ? AND class_type IS ?
        ${agentBound ? "AND NULLIF(paas_v2_plug_flag, '') IS ? AND NULLIF(paas_v2_software_unique, '') IS ?" : ''}
    )` : 'VALUES (?, ?, ?, ?)';
    if (binding) {
        values.push(competitionId, binding.url, binding.ssoConfigId, binding.ssoMethod, binding.classType);
        if (agentBound) values.push(binding.paasV2PlugFlag || null, binding.paasV2SoftwareUnique || null);
    }
    const [result] = await pool.query(
        `INSERT INTO user_platform_account_status
            (user_id, competition_id, login_role, student_index)
         ${source}
         ON CONFLICT(user_id, competition_id, login_role, student_index) DO UPDATE SET
            ready_at = CURRENT_TIMESTAMP`,
        values
    );
    return result.affectedRows > 0;
}

export async function clearPlatformAccountStatusForUser(userId) {
    await pool.query('DELETE FROM user_platform_account_status WHERE user_id = ?', [userId]);
}
