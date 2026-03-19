/**
 * Tool del agente para gestionar tareas programadas y notificaciones.
 * El LLM puede llamar a este tool para:
 * - Programar recordatorios a una hora
 * - Monitorear correos de una persona específica
 * - Ver/cancelar alertas activas
 */

import { ToolImplementation } from './index.js';
import { scheduleReminder, watchEmail, cancelAlert, listAlerts } from '../tasks/scheduler.js';

export const schedulerTool: ToolImplementation = {
    definition: {
        type: "function",
        function: {
            name: "manage_scheduled_task",
            description: `Gestiona tareas programadas y notificaciones automáticas para Alfredo.
Úsalo cuando el usuario pida:
- "Avísame cuando llegue un correo de X" → type: watch_email
- "Mándame un mensaje a las X" → type: add_reminder  
- "Recuérdame todos los martes que..." → type: add_reminder con days
- "Qué alertas tengo activas" → type: list
- "Cancela la alerta X" → type: cancel`,
            parameters: {
                type: "object",
                properties: {
                    type: {
                        type: "string",
                        enum: ["add_reminder", "watch_email", "list", "cancel"],
                        description: "Tipo de operación"
                    },
                    message: {
                        type: "string",
                        description: "Texto del recordatorio (para add_reminder)"
                    },
                    hour: {
                        type: "number",
                        description: "Hora en formato 24h (0-23) en zona horaria de México (para add_reminder)"
                    },
                    minute: {
                        type: "number",
                        description: "Minuto (0-59). Por defecto 0."
                    },
                    days: {
                        type: "array",
                        items: { type: "number" },
                        description: "Días de la semana: 1=Lunes, 2=Martes, ..., 7=Domingo. Omitir para todos los días."
                    },
                    email_query: {
                        type: "string",
                        description: "Query de Gmail para monitorear (para watch_email). Ej: 'from:maestra@escuela.edu'"
                    },
                    email_label: {
                        type: "string",
                        description: "Nombre descriptivo del monitor de correo (para watch_email). Ej: 'correo de la maestra Eli'"
                    },
                    check_interval_minutes: {
                        type: "number",
                        description: "Cada cuántos minutos revisar el correo (para watch_email). Mínimo 5, por defecto 10."
                    },
                    alert_id: {
                        type: "string",
                        description: "ID de la alerta a cancelar (para cancel)"
                    }
                },
                required: ["type"]
            }
        }
    },
    execute: async (args: any) => {
        // El userId es el del usuario principal (el primero de la whitelist)
        const { config } = await import('../config.js');
        const userId = config.TELEGRAM_ALLOWED_USER_IDS[0];

        switch (args.type) {
            case 'add_reminder': {
                if (args.message === undefined || args.hour === undefined) {
                    return 'Error: necesito el mensaje y la hora para crear un recordatorio.';
                }
                const id = scheduleReminder(userId, args.message, args.hour, args.minute || 0, args.days);
                const dayNames = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
                const daysText = args.days ? args.days.map((d: number) => dayNames[d]).join(', ') : 'todos los días';
                return `✅ Recordatorio creado (ID: ${id})\n📌 "${args.message}"\n🕐 A las ${args.hour}:${String(args.minute || 0).padStart(2, '0')} (${daysText})`;
            }
            
            case 'watch_email': {
                if (!args.email_query || !args.email_label) {
                    return 'Error: necesito el query de Gmail y una etiqueta descriptiva.';
                }
                const id = watchEmail(userId, args.email_query, args.email_label, args.check_interval_minutes || 10);
                return `✅ Monitor de correo activado (ID: ${id})\n👁️ Vigilando: "${args.email_label}"\n📧 Query: ${args.email_query}\n⏱️ Revisando cada ${args.check_interval_minutes || 10} minutos`;
            }
            
            case 'list': {
                const alerts = listAlerts(userId);
                if (alerts.length === 0) return 'No tienes alertas activas en este momento.';
                const lines = alerts.map(a => {
                    if (a.type === 'reminder') return `🔔 [${a.id}] Recordatorio: "${a.message}" (cron: ${a.cronExpression})`;
                    if (a.type === 'email_watch') return `📬 [${a.id}] Monitor: ${a.emailQuery}`;
                    if (a.type === 'calendar_digest') return `📅 [${a.id}] Resumen diario a las 8 AM`;
                    return `[${a.id}] ${a.type}`;
                });
                return `Tus alertas activas:\n${lines.join('\n')}`;
            }

            case 'cancel': {
                if (!args.alert_id) return 'Error: necesito el ID de la alerta a cancelar.';
                const ok = cancelAlert(args.alert_id);
                return ok ? `✅ Alerta ${args.alert_id} cancelada.` : `❌ No encontré ninguna alerta con ID ${args.alert_id}.`;
            }

            default:
                return 'Tipo de operación no reconocido.';
        }
    }
};
