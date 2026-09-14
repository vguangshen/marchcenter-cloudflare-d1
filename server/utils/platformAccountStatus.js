import pool from '../config/db.js';

export async function isPlatformAccountReady(userId, competitionId, loginRole, studentIndex = 1) {
    const [rows] = await pool.query(
        `SELECT 1 FROM user_platform_account_status
         WHERE user_id = ? AND competition_id = ? AND login_role = ? AND student_index = ? LIMIT 1`,
        [userId, competitionId, loginRole === 'teacher' ? 'teacher' : 'student', Number(studentIndex) || 1]
    );
    return rows.length > 0;
}

export async function markPlatformAccountReady(userId, competitionId, loginRole, studentIndex = 1) {
    await pool.query(
        `INSERT INTO user_platform_account_status
            (user_id, competition_id, login_role, student_index)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, competition_id, login_role, student_index) DO UPDATE SET
            ready_at = CURRENT_TIMESTAMP`,
        [userId, competitionId, loginRole === 'teacher' ? 'teacher' : 'student', Number(studentIndex) || 1]
    );
}

export async function clearPlatformAccountStatusForUser(userId) {
    await pool.query('DELETE FROM user_platform_account_status WHERE user_id = ?', [userId]);
}
