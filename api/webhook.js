
import fetch from 'node-fetch';
import { config } from '../setting.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(200).send('Bot is running...');
    }

    const update = req.body;
    if (!update || !update.message) return res.status(200).send('OK');

    const chatId = update.message.chat.id;
    const userId = update.message.from.id;
    const text = update.message.text || "";
    const isOwner = userId === config.owner_id;

    // Fungsi Kirim Pesan
    const sendMessage = async (msg) => {
        await fetch(`https://api.telegram.org/bot${config.bot_token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: "Markdown" })
        });
    };

    // Fungsi Database Upstash (Simpan/Ambil API Key OpenRouter)
    const db = {
        setKey: async (key) => {
            await fetch(`${config.uptash_url}/set/openrouter_api_key/${key}`, {
                headers: { Authorization: `Bearer ${config.uptash_token}` }
            });
        },
        getKey: async () => {
            const response = await fetch(`${config.uptash_url}/get/openrouter_api_key`, {
                headers: { Authorization: `Bearer ${config.uptash_token}` }
            });
            const data = await response.json();
            return data.result;
        }
    };

    try {
        if (text === '/start') {
            await sendMessage("👋 Halo! Saya AI Bot Telegram.\n\nKetik apapun untuk ngobrol atau gunakan /info.");
        } 
        else if (text === '/ping') {
            await sendMessage("Pong! 🏓");
        } 
        else if (text === '/info') {
            const status = isOwner ? "Owner (Full Access)" : "User";
            await sendMessage(`👤 *USER INFO*\nID: \`${userId}\`\nStatus: ${status}`);
        } 
        else if (text.startsWith('/upkey')) {
            // Cek jika bukan owner
            if (!isOwner) {
                return await sendMessage("🚫 Maaf, fitur ini hanya dapat diakses oleh Owner.");
            }
            
            const newKey = text.split(' ')[1];
            if (!newKey) return await sendMessage("❌ Gunakan format: `/upkey API_KEY_OPENROUTER` ");
            
            await db.setKey(newKey);
            await sendMessage("✅ API Key berhasil diperbarui di database Upstash!");
        } 
        else {
            // Logic Chat AI
            const openRouterKey = await db.getKey();
            if (!openRouterKey) {
                return await sendMessage("⚠️ Maaf, AI belum bisa digunakan karena Owner belum mengatur API Key.");
            }

            const aiResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${openRouterKey}`,
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://vercel.com", // Opsional untuk OpenRouter
                    "X-Title": "Telegram Bot AI"
                },
                body: JSON.stringify({
                    "model": "nex-agi/deepseek-v3.1-nex-n1:free",
                    "messages": [{ "role": "user", "content": text }]
                })
            });

            const data = await aiResponse.json();
            const reply = data.choices?.[0]?.message?.content || "Maaf, AI sedang mengalami kendala. Coba lagi nanti.";
            await sendMessage(reply);
        }

        return res.status(200).send('OK');
    } catch (err) {
        console.error("Error Handler:", err);
        return res.status(200).send('OK');
    }
}
