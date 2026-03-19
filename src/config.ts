import dotenv from 'dotenv';

dotenv.config();

export const config = {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
    TELEGRAM_ALLOWED_USER_IDS: (process.env.TELEGRAM_ALLOWED_USER_IDS || '').split(',').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id)),
    GROQ_API_KEY: process.env.GROQ_API_KEY || '',
    GROQ_API_KEY_2: process.env.GROQ_API_KEY_2 || '',
    GROQ_API_KEY_3: process.env.GROQ_API_KEY_3 || '',
    GROQ_API_KEY_4: process.env.GROQ_API_KEY_4 || '',
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || '',
    OPENROUTER_MODEL: process.env.OPENROUTER_MODEL || 'google/gemma-2-9b-it:free',
    DB_PATH: process.env.DB_PATH || './memory.db',
    GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS || './service-account.json'
};

// Validación básica
if (!config.TELEGRAM_BOT_TOKEN || config.TELEGRAM_BOT_TOKEN === 'SUTITUYE POR EL TUYO') {
    console.warn('⚠️ ADVERTENCIA: TELEGRAM_BOT_TOKEN no está configurado correctamente.');
}
if (config.TELEGRAM_ALLOWED_USER_IDS.length === 0) {
    console.warn('⚠️ ADVERTENCIA: TELEGRAM_ALLOWED_USER_IDS no está configurado o es inválido.');
}
if (!config.GROQ_API_KEY || config.GROQ_API_KEY === 'SUTITUYE POR EL TUYO') {
    console.warn('⚠️ ADVERTENCIA: GROQ_API_KEY no está configurada.');
}
