import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue, Firestore } from 'firebase-admin/firestore';
import { config } from '../config.js';
import fs from 'fs';

// Inicializar Firebase usando la cuenta de servicio (service-account.json)
let db: Firestore;
try {
    const serviceAccount = JSON.parse(fs.readFileSync(config.GOOGLE_APPLICATION_CREDENTIALS || './service-account.json', 'utf8'));
    initializeApp({
        credential: cert(serviceAccount)
    });
    db = getFirestore();
    console.log('[Firebase] Conectado exitosamente a Firestore.');
} catch (error: any) {
    console.error('⚠️ [Firebase] No se pudo inicializar. Asegúrate de que formaste tu archivo: ', config.GOOGLE_APPLICATION_CREDENTIALS);
    console.error(error.message);
    process.exit(1);
}

export interface MessageRow {
    id?: string;
    user_id: number;
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    name?: string | null;
    tool_calls?: string | null; // JSON string
    tool_call_id?: string | null;
    timestamp?: any;
}

export const memory = {
    /**
     * Guarda un mensaje en Firestore
     */
    addMessage: async (msg: MessageRow) => {
        const docRef = db.collection('users').doc(msg.user_id.toString()).collection('messages').doc();
        await docRef.set({
            user_id: msg.user_id,
            role: msg.role,
            content: msg.content ?? null,
            name: msg.name ?? null,
            tool_calls: msg.tool_calls ?? null,
            tool_call_id: msg.tool_call_id ?? null,
            timestamp: FieldValue.serverTimestamp()
        });
        return docRef.id;
    },

    /**
     * Obtiene el historial de mensajes de un usuario
     */
    getHistory: async (userId: number, limit: number = 50): Promise<MessageRow[]> => {
        const snapshot = await db.collection('users').doc(userId.toString()).collection('messages')
            .orderBy('timestamp', 'asc')
            .limitToLast(limit)
            .get();
            
        return snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data
            } as MessageRow;
        });
    },

    /**
     * Borra el historial de un usuario
     */
    clearHistory: async (userId: number) => {
        const messagesRef = db.collection('users').doc(userId.toString()).collection('messages');
        const snapshot = await messagesRef.get();
        
        // Firestore no soporta borrado masivo por query de 1 paso. Tenemos que borrar doc por doc o usar bulkWriter
        const batch = db.batch();
        snapshot.docs.forEach((doc) => {
            batch.delete(doc.ref);
        });
        await batch.commit();
        return true;
    }
};
