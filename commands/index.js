const handleAbsen = require('./absen');
const handleExport = require('./export');
const greetings = require('../data/greetings');
const greetingReplies = require('../data/greetingReplies');
const sendingIntro = {};
const { sendTyping } = require('../utils/sendTyping');

// Simulasi mengetik
const typeAndDelay = async (chat, ms = 800, random = 400) => {
    await chat.sendStateTyping();
    await new Promise(r => setTimeout(r, ms + Math.random() * random));
};

module.exports = {
    message: async (chat, wa_number, nama_wa, db, pesan) => {
        const lowerMsg = pesan.toLowerCase().trim();

        const query = (sql, params) =>
            new Promise((res, rej) =>
                db.query(sql, params, (err, result) =>
                    err ? rej(err) : res(result)
                )
            );

        try {
            // =========================
            // AMBIL / BUAT USER
            // =========================
            let users = await query(
                "SELECT * FROM users WHERE wa_number=?",
                [wa_number]
            );
            let user = users[0];

            if (!user) {
                await query(
                    "INSERT INTO users (wa_number, nama_wa, intro) VALUES (?, ?, 0)",
                    [wa_number, nama_wa]
                );
                users = await query(
                    "SELECT * FROM users WHERE wa_number=?",
                    [wa_number]
                );
                user = users[0];
            }

            // =========================
            // INTRO (SEKALI)
            // =========================
            if (user.intro === 0 && !sendingIntro[wa_number]) {
                sendingIntro[wa_number] = true;
                await typeAndDelay(chat);
                await chat.sendMessage(
                    `Halo *${nama_wa}*\nSaya *Arta Presence*, bot absensi otomatis.\n\n` +
                    `Ketik */absen* untuk absensi\n` +
                    `Ketik */export* untuk laporan PDF`
                );
                await query(
                    "UPDATE users SET intro=1 WHERE id=?",
                    [user.id]
                );
                sendingIntro[wa_number] = false;
                return;
            }

            // =========================
            // HELP
            // =========================
            if (lowerMsg === '/help') {
                return require('./help')(chat, user.nama_wa);
            }

            // =========================
            // GREETING
            // =========================
            const replyGreeting = greetings[lowerMsg];
            if (replyGreeting) {
                const randomReply =
                    greetingReplies[Math.floor(Math.random() * greetingReplies.length)];
                return sendTyping(
                    chat,
                    `${replyGreeting} *${nama_wa}*, ${randomReply}`,
                    1000
                );
            }

            // =========================
            // EXPORT (HARUS DI ATAS!)
            // =========================

            // ⬅️ JIKA MASIH DALAM PROSES EXPORT
            if (user.step_input) {
                return handleExport(chat, user, pesan, db);
            }

            // ⬅️ COMMAND /export
            if (lowerMsg.startsWith('/export')) {
                const parts = pesan.split(' ').slice(1);
                const paramBulan = parts.length ? parts[0] : null;
                return handleExport(chat, user, pesan, db, paramBulan);
            }

            // =========================
            // ABSEN
            // =========================
            if (user.step_absen || lowerMsg === '/absen') {
                return handleAbsen(chat, user, lowerMsg, pesan, query);
            }

            // =========================
            // DEFAULT
            // =========================
            await sendTyping(
                chat,
                `Hmm… ${nama_wa}, aku belum paham pesan kamu.`,
                1000
            );
            await sendTyping(
                chat,
                "Coba ketik */help* untuk melihat perintah.",
                1000
            );

        } catch (err) {
            console.error('Error handling message:', err);
            return chat.sendMessage('Terjadi kesalahan sistem.');
        }
    }
};
