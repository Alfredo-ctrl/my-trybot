export interface ToolDefinition {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: {
            type: "object";
            properties: Record<string, any>;
            required?: string[];
        };
    };
}

export interface ToolImplementation {
    definition: ToolDefinition;
    execute: (args: any) => Promise<string> | string;
}

import { getCurrentTimeTool } from './get_current_time.js';
import { gogTool } from './gog.js';
import { schedulerTool } from './scheduler.js';

const tools: Record<string, ToolImplementation> = {
    [getCurrentTimeTool.definition.function.name]: getCurrentTimeTool,
    [gogTool.definition.function.name]: gogTool,
    [schedulerTool.definition.function.name]: schedulerTool
};

export function getAvailableTools(): ToolDefinition[] {
    return Object.values(tools).map(t => t.definition);
}

export async function executeTool(name: string, argsStr: string): Promise<string> {
    const tool = tools[name];
    if (!tool) {
        return `Error: Tool '${name}' not found.`;
    }
    try {
        const args = JSON.parse(argsStr);
        return await tool.execute(args);
    } catch (e: any) {
        return `Error executing tool '${name}': ${e.message}`;
    }
}
