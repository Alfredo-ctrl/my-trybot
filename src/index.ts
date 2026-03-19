import { launchBot } from './bot/index.js';
import { config } from './config.js';
import { initScheduler } from './tasks/scheduler.js';
import * as http from 'http';

// Manejador de errores no controlados
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Punto de entrada principal de la aplicación
async function main() {
    try {
        console.log("-----------------------------------------");
        console.log("🤖 Iniciando Trybot Personal Agent...");
        console.log("-----------------------------------------");
        
        // Iniciamos un servidor web dummy para pasar los "health checks" de la nube gratuita (Render, Koyeb)
        const port = process.env.PORT || 3000;
        http.createServer((req, res) => {
            res.writeHead(200, {'Content-Type': 'text/plain'});
            res.end('Trybot is alive!\n');
        }).listen(port, () => {
            console.log(`🌐 Mini-servidor web escuchando en el puerto ${port}`);
        });

        // Iniciamos el sistema de notificaciones programadas
        const primaryUserId = config.TELEGRAM_ALLOWED_USER_IDS[0];
        if (primaryUserId) {
            initScheduler(primaryUserId);
        }
        
        await launchBot();
    } catch (error) {
        console.error("Error crítico al iniciar:", error);
        process.exit(1);
    }
}

main();
