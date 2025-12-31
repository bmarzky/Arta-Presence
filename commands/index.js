// index.js
const fs = require('fs');
const path = require('path');
const handleAbsen = require('./absen');
const { handleExport } = require('./export');
const greetings = require('../data/greetings');
const greetingReplies = require('../data/greetingReplies');
const sendingIntro = {};
const approveUser = require('./approve/approveUser');
const approveAtasan = require('./approve/approveAtasan');
const { sendTyping } = require('../utils/sendTyping');
const handleLembur = require('./absensi/lembur'); 
const handleEdit = require('./absensi/editAbsen');
const handleRiwayatAbsen = require('./absensi/riwayatAbsen');
const waitingTTD = require('../utils/waitingTTD');
const { predictIntent, getResponse } = require('../NLP/fallback');

const ttdFolder = path.join(__dirname, '../assets/ttd/');
if (!fs.existsSync(ttdFolder)) fs.mkdirSync(ttdFolder, { recursive: true });

const typeAndDelay = async (chat, ms = 800, random = 400) => {
    await chat.sendStateTyping();
    await new Promise(r => setTimeout(r, ms + Math.random() * random));
};

const isUserDataComplete = (user) => !!(user.nama_lengkap && user.jabatan && user.nik);

module.exports = {
    message: async (chat, wa_number, nama_wa, db, pesan, messageMedia) => {
        const lowerMsg = pesan.toLowerCase().trim();
        const query = (sql, params) =>
            new Promise((res, rej) =>
                db.query(sql, params, (err, result) => err ? rej(err) : res(result))
            );

        try {
            // Ambil user atau buat baru
            let [user] = await query("SELECT * FROM users WHERE wa_number=?", [wa_number]);
            if (!user) {
                await query("INSERT INTO users (wa_number, nama_wa, intro) VALUES (?, ?, 0)", [wa_number, nama_wa]);
                [user] = await query("SELECT * FROM users WHERE wa_number=?", [wa_number]);
            } else if (user.nama_wa !== nama_wa) {
                await query("UPDATE users SET nama_wa=? WHERE id=?", [nama_wa, user.id]);
                user.nama_wa = nama_wa;
            }

            const command = pesan.split(' ')[0].toLowerCase();
            const restrictedCommands = ['approve', 'revisi', 'status'];

            // Guard restricted commands untuk atasan
            if (restrictedCommands.includes(command)) {
                if (!user.jabatan) return sendTyping(chat, 'Data jabatan kamu tidak ditemukan.');
                if (user.jabatan !== 'Head West Java Operation') 
                    return sendTyping(chat, 'Jabatan anda bukan *Head West Java Operation*,\nakses terbatas untuk approvals.');

                return approveAtasan(chat, user, pesan, db);
            }

            // Cancel / close global
            if (['batal', 'cancel', 'close', '/cancel'].includes(lowerMsg)) {
                await query(`UPDATE users SET
                    step_input=NULL, export_type=NULL, template_export=NULL,
                    step_absen=NULL, step_lembur=NULL, step_riwayat=NULL
                    WHERE id=?`, [user.id]);

                if (waitingTTD[wa_number]) delete waitingTTD[wa_number];
                return sendTyping(chat, 'Proses dibatalkan.');
            }

            // Media (TTD)
            if (messageMedia && messageMedia.mimetype.startsWith('image/')) {
                const ext = messageMedia.mimetype.split('/')[1] || 'png';
                const filePath = path.join(ttdFolder, `${wa_number}.${ext}`);
                fs.writeFileSync(filePath, messageMedia.data, { encoding: 'base64' });

                if (waitingTTD[wa_number]?.user) {
                    const [dbUser] = await query("SELECT * FROM users WHERE wa_number=?", [wa_number]);
                    delete waitingTTD[wa_number];
                    await chat.sendMessage('*File berhasil ditandatangani*\nLaporan akan dikirim ke atasan untuk proses approval.');
                    return approveUser(chat, dbUser, db);
                }

                if (waitingTTD[wa_number]?.atasan) {
                    const [dbAtasan] = await query("SELECT * FROM users WHERE wa_number=?", [wa_number]);
                    delete waitingTTD[wa_number];
                    await chat.sendMessage('*File berhasil ditandatangani*\nApproval laporan telah selesai.');
                    return approveAtasan(chat, dbAtasan, 'approve', db);
                }

                return;
            }

            // Intro
            if (user.intro === 0) {
                if (sendingIntro[wa_number]) return;
                sendingIntro[wa_number] = true;

                await typeAndDelay(chat);
                await chat.sendMessage(
                    `Halo *${nama_wa}* Saya *Arta Presence*, bot absensi otomatis *Lintasarta*.\n\n` +
                    `Silakan gunakan perintah */help* untuk melihat daftar perintah.`
                );

                await query("UPDATE users SET intro=1 WHERE id=?", [user.id]);
                delete sendingIntro[wa_number];
                return;
            }

            // Help
            if (lowerMsg === '/help') return require('./help')(chat, user.nama_wa);

            // Greeting manual
            const replyGreeting = greetings[lowerMsg];
            if (replyGreeting) {
                const randomReply = greetingReplies[Math.floor(Math.random() * greetingReplies.length)];
                return sendTyping(chat, `${replyGreeting} *${nama_wa}*, ${randomReply}`, 1000);
            }

            // NLP intent handling
            const intent = await predictIntent(pesan);

            switch(intent) {
                case 'absen':
                    return handleAbsen(chat, user, lowerMsg, pesan, query);
                case 'lembur':
                    return handleLembur(chat, user, pesan, (sql, params, cb) => db.query(sql, params, cb));
                case 'riwayat':
                    return handleRiwayatAbsen(chat, user, pesan, db);
                case 'edit':
                    return handleEdit(chat, user, pesan, query);
                case 'export':
                    const paramBulan = pesan.split(' ').slice(1)[0] || null;
                    return handleExport(chat, user, pesan, db, paramBulan);
                case 'approve':
                    return approveUser(chat, user, db);
                case 'help':
                case 'info':
                    const reply = await getResponse(pesan);
                    return sendTyping(chat, reply, 1000);
                default:
                    const fallback = await getResponse(pesan);
                    return sendTyping(chat, fallback, 1000);
            }

        } catch (err) {
            console.error('Error handling message:', err);
            return chat.sendMessage('Terjadi kesalahan sistem.');
        }
    }
};
