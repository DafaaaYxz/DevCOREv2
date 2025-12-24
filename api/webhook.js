
import fetch from 'node-fetch';
import { config } from '../setting.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(200).send('Bot is active');

    const update = req.body;
    if (!update || !update.message) return res.status(200).send('OK');

    const chatId = update.message.chat.id;
    const userId = update.message.from.id;
    const text = update.message.text || "";
    const isOwner = userId === config.owner_id;

    // --- HELPER DATABASE (UPSTASH) ---
    const db = {
        // Ambil daftar semua key (Array)
        getKeys: async () => {
            const res = await fetch(`${config.uptash_url}/get/api_keys`, {
                headers: { Authorization: `Bearer ${config.uptash_token}` }
            });
            const data = await res.json();
            return data.result ? JSON.parse(data.result) : [];
        },
        // Simpan daftar key
        setKeys: async (keysArray) => {
            await fetch(`${config.uptash_url}/set/api_keys`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${config.uptash_token}` },
                body: JSON.stringify(keysArray)
            });
        },
        // Sesi untuk alur /upkey
        setSession: async (uid, step) => {
            await fetch(`${config.uptash_url}/set/session:${uid}/${step}/EX/300`, { // Expire 5 menit
                headers: { Authorization: `Bearer ${config.uptash_token}` }
            });
        },
        getSession: async (uid) => {
            const res = await fetch(`${config.uptash_url}/get/session:${uid}`, {
                headers: { Authorization: `Bearer ${config.uptash_token}` }
            });
            const data = await res.json();
            return data.result;
        },
        clearSession: async (uid) => {
            await fetch(`${config.uptash_url}/del/session:${uid}`, {
                headers: { Authorization: `Bearer ${config.uptash_token}` }
            });
        }
    };

    // --- HELPER TELEGRAM ---
    const sendMessage = async (msg) => {
        await fetch(`https://api.telegram.org/bot${config.bot_token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: "Markdown" })
        });
    };

    try {
        const session = await db.getSession(userId);

        // --- OWNER COMMANDS ---
        if (text === '/upkey' && isOwner) {
            await db.setSession(userId, 'waiting_for_key');
            return await sendMessage("Silahkan kirim API Key OpenRouter yang baru:");
        }

        if (text === '/listkey' && isOwner) {
            const keys = await db.getKeys();
            if (keys.length === 0) return await sendMessage("Belum ada API Key yang tersimpan.");
            let list = "📑 *LIST API KEYS*\n\n";
            keys.forEach((k, i) => {
                list += `${i + 1}. \`${k.substring(0, 12)}...\`\n`;
            });
            return await sendMessage(list);
        }
        
        if (text === '/clearkey' && isOwner) {
            await db.setKeys([]);
            return await sendMessage("✅ Semua API Key berhasil dihapus.");
        }

        // --- SESSION HANDLER (Untuk /upkey) ---
        if (session === 'waiting_for_key' && isOwner) {
            const currentKeys = await db.getKeys();
            currentKeys.push(text.trim());
            await db.setKeys(currentKeys);
            await db.clearSession(userId);
            return await sendMessage(`✅ Key berhasil ditambahkan!\nTotal key saat ini: ${currentKeys.length}`);
        }

        // --- PUBLIC COMMANDS ---
        if (text === '/start') {
            return await sendMessage("🤖 Bot AI Aktif! Kirim pesan apapun untuk mengobrol.");
        }
        if (text === '/ping') {
            return await sendMessage("Pong! 🏓");
        }
        if (text === '/info') {
            return await sendMessage(`👤 *USER INFO*\nID: \`${userId}\`\nStatus: ${isOwner ? "Owner" : "User"}`);
        }

        // --- AI LOGIC (ROTATION SYSTEM) ---
        if (text && !text.startsWith('/')) {
            const keys = await db.getKeys();
            if (keys.length === 0) return await sendMessage("⚠️ Maaf, sistem AI sedang offline (No API Keys).");

            let aiSuccess = false;
            // Looping untuk mencoba setiap key jika ada yang error/mati
            for (let i = 0; i < keys.length; i++) {
                try {
                    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                        method: "POST",
                        headers: {
                            "Authorization": `Bearer ${keys[i]}`,
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                            "model": "nex-agi/deepseek-v3.1-nex-n1:free",
                            "messages": [{ "role": "user", "content": text }]
                        })
                    });

                    const data = await response.json();
                    
                    if (response.ok && data.choices) {
                        await sendMessage(data.choices[0].message.content);
                        aiSuccess = true;
                        break; // Berhenti looping jika sukses
                    } else {
                        console.error(`Key index ${i} failed, trying next...`);
                    }
                } catch (e) {
                    continue; // Coba key berikutnya
                }
            }

            if (!aiSuccess) {
                await sendMessage("❌ Semua API Key sedang bermasalah atau limit. Silahkan hubungi owner.");
            }
        }

        return res.status(200).send('OK');
    } catch (err) {
        return res.status(200).send('OK');
    }
}
