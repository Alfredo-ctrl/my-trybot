/**
 * Cliente para Google Gemini Flash (gemini-2.0-flash)
 * API gratuita: 15 RPM, 1M tokens/día, sin tarjeta de crédito.
 * Obtén tu clave gratis en: https://aistudio.google.com/apikey
 */

import { MessageRow } from '../db/memory.js';
import { getAvailableTools } from '../tools/index.js';

// Convierte herramientas de formato OpenAI a formato Gemini
function toolsToGeminiFormat(tools: any[]): any[] {
    const functionDeclarations = tools.map(tool => ({
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters
    }));
    return [{ function_declarations: functionDeclarations }];
}

// Convierte historial de mensajes al formato de Gemini
function historyToGeminiFormat(systemPrompt: string, messages: MessageRow[]): { systemInstruction: any, contents: any[] } {
    const contents: any[] = [];
    
    for (const msg of messages) {
        if (msg.role === 'user') {
            contents.push({ role: 'user', parts: [{ text: msg.content || '' }] });
        } else if (msg.role === 'assistant') {
            const parts: any[] = [];
            if (msg.content) parts.push({ text: msg.content });
            if (msg.tool_calls) {
                try {
                    const toolCalls = JSON.parse(msg.tool_calls);
                    for (const tc of toolCalls) {
                        let args = {};
                        try { args = JSON.parse(tc.function.arguments); } catch {}
                        parts.push({ functionCall: { name: tc.function.name, args } });
                    }
                } catch {}
            }
            if (parts.length > 0) contents.push({ role: 'model', parts });
        } else if (msg.role === 'tool') {
            contents.push({
                role: 'user',
                parts: [{
                    functionResponse: {
                        name: msg.name || 'tool',
                        response: { output: msg.content || '' }
                    }
                }]
            });
        }
    }

    return {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents
    };
}

// Convierte respuesta de Gemini al formato OpenAI compatible con nuestro loop
function geminiResponseToOpenAI(candidate: any): any {
    const parts = candidate.content?.parts || [];
    let textContent = '';
    const toolCalls: any[] = [];

    for (const part of parts) {
        if (part.text) {
            textContent += part.text;
        } else if (part.functionCall) {
            toolCalls.push({
                id: `call_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                type: 'function',
                function: {
                    name: part.functionCall.name,
                    arguments: JSON.stringify(part.functionCall.args || {})
                }
            });
        }
    }

    return {
        content: textContent || null,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined
    };
}

export async function callGemini(apiKey: string, systemPrompt: string, messageHistory: MessageRow[]): Promise<any> {
    const model = 'gemini-2.0-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const { systemInstruction, contents } = historyToGeminiFormat(systemPrompt, messageHistory);
    
    // Necesitamos al menos un mensaje
    if (contents.length === 0) {
        throw new Error('No hay historial de mensajes para enviar a Gemini');
    }

    const body = {
        systemInstruction,
        contents,
        tools: toolsToGeminiFormat(getAvailableTools()),
        generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 2048
        }
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    const data = await response.json() as any;

    if (!response.ok) {
        throw new Error(`Gemini API Error (${response.status}): ${JSON.stringify(data)}`);
    }

    const candidate = data.candidates?.[0];
    if (!candidate) {
        throw new Error(`Gemini no devolvió candidatos: ${JSON.stringify(data)}`);
    }

    return geminiResponseToOpenAI(candidate);
}
