export function allowedOrigins(env) {
    return new Set(String(env.CORS_ORIGINS || 'https://mcgo.app,http://localhost:5173,http://127.0.0.1:5173')
        .split(',').map(value => value.trim()).filter(Boolean));
}
