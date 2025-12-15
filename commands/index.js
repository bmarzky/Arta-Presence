// commands/index.js
const handleAbsen = require('./absen');
const handleExport = require('./export');
const greetings = require('../data/greetings');
const greetingReplies = require('../data/greetingReplies');
const sendingIntro = {}; // flag intro agar tidak double
const { sendTyping } = require('../utils/sendTyping'); // sesuaikan path jika perlu


const typeAndDelay = async (chat, ms = 800, random = 400) => {
    await chat.sendStateTyping();
    await new Promise(r => setTimeout(r, ms + Math.random() * random));
};

module.exports = {
    message: async (chat, wa_number, nama_wa, db, pesan) => {
        const lowerMsg = pesan.toLowerCase().trim();

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
                await chat.sendMessage(`Halo *${nama_wa}*\nSaya *Arta Presence*, bot absensi otomatis.\n\nKetik */absen* untuk mulai absensi atau */export* untuk laporan.`);
                await query("UPDATE users SET intro=1 WHERE id=?", [user.id]);
                sendingIntro[wa_number] = false;
                return;
            }

            // --- Step input / Export ---
            const fields = ['nama_lengkap','jabatan','divisi','nik'];
            const labels = {
                nama_lengkap: 'Nama lengkap',
                jabatan: 'Jabatan',
                divisi: 'Divisi',
                nik: 'NIK'
            };

            // Cek apakah pesan adalah export dengan bulan
            let paramBulan = null;
            if (lowerMsg.startsWith('/export')) {
                const parts = pesan.split(' ').slice(1); // ambil kata abis /export
                paramBulan = parts.length ? parts[0] : null;
            }

            // Jika user sedang input export atau mengetik /export
            if (user.step_input || lowerMsg.startsWith('/export')) {
                return handleExport(chat, user, pesan, db, paramBulan);
            }

            // Jika user sedang absen
            if (user.step_absen || lowerMsg === '/absen') {
                return handleAbsen(chat, user, lowerMsg, pesan, query);
            }

            // Greeting otomatis
            const replyGreeting = greetings[lowerMsg];
            if (replyGreeting) {
                const randomReply = greetingReplies[Math.floor(Math.random() * greetingReplies.length)];
                return sendTyping(chat, `${replyGreeting} *${nama_wa}*, ${randomReply}`, 1000); // 1000 ms = 1 detik
            }


            // Perintah /help
            if (pesan.toLowerCase() === '/help') {
                return require('./commands/help')(chat, user.nama_wa);
            }


            // Default response
            await sendTyping(chat, `Hmm… ${nama_wa}, aku masih belajar memahami pesan kamu.`, 1000);
            await sendTyping(chat, "Coba ketik */help* untuk melihat daftar perintah.", 1000);


        } catch (err) {
            console.error('Error handling message:', err);
            return chat.sendMessage('Terjadi kesalahan sistem.');
        }
    }
};
