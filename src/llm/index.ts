/**
 * Motor LLM con rotación automática de modelos y manejo inteligente de errores.
 * 
 * Modelos en orden de prioridad:
 *   1. Gemini 2.0 Flash   — gratis, 15 RPM / 1M TPD
 *   2. Groq Llama 3.3 70B — gratis, 100k TPD (cuota diaria)  
 *   3. Groq Llama 3.1 8B  — gratis, 6k TPM (cuota separada, historia corta)
 *   4. OpenRouter Gemma 2  — fallback final gratuito
 * 
 * Maneja automáticamente:
 *   - Rate limits 429 → cooldown temporal, saltar al siguiente
 *   - Request muy largo 413 → reintentar con historial recortado
 *   - Errores de red → pasar al siguiente sin cooldown
 */

import { config } from '../config.js';
import { getAvailableTools } from '../tools/index.js';
import { MessageRow } from '../db/memory.js';
import { callGemini } from './gemini.js';

// ── Serialización ──────────────────────────────────────────────────────

export function serializeMessagesForLLM(messages: MessageRow[]): any[] {
    return messages.map(msg => {
        const out: any = { role: msg.role };
        if (msg.content) out.content = msg.content;
        if (msg.name) out.name = msg.name;
        if (msg.tool_calls) {
            try { out.tool_calls = JSON.parse(msg.tool_calls); } catch {}
        }
        if (msg.tool_call_id) out.tool_call_id = msg.tool_call_id;
        return out;
    });
}

// ── Sistema de cooldowns ───────────────────────────────────────────────

const cooldowns = new Map<string, number>(); // modelId → timestamp de fin

function isInCooldown(modelId: string): boolean {
    const until = cooldowns.get(modelId) ?? 0;
    if (Date.now() > until) { cooldowns.delete(modelId); return false; }
    return true;
}

function setCooldown(modelId: string, ms: number, reason: string): void {
    cooldowns.set(modelId, Date.now() + ms);
    const display = ms >= 60000 ? `${Math.round(ms/60000)} min` : `${Math.round(ms/1000)} seg`;
    console.log(`[LLM] 🚫 ${modelId} en cooldown ${display} → ${reason}`);
}

function getRemainingCooldown(modelId: string): string {
    const until = cooldowns.get(modelId) ?? 0;
    const sec = Math.ceil((until - Date.now()) / 1000);
    return sec > 60 ? `${Math.ceil(sec/60)} min` : `${sec} seg`;
}

// ── Detección de tipo de error ─────────────────────────────────────────

function isRateLimit(msg: string): boolean {
    return msg.includes('429') || msg.includes('rate_limit') || msg.includes('rate limit') ||
           msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota') || msg.includes('TPD');
}

function isTooLarge(msg: string): boolean {
    return msg.includes('413') || msg.includes('too large') || msg.includes('Request too large');
}

// Extrae el tiempo de retry sugerido de la respuesta del API (en ms)
function extractRetryDelay(errorJson: string): number {
    const match = errorJson.match(/retry[^0-9]*(\d+(?:\.\d+)?)\s*s/i);
    if (match) return (parseFloat(match[1]) + 5) * 1000; // +5s de margen
    return 60_000; // default 1 min
}

// ── Clientes individuales ──────────────────────────────────────────────

async function tryGemini(systemPrompt: string, history: MessageRow[]): Promise<any> {
    const apiKey = (config as any).GEMINI_API_KEY;
    if (!apiKey) throw new Error('Sin GEMINI_API_KEY');
    return await callGemini(apiKey, systemPrompt, history);
}

async function tryGroqModel(model: string, systemPrompt: string, history: MessageRow[], maxMessages?: number, apiKey?: string): Promise<any> {
    const trimmedHistory = maxMessages ? history.slice(-maxMessages) : history;
    const key = apiKey || config.GROQ_API_KEY;
    const body = {
        model,
        messages: [
            { role: 'system', content: systemPrompt },
            ...serializeMessagesForLLM(trimmedHistory)
        ],
        tools: getAvailableTools(),
        tool_choice: 'auto'
    };

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    const text = await response.text();
    if (!response.ok) throw new Error(`Groq Error (${response.status}): ${text}`);

    const data = JSON.parse(text);
    if (!data.choices?.length) throw new Error(`Groq sin choices: ${text}`);
    return data.choices[0].message;
}

async function tryOpenRouter(systemPrompt: string, history: MessageRow[], model: string): Promise<any> {
    const body = {
        model,
        messages: [
            { role: 'system', content: systemPrompt },
            ...serializeMessagesForLLM(history.slice(-20)) // max 20 msgs para modelos pequeños
        ],
        tools: getAvailableTools(),
        tool_choice: 'auto'
    };

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${config.OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'http://localhost',
            'X-Title': 'Trybot'
        },
        body: JSON.stringify(body)
    });

    const text = await response.text();
    const data = JSON.parse(text);

    if (!response.ok || !data.choices?.length) {
        throw new Error(`OpenRouter Error (${response.status}): ${text}`);
    }
    return data.choices[0].message;
}

// ── Rotador principal ──────────────────────────────────────────────────

export async function callLLM(systemPrompt: string, messageHistory: MessageRow[]): Promise<any> {
    const errors: string[] = [];

    // ──────────────────────────────────────────────────
    // 1. Gemini 2.0 Flash
    // ──────────────────────────────────────────────────
    if (!isInCooldown('gemini')) {
        try {
            console.log('[LLM] 🤖 Gemini 2.0 Flash...');
            const result = await tryGemini(systemPrompt, messageHistory);
            console.log('[LLM] ✅ Gemini respondió');
            return result;
        } catch (err: any) {
            const msg = err.message || '';
            errors.push(`Gemini: ${msg.substring(0, 200)}`);
            console.error(`[LLM] ❌ Gemini: ${msg.substring(0, 150)}`);
            if (isRateLimit(msg)) {
                const delay = extractRetryDelay(msg);
                setCooldown('gemini', delay, '429 rate limit');
            }
        }
    } else {
        console.log(`[LLM] ⏭️  Gemini en cooldown (${getRemainingCooldown('gemini')} restantes)`);
        errors.push(`Gemini: en cooldown (${getRemainingCooldown('gemini')} restantes)`);
    }

    // ──────────────────────────────────────────────────
    // 2-5. Groq — Rota entre 4 cuentas (cada una 100k TPD = 400k total)
    // ──────────────────────────────────────────────────
    const groqKeys = [
        { key: config.GROQ_API_KEY,   id: 'groq-1', label: 'Groq Cuenta 1' },
        { key: config.GROQ_API_KEY_2, id: 'groq-2', label: 'Groq Cuenta 2' },
        { key: config.GROQ_API_KEY_3, id: 'groq-3', label: 'Groq Cuenta 3' },
        { key: config.GROQ_API_KEY_4, id: 'groq-4', label: 'Groq Cuenta 4' },
    ].filter(k => k.key); // Solo las que tienen clave configurada

    for (const { key, id, label } of groqKeys) {
        if (isInCooldown(id)) {
            console.log(`[LLM] ⏭️  ${label} en cooldown (${getRemainingCooldown(id)} restantes)`);
            errors.push(`${label}: en cooldown (${getRemainingCooldown(id)} restantes)`);
            continue;
        }

        // Intentamos primero con el modelo grande (70B), si falla por tamaño usamos el pequeño (8B)
        for (const { model, maxMsgs, suffix } of [
            { model: 'llama-3.3-70b-versatile', maxMsgs: undefined, suffix: '70B' },
            { model: 'llama-3.1-8b-instant',    maxMsgs: 6,         suffix: '8B'  },
        ]) {
            try {
                console.log(`[LLM] 🤖 ${label} / ${suffix}...`);
                const result = await tryGroqModel(model, systemPrompt, messageHistory, maxMsgs, key);
                console.log(`[LLM] ✅ ${label} / ${suffix} respondió`);
                return result;
            } catch (err: any) {
                const msg = err.message || '';
                console.error(`[LLM] ❌ ${label} / ${suffix}: ${msg.substring(0, 120)}`);

                if (isRateLimit(msg)) {
                    // Si es límite diario (TPD), el cooldown va por la cuenta entera
                    const delay = extractRetryDelay(msg);
                    const isDaily = msg.includes('TPD') || msg.includes('tokens per day');
                    setCooldown(id, Math.max(delay, isDaily ? 3_600_000 : 60_000), isDaily ? 'límite diario' : 'rate limit');
                    errors.push(`${label}: límite alcanzado`);
                    break; // Pasar a la siguiente cuenta
                }
                if (isTooLarge(msg)) {
                    if (suffix === '8B') {
                        // Ya intentamos el pequeño y también falla — skip esta cuenta
                        errors.push(`${label}: contexto demasiado grande`);
                        break;
                    }
                    // Intentar con el 8B (siguiente iteración del for interno)
                    continue;
                }
                errors.push(`${label} / ${suffix}: ${msg.substring(0, 150)}`);
            }
        }
    }


    // ──────────────────────────────────────────────────
    // 4. OpenRouter — Gemma 2 9B (válido y gratis)
    // ──────────────────────────────────────────────────
    if (!isInCooldown('openrouter')) {
        for (const orModel of ['google/gemma-2-9b-it:free', 'mistralai/mistral-7b-instruct:free', 'meta-llama/llama-3.2-3b-instruct:free']) {
            try {
                console.log(`[LLM] 🤖 OpenRouter (${orModel})...`);
                const result = await tryOpenRouter(systemPrompt, messageHistory, orModel);
                console.log(`[LLM] ✅ OpenRouter ${orModel} respondió`);
                return result;
            } catch (err: any) {
                const msg = err.message || '';
                console.error(`[LLM] ❌ OpenRouter ${orModel}: ${msg.substring(0, 100)}`);
                if (msg.includes('404')) continue; // modelo no disponible, probar el siguiente
                if (isRateLimit(msg)) {
                    setCooldown('openrouter', 300_000, 'rate limit');
                    errors.push(`OpenRouter ${orModel}: rate limit`);
                    break;
                }
                errors.push(`OpenRouter ${orModel}: ${msg.substring(0, 150)}`);
            }
        }
    } else {
        console.log(`[LLM] ⏭️  OpenRouter en cooldown (${getRemainingCooldown('openrouter')} restantes)`);
        errors.push(`OpenRouter: en cooldown (${getRemainingCooldown('openrouter')} restantes)`);
    }

    // ──────────────────────────────────────────────────
    // Todo falló
    // ──────────────────────────────────────────────────
    const geminiCd = isInCooldown('gemini') ? getRemainingCooldown('gemini') : null;
    const nextRetry = geminiCd ? `Intenta de nuevo en ~${geminiCd}` : 'Intenta de nuevo en unos minutos';
    throw new Error(`${nextRetry} (todos los modelos saturados temporalmente).`);
}
