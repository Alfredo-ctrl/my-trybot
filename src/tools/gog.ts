import { exec } from 'child_process';
import { promisify } from 'util';
import { ToolImplementation } from './index.js';

const execAsync = promisify(exec);

// ---------------------------------------------------------------
// MAPA DE AUTO-CORRECCIONES
// El LLM a veces inventa comandos parecidos pero incorrectos.
// Aquí los interceptamos y reescribimos al formato real de gog.
// ---------------------------------------------------------------
function autoCorrectCommand(raw: string): string {
    let cmd = raw.trim();

    // Quitar prefijo "gog " si lo incluyó
    if (cmd.startsWith('gog ')) cmd = cmd.substring(4);

    // Gmail: leer un correo por ID (el LLM suele poner "get" o "view" en lugar de "read")
    cmd = cmd.replace(/^gmail messages get /i,    'gmail read ');
    cmd = cmd.replace(/^gmail message get /i,     'gmail read ');
    cmd = cmd.replace(/^gmail get /i,             'gmail read ');
    cmd = cmd.replace(/^gmail messages view /i,   'gmail read ');
    cmd = cmd.replace(/^gmail view /i,            'gmail read ');
    cmd = cmd.replace(/^gmail open /i,            'gmail read ');

    // Gmail: buscar correos (el LLM a veces pone "list" en lugar de "search")
    cmd = cmd.replace(/^gmail messages list /i,   'gmail messages search ');
    cmd = cmd.replace(/^gmail list /i,            'gmail search ');

    // Calendar: el LLM a veces pone "list" en lugar de "events"
    cmd = cmd.replace(/^calendar list /i,         'calendar events primary ');
    cmd = cmd.replace(/^calendar get /i,          'calendar events primary ');

    // Calendar: crear evento — el LLM a veces use "add" o "new" en lugar de "create"
    cmd = cmd.replace(/^calendar add /i,          'calendar create primary ');
    cmd = cmd.replace(/^calendar new /i,          'calendar create primary ');

    // Calendar: auto-añadir --all-day si se detecta fecha sin hora
    if (cmd.includes('calendar create') && !cmd.includes('--all-day') && !cmd.includes('T')) {
        cmd += ' --all-day';
    }

    // Quitar flags inventados que nunca existen en gog
    cmd = cmd.replace(/\s*--format\s+\S+/gi, '');
    cmd = cmd.replace(/\s*--display\s+\S+/gi, '');
    cmd = cmd.replace(/\s*--pretty\b/gi, '');
    cmd = cmd.replace(/\s*--output\s+\S+/gi, '');
    cmd = cmd.replace(/\s*--timezone\s+\S+/gi, '');

    return cmd;
}

export const gogTool: ToolImplementation = {
    definition: {
        type: "function",
        function: {
            name: "execute_gog_command",
            description: `Ejecuta comandos en Google Workspace de Alfredo (Gmail, Calendar, Drive, Contacts, Sheets, Docs) usando la CLI 'gog'.

COMANDOS VÁLIDOS (úsalos EXACTAMENTE así, sin inventar flags):

📧 GMAIL:
- Buscar correos:       gmail search "query" --max 5 --json
- Leer cuerpo completo: gmail read <ID_DEL_CORREO>
- Enviar correo nuevo:  gmail send --to email@ejemplo.com --subject "Asunto" --body "Mensaje"
- Responder correo:     gmail send --to email@ejemplo.com --subject "Re: Asunto" --body "Mensaje" --reply-to-message-id <ID>

📅 CALENDAR:
- Ver próximos eventos:      calendar events primary --max 5
- Ver eventos de hoy:        calendar events primary --today
- Ver eventos de esta semana: calendar events primary --week
- Buscar evento específico:  calendar events primary --query "título del evento" --max 5
- Crear evento todo el día:  calendar create primary --summary "Título" --from 2026-03-12 --to 2026-03-12 --all-day
- Crear evento con hora:     calendar create primary --summary "Título" --from 2026-03-12T10:00:00 --to 2026-03-12T11:00:00

📁 DRIVE:
- Buscar archivos:  drive search "query" --max 10

👥 CONTACTS:
- Listar contactos:  contacts list --max 20

📊 SHEETS:
- Leer datos:    sheets get <sheetId> "Hoja!A1:D10" --json
- Escribir datos: sheets update <sheetId> "Hoja!A1" --values-json '[["valor"]]' --input USER_ENTERED

📄 DOCS:
- Leer documento: docs cat <docId>

REGLAS ABSOLUTAS:
- NUNCA uses --format, --display, --pretty, --timezone (no existen)
- Para leer el contenido de un correo: primero busca con 'gmail search' para obtener el ID, luego usa 'gmail read <ID>'
- El ID de calendario principal siempre es 'primary'
- Siempre usa 'primary' como calendarId, nunca busques o preguntes el ID del calendario`,
            parameters: {
                type: "object",
                properties: {
                    command: {
                        type: "string",
                        description: "El subcomando a ejecutar (sin incluir la palabra 'gog' al inicio). Ejemplo: 'gmail search \"in:inbox\" --max 5 --json'"
                    }
                },
                required: ["command"]
            }
        }
    },
    execute: async (args: { command: string }) => {
        try {
            const correctedCommand = autoCorrectCommand(args.command);
            const isWindows = process.platform === 'win32';
            
            let fullCmd: string;
            
            if (isWindows) {
                // Comando específico para tu PC Windows
                fullCmd = `powershell -Command "$env:ZONEINFO='C:\\trybot\\zoneinfo.zip'; $env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User'); gog ${correctedCommand}"`;
            } else {
                // Comando para la nube (Linux)
                // En Linux no necesitamos ZONEINFO externo, ya viene en el sistema
                fullCmd = `gog ${correctedCommand}`;
            }
            
            console.log(`[Herramienta gog] Ejecutando: ${fullCmd}`);
            
            const { stdout, stderr } = await execAsync(fullCmd, { 
                maxBuffer: 5 * 1024 * 1024,
                env: { ...process.env } 
            });
            
            let result = '';
            if (stdout) result += stdout;
            if (stderr && !stdout) result += `\nStderr:\n${stderr}`;
            
            return result.trim() || 'El comando se ejecutó pero no devolvió ninguna salida.';
            
        } catch (error: any) {
            // Si hay stdout aunque haya stderr, usamos el stdout (gog lo hace a veces)
            if (error.stdout && error.stdout.trim().length > 0) {
                return error.stdout.trim();
            }
            
            const errorMsg = error.stderr || error.message || 'Error desconocido';
            console.error(`[Herramienta gog] Error: ${errorMsg}`);
            return `Error al ejecutar el comando: ${errorMsg}`;
        }
    }
};
