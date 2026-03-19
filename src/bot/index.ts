import { Bot } from 'grammy';
import { config } from '../config.js';
import { runAgentLoop } from '../agent/loop.js';
import { memory } from '../db/memory.js';

export const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

// Middleware para verificar la Whitelist
bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (userId && config.TELEGRAM_ALLOWED_USER_IDS.includes(userId)) {
        await next();
    } else {
        console.log(`Intento de acceso denegado del usuario: ${userId}`);
    }
});

// ── Comandos básicos ───────────────────────────────────────────────────

bot.command('start', async (ctx) => {
    await ctx.reply(
        `🤖 *¡Hola Alfredo!* Soy Trybot, tu agente personal de IA.\n\n` +
        `Puedo:\n` +
        `📧 Leer, buscar, enviar y responder correos de Gmail\n` +
        `📅 Ver y crear eventos en tu Google Calendar\n` +
        `🔔 Mandarte recordatorios y avisos proactivos\n` +
        `📁 Buscar archivos en Drive\n` +
        `👥 Gestionar contactos\n\n` +
        `Comandos útiles:\n` +
        `/clear — Borrar mi memoria de la conversación\n` +
        `/alerts — Ver tus alertas activas\n\n` +
        `_Háblame como si fuera tu asistente. Te entiendo en voz o texto._`,
        { parse_mode: 'Markdown' }
    );
});

bot.command('clear', async (ctx) => {
    if (ctx.from) {
        await memory.clearHistory(ctx.from.id);
        await ctx.reply("🧠 Listo, olvidé todo lo que hablamos. ¡Empecemos de cero!");
    }
});

bot.command('alerts', async (ctx) => {
    if (!ctx.from) return;
    const { listAlerts } = await import('../tasks/scheduler.js');
    const alerts = listAlerts(ctx.from.id);
    if (alerts.length === 0) {
        await ctx.reply("No tienes alertas activas. Puedes pedirme que te avise de correos o programe recordatorios.");
        return;
    }
    const lines = alerts.map(a => {
        if (a.type === 'reminder') return `🔔 \`${a.id}\` — ${a.message}`;
        if (a.type === 'email_watch') return `📬 \`${a.id}\` — Vigilando: ${a.emailQuery}`;
        if (a.type === 'calendar_digest') return `📅 \`${a.id}\` — Resumen diario 8 AM`;
        return `\`${a.id}\` — ${a.type}`;
    });
    await ctx.reply(`*Tus alertas activas:*\n${lines.join('\n')}`, { parse_mode: 'Markdown' });
});

// ── Manejador principal de texto ───────────────────────────────────────

bot.on('message:text', async (ctx) => {
    const userId = ctx.from.id;
    const userMessage = ctx.message.text;

    // Enviar indicador de "escribiendo..."
    await ctx.replyWithChatAction('typing');

    try {
        const response = await runAgentLoop(userId, userMessage, ctx);
        if (response) await ctx.reply(response, { parse_mode: 'Markdown' }).catch(() => ctx.reply(response));
    } catch (error: any) {
        console.error("Error global del bot:", error);
        await ctx.reply(`❌ Hubo un problema interno: ${error.message}`);
    }
});

// ── Manejador de audios y notas de voz ────────────────────────────────

import { transcribeAudio } from '../llm/transcribe.js';

bot.on(['message:voice', 'message:audio'], async (ctx) => {
    const userId = ctx.from.id;
    await ctx.replyWithChatAction('typing');

    try {
        const file = await ctx.getFile();
        if (!file.file_path) throw new Error('Telegram no devolvió la ruta del archivo.');

        const url = `https://api.telegram.org/file/bot${config.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
        const audioResponse = await fetch(url);
        if (!audioResponse.ok) throw new Error(`Error descargando audio: ${audioResponse.statusText}`);

        const arrayBuffer = await audioResponse.arrayBuffer();
        const transcribedText = await transcribeAudio(arrayBuffer);

        // Confirmar lo que escuchamos
        await ctx.reply(`🎤 _He escuchado:_ "${transcribedText}"`, { parse_mode: "Markdown" });

        await ctx.replyWithChatAction('typing');
        const response = await runAgentLoop(userId, transcribedText, ctx);
        if (response) await ctx.reply(response, { parse_mode: 'Markdown' }).catch(() => ctx.reply(response));

    } catch (error: any) {
        console.error("Error de audio:", error);
        await ctx.reply(`❌ Problema procesando tu audio: ${error.message}`);
    }
});

// ── Launch ─────────────────────────────────────────────────────────────

export async function launchBot() {
    console.log("Iniciando bot de Telegram...");
    bot.catch((err) => {
        const ctx = err.ctx;
        console.error(`Error while handling update ${ctx.update.update_id}:`, err.error);
    });
    
    await bot.start({
        onStart: (botInfo) => {
            console.log(`[Trybot] Conectado exitosamente como @${botInfo.username}`);
        }
    });
}
