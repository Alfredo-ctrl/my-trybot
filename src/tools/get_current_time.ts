import { ToolImplementation } from './index.js';

export const getCurrentTimeTool: ToolImplementation = {
    definition: {
        type: "function",
        function: {
            name: "get_current_time",
            description: "Gets the current date and time in ISO format. Use this whenever you need to know what time/date it is right now.",
            parameters: {
                type: "object",
                properties: {
                    timezone: {
                        type: "string",
                        description: "Optional timezone (e.g., 'America/Mexico_City', 'UTC'). Defaults to system local time."
                    }
                }
            }
        }
    },
    execute: (args: { timezone?: string }) => {
        try {
            if (args.timezone) {
                return new Date().toLocaleString("en-US", { timeZone: args.timezone });
            }
            return new Date().toISOString();
        } catch (e: any) {
             return new Date().toISOString(); // Fallback si la zona horaria es inválida
        }
    }
};
