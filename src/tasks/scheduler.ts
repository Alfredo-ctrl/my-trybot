/**
 * Sistema de notificaciones y tareas programadas (Proactive Messaging).
 * 
 * Permite que Trybot:
 * - Monitoree tu Gmail y te avise cuando llegue un correo específico
 * - Te mande un recordatorio a una hora determinada
 * - Revise tu calendario cada mañana y te cuente el día
 */

import cron from 'node-cron';
import { bot } from '../bot/index.js';
import { config } from '../config.js';

interface ScheduledAlert {
    id: string;
    type: 'email_watch' | 'reminder' | 'calendar_digest';
    userId: number;
    cronExpression: string;           // Expresión cron (ej: "0 8 * * *" = 8 AM diario)
    message?: string;                  // Mensaje de recordatorio (para 'reminder')
    emailQuery?: string;               // Query de Gmail a monitorear (para 'email_watch')
    lastEmailIds?: Set<string>;        // IDs de correos ya vistos (para evitar duplicados)
    task?: cron.ScheduledTask;
}

const activeAlerts = new Map<string, ScheduledAlert>();

// ── Utilidades internas ────────────────────────────────────────────────

async function sendToUser(userId: number, text: string): Promise<void> {
    try {
        await bot.api.sendMessage(userId, text, { parse_mode: 'Markdown' });
    } catch (err) {
        console.error('[Scheduler] Error enviando mensaje:', err);
    }
}

async function runGogCommand(cmd: string): Promise<string> {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    try {
        const fullCmd = `powershell -Command "$env:ZONEINFO='C:\\trybot\\zoneinfo.zip'; $env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User'); gog ${cmd}"`;
        const { stdout } = await execAsync(fullCmd, { maxBuffer: 2 * 1024 * 1024 });
        return stdout.trim();
    } catch (err: any) {
        return err.stdout?.trim() || err.message;
    }
}

// ── Creadores de alertas ───────────────────────────────────────────────

/**
 * Crea un recordatorio que se dispara una vez a una hora específica del día.
 * @param userId  ID de Telegram del usuario
 * @param message Mensaje del recordatorio
 * @param hour    Hora en formato HH (24h, hora de México UTC-6)
 * @param minute  Minuto
 * @param days    Días de la semana (1-7, lunes-domingo). Omitir = todos los días.
 */
export function scheduleReminder(userId: number, message: string, hour: number, minute: number = 0, days?: number[]): string {
    const id = `reminder_${Date.now()}`;
    // Convertir a UTC (México = UTC-6 en invierno, UTC-5 en verano)
    const utcHour = (hour + 6) % 24;
    const dayField = days ? days.join(',') : '*';
    const cronExpr = `${minute} ${utcHour} * * ${dayField}`;

    const task = cron.schedule(cronExpr, async () => {
        console.log(`[Scheduler] 🔔 Disparando recordatorio: ${message}`);
        await sendToUser(userId, `🔔 *Recordatorio de Trybot:*\n\n${message}`);
    }, { timezone: 'America/Mexico_City' });

    activeAlerts.set(id, { id, type: 'reminder', userId, cronExpression: cronExpr, message, task });
    console.log(`[Scheduler] ✅ Recordatorio programado: "${message}" a las ${hour}:${minute.toString().padStart(2,'0')}`);
    return id;
}

/**
 * Monitorea Gmail cada N minutos y notifica si llega correo que coincida con la query.
 * @param userId     ID de Telegram del usuario
 * @param emailQuery Query de Gmail (ej: "from:maestra@escuela.edu")
 * @param label      Etiqueta descriptiva para el usuario
 * @param minutes    Intervalo de revisión en minutos (mínimo 5)
 */
export function watchEmail(userId: number, emailQuery: string, label: string, minutes: number = 10): string {
    const id = `email_watch_${Date.now()}`;
    const interval = Math.max(5, minutes);
    const cronExpr = `*/${interval} * * * *`;

    const knownIds = new Set<string>();

    const task = cron.schedule(cronExpr, async () => {
        try {
            const raw = await runGogCommand(`gmail search "${emailQuery}" --max 5 --json`);
            const data = JSON.parse(raw);
            const messages: any[] = data.messages || data.threads || [];

            for (const msg of messages) {
                if (!knownIds.has(msg.id)) {
                    knownIds.add(msg.id);
                    // Si ya hay IDs conocidos de antes, es un correo nuevo
                    if (knownIds.size > messages.length) {
                        const notif = `📬 *Nuevo correo detectado (${label}):*\n` +
                            `*De:* ${msg.from || 'Desconocido'}\n` +
                            `*Asunto:* ${msg.subject || '(sin asunto)'}\n` +
                            `*Fecha:* ${msg.date || ''}`;
                        await sendToUser(userId, notif);
                    }
                }
            }
        } catch { /* silencioso si falla */ }
    }, { timezone: 'America/Mexico_City' });

    activeAlerts.set(id, { id, type: 'email_watch', userId, cronExpression: cronExpr, emailQuery, lastEmailIds: knownIds, task });
    console.log(`[Scheduler] 👁️ Monitoreando correos de "${emailQuery}" cada ${interval} min`);
    return id;
}

/**
 * Resumen diario de calendario — se manda cada mañana a las 8 AM Mexico.
 */
export function scheduleDailyDigest(userId: number): string {
    const id = `daily_digest_${userId}`;
    if (activeAlerts.has(id)) return id; // Ya existe

    const task = cron.schedule('0 8 * * *', async () => {
        console.log('[Scheduler] 📅 Enviando resumen diario de calendario...');
        const raw = await runGogCommand('calendar events primary --today --max 10');
        if (raw && raw.trim().length > 0 && !raw.includes('Error')) {
            await sendToUser(userId, `☀️ *Buenos días Alfredo!*\n\nEsto tienes hoy en tu calendario:\n\`\`\`\n${raw.substring(0, 800)}\n\`\`\``);
        } else {
            await sendToUser(userId, `☀️ *Buenos días Alfredo!* No tienes eventos hoy en tu calendario. ¡Día libre! 🎉`);
        }
    }, { timezone: 'America/Mexico_City' });

    activeAlerts.set(id, { id, type: 'calendar_digest', userId, cronExpression: '0 8 * * *', task });
    console.log('[Scheduler] 📅 Resumen diario configurado para las 8 AM México');
    return id;
}

/**
 * Cancela una alerta por ID.
 */
export function cancelAlert(alertId: string): boolean {
    const alert = activeAlerts.get(alertId);
    if (!alert) return false;
    alert.task?.stop();
    activeAlerts.delete(alertId);
    console.log(`[Scheduler] ❌ Alerta ${alertId} cancelada`);
    return true;
}

/**
 * Lista todas las alertas activas de un usuario.
 */
export function listAlerts(userId: number): ScheduledAlert[] {
    return Array.from(activeAlerts.values()).filter(a => a.userId === userId);
}

export function initScheduler(userId: number): void {
    console.log('[Scheduler] 🚀 Iniciando sistema de tareas programadas...');
    scheduleDailyDigest(userId);
}
