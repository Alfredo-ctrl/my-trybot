import { config } from '../config.js';

export async function transcribeAudio(audioBuffer: ArrayBuffer, mimeType: string = 'audio/ogg'): Promise<string> {
    const formData = new FormData();
    const blob = new Blob([audioBuffer], { type: mimeType });
    
    // Groq requiere un nombre de archivo para identificar el formato
    formData.append('file', blob, 'audio.ogg');
    formData.append('model', 'whisper-large-v3');
    // Forzamos el idioma a español para mejor reconocimiento de lo que hables
    formData.append('language', 'es');

    const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${config.GROQ_API_KEY}`
        },
        body: formData as any
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Groq Transcription Error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    return data.text.trim();
}
