
import fetch from 'node-fetch';
import { config } from '../setting.js';

export default async function handler(req, res) {
    // Segera balas 200 OK untuk Telegram jika request bukan POST
    if (req.method !== 'POST') return res.status(200).send('Bot is active');

    const update = req.body;
    if (!update || !update.message) return res.status(200).send('OK');

    const chatId = update.message.chat.id;
    const userId = update.message.from.id;
    const text = update.message.text || "";
    const isOwner = userId === config.owner_id;

    // --- HELPER DB (UPSTASH) - Dioptimasi ---
    const db = {
        async get(key) {
            const r = await fetch(`${config.uptash_url}/get/${key}`, {
                headers: { Authorization: `Bearer ${config.uptash_token}` }
            });
            const d = await r.json();
            return d.result;
        },
        async set(key, val) {
            await fetch(`${config.uptash_url}/set/${key}`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${config.uptash_token}` },
                body: JSON.stringify(val)
            });
        },
        async setEx(key, val, seconds) {
            // Format Upstash REST untuk SET dengan Expiry
            await fetch(`${config.uptash_url}/set/${key}/${val}/EX/${seconds}`, {
                headers: { Authorization: `Bearer ${config.uptash_token}` }
            });
        },
        async del(key) {
            await fetch(`${config.uptash_url}/del/${key}`, {
                headers: { Authorization: `Bearer ${config.uptash_token}` }
            });
        }
    };

    const sendMessage = async (msg) => {
        await fetch(`https://api.telegram.org/bot${config.bot_token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: "Markdown" })
        });
    };

    try {
        // Ambil status sesi
        const session = await db.get(`session:${userId}`);

        // 1. OWNER COMMANDS
        if (text === '/upkey' && isOwner) {
            await db.setEx(`session:${userId}`, 'waiting', 300);
            return await sendMessage("Silahkan kirim API Key OpenRouter baru:");
        }

        if (text === '/listkey' && isOwner) {
            const raw = await db.get('api_keys');
            const keys = raw ? JSON.parse(raw) : [];
            if (keys.length === 0) return await sendMessage("Kosong.");
            return await sendMessage(`📑 *List Key:*\n${keys.map((k, i) => `${i+1}. \`${k.substring(0,10)}...\``).join('\n')}`);
        }

        if (text === '/clearkey' && isOwner) {
            await db.del('api_keys');
            return await sendMessage("✅ Semua key dihapus.");
        }

        // 2. SESSION HANDLER
        if (session === 'waiting' && isOwner) {
            const raw = await db.get('api_keys');
            const keys = raw ? JSON.parse(raw) : [];
            keys.push(text.trim());
            await db.set('api_keys', JSON.stringify(keys));
            await db.del(`session:${userId}`);
            return await sendMessage("✅ Key berhasil ditambahkan!");
        }

        // 3. PUBLIC COMMANDS
        if (text === '/start') return await sendMessage("Bot Aktif! Kirim pesan untuk Chat AI.");
        if (text === '/ping') return await sendMessage("Pong! 🏓");

        // 4. AI LOGIC (Dengan Timeout 8 detik agar tidak 504)
        if (text && !text.startsWith('/')) {
            const raw = await db.get('api_keys');
            const keys = raw ? JSON.parse(raw) : [];
            if (keys.length === 0) return await sendMessage("⚠️ API Key belum diatur owner.");

            // Gunakan key terakhir yang baru dimasukkan (atau acak)
            const activeKey = keys[keys.length - 1]; 
            
            // AbortController untuk membatalkan request jika terlalu lama
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 8000); // 8 detik limit

            try {
                const aiRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                    method: "POST",
                    signal: controller.signal,
                    headers: {
                        "Authorization": `Bearer ${activeKey}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        "model": "nex-agi/deepseek-v3.1-nex-n1:free",
                        "messages": [{ "role": "user", "content": text }]
                    })
                });

                clearTimeout(timeout);
                const data = await aiRes.json();
                const reply = data.choices?.[0]?.message?.content || "AI tidak memberikan respon.";
                await sendMessage(reply);

            } catch (err) {
                if (err.name === 'AbortError') {
                    await sendMessage("⏳ AI terlalu lama merespon (Timeout). Coba lagi beberapa saat lagi.");
                } else {
                    await sendMessage("❌ Terjadi kesalahan pada koneksi AI.");
                }
            }
        }

        // Selalu kirim respon ke Vercel agar tidak dianggap macet
        return res.status(200).send('OK');

    } catch (e) {
        console.error(e);
        // Tetap kirim 200 agar Telegram berhenti mengirim ulang (retry)
        return res.status(200).send('OK');
    }
}
