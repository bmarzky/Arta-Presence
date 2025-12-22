// commands/index.js
const handleAbsen = require('./absen');
const handleExport = require('./export');
const greetings = require('../data/greetings');
const greetingReplies = require('../data/greetingReplies');
const sendingIntro = {}; // flag intro agar tidak double
const { sendTyping } = require('../utils/sendTyping'); // sesuaikan path jika perlu

// Fungsi simulasi mengetik dengan delay acak
const typeAndDelay = async (chat, ms = 800, random = 400) => {
    await chat.sendStateTyping();
    await new Promise(r => setTimeout(r, ms + Math.random() * random));
};

module.exports = {
    message: async (chat, wa_number, nama_wa, db, pesan) => {
        const lowerMsg = pesan.toLowerCase().trim();

        // Fungsi query DB promisified
        const query = (sql, params) =>
            new Promise((res, rej) =>
                db.query(sql, params, (err, result) => err ? rej(err) : res(result))
            );

        try {
            // Ambil user dari DB
            let users = await query("SELECT * FROM users WHERE wa_number=?", [wa_number]);
            let user = users[0];

            // Jika user baru → insert
            if (!user) {
                await query("INSERT INTO users (wa_number, nama_wa, intro) VALUES (?, ?, 0)", [wa_number, nama_wa]);
                users = await query("SELECT * FROM users WHERE wa_number=?", [wa_number]);
                user = users[0];
            }

            // Intro (hanya sekali)
            if (user.intro === 0 && !sendingIntro[wa_number]) {
                sendingIntro[wa_number] = true;
                await typeAndDelay(chat);
                await chat.sendMessage(
                    `Halo *${nama_wa}*\nSaya *Arta Presence*, bot absensi otomatis.\n\n` +
                    `Ketik */absen* untuk mulai absensi atau */export* untuk laporan.`
                );
                await query("UPDATE users SET intro=1 WHERE id=?", [user.id]);
                sendingIntro[wa_number] = false;
                return;
            }

            // --- Perintah /help ---
            if (lowerMsg === '/help') {
                return require('./help')(chat, user.nama_wa);
            }

            // --- Greeting otomatis ---
            const replyGreeting = greetings[lowerMsg];
            if (replyGreeting) {
                const randomReply = greetingReplies[Math.floor(Math.random() * greetingReplies.length)];
                return sendTyping(chat, `${replyGreeting} *${nama_wa}*, ${randomReply}`, 1000);
            }

            // --- Absensi ---
            if (user.step_absen || lowerMsg === '/absen') {
                return handleAbsen(chat, user, lowerMsg, pesan, query);
            }

            // --- Export ---
            let paramBulan = null;

            // Jika user mengetik /export, ambil param bulan
            if (lowerMsg.startsWith('/export')) {
                const parts = pesan.split(' ').slice(1);
                paramBulan = parts.length ? parts[0] : null;
                return handleExport(chat, user, pesan, db, paramBulan); // langsung return
            }

            // Jika user sedang input export (step_input = true)
            if (user.step_input && !isExportValid(pesan)) {
                // reset step_input supaya bisa masuk default response
                await query("UPDATE users SET step_input=0 WHERE id=?", [user.id]);
            } else if (user.step_input) {
                return handleExport(chat, user, pesan, db, paramBulan);
            }

            // --- Default response untuk pesan yang tidak dikenali ---
            await sendTyping(chat, `Hmm… ${nama_wa}, aku masih belajar memahami pesan kamu.`, 1000);
            await sendTyping(chat, "Coba ketik */help* untuk melihat daftar perintah.", 1000);

        } catch (err) {
            console.error('Error handling message:', err);
            return chat.sendMessage('Terjadi kesalahan sistem.');
        }
    }
};
