// lembur.js
const sessions = {}; // session sementara
const handleExport = require('../export'); // sesuaikan path

module.exports = function handleLembur(chat, user, pesan, query) {
    const userId = user.id;
    const lowerMsg = pesan.trim().toLowerCase(); // untuk command
    const rawText = pesan.trim(); // untuk input step-by-step

    if (!sessions[userId]) sessions[userId] = { step: null, data: {} };
    const session = sessions[userId];

    // Start / reset flow
    if (lowerMsg === '/lembur') {
        session.step = 'input_tanggal';
        session.data = {};
        query("UPDATE users SET step_lembur=? WHERE id=?", [session.step, userId], (err) => {
            if (err) console.error(err);
            chat.sendMessage('Masukkan tanggal lembur (YYYY-MM-DD):');
        });
        return;
    }

    // Jika user belum punya session tapi ada step di DB
    if (!session.step && user.step_lembur) {
        session.step = user.step_lembur;
    }

    switch (session.step) {
        case 'input_tanggal': {
            let tanggal = rawText;
            if (/^\d{2} \d{2} \d{4}$/.test(tanggal)) {
                const [d, m, y] = tanggal.split(' ');
                tanggal = `${y}-${m}-${d}`;
            } else if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) {
                return chat.sendMessage('Format salah. Masukkan tanggal (YYYY-MM-DD):');
            }
            session.data.tanggal = tanggal;
            session.step = 'input_jam_mulai';
            query("UPDATE users SET step_lembur=? WHERE id=?", [session.step, userId], (err) => {
                if (err) console.error(err);
                chat.sendMessage('Masukkan jam mulai lembur (HH:MM):');
            });
            break;
        }

        case 'input_jam_mulai': {
            if (!/^\d{2}:\d{2}$/.test(rawText))
                return chat.sendMessage('Format salah. Masukkan jam mulai (HH:MM):');
            session.data.jam_mulai = rawText;
            session.step = 'input_jam_selesai';
            query("UPDATE users SET step_lembur=? WHERE id=?", [session.step, userId], (err) => {
                if (err) console.error(err);
                chat.sendMessage('Masukkan jam selesai lembur (HH:MM):');
            });
            break;
        }

        case 'input_jam_selesai': {
            if (!/^\d{2}:\d{2}$/.test(rawText))
                return chat.sendMessage('Format salah. Masukkan jam selesai (HH:MM):');
            session.data.jam_selesai = rawText;
            session.step = 'input_deskripsi';
            query("UPDATE users SET step_lembur=? WHERE id=?", [session.step, userId], (err) => {
                if (err) console.error(err);
                chat.sendMessage('Masukkan deskripsi lembur:');
            });
            break;
        }

        case 'input_deskripsi': {
            session.data.deskripsi = rawText;
            session.step = 'confirm';
            query("UPDATE users SET step_lembur=? WHERE id=?", [session.step, userId], (err) => {
                if (err) console.error(err);
                chat.sendMessage(
                    `Apakah data ini sudah benar?\n` +
                    `Tanggal: ${session.data.tanggal}\n` +
                    `Jam: ${session.data.jam_mulai} – ${session.data.jam_selesai}\n` +
                    `Deskripsi: ${session.data.deskripsi}\n(Ketik Ya/Tidak)`
                );
            });
            break;
        }

        case 'confirm': {
            const confirmText = rawText.toLowerCase();
            if (confirmText === 'ya') {
                const [hMulaiH, hMulaiM] = session.data.jam_mulai.split(':').map(Number);
                const [hSelesaiH, hSelesaiM] = session.data.jam_selesai.split(':').map(Number);
                const totalJam = (hSelesaiH + hSelesaiM / 60) - (hMulaiH + hMulaiM / 60);

                query(
                    `INSERT INTO lembur 
                    (user_id, tanggal, jam_mulai, jam_selesai, total_lembur, deskripsi)
                    VALUES (?, ?, ?, ?, ?, ?)`,
                    [userId, session.data.tanggal, session.data.jam_mulai, session.data.jam_selesai, totalJam, session.data.deskripsi],
                    (err) => {
                        if (err) {
                            console.error(err);
                            return chat.sendMessage('Terjadi kesalahan saat menyimpan data lembur.');
                        }

                        session.step = null;
                        session.data = {};
                        query("UPDATE users SET step_lembur=NULL WHERE id=?", [userId], (err2) => {
                            if (err2) console.error(err2);

                            chat.sendMessage('Data lembur berhasil disimpan');

                            // 🔹 Opsional langsung export PDF lembur
                            // Set template_export: 'LEMBUR' supaya generate PDF khusus lembur
                            handleExport(chat, { ...user, template_export: 'LEMBUR' }, '/export', query);
                        });
                    }
                );
            } else if (confirmText === 'tidak') {
                session.step = 'input_tanggal';
                session.data = {};
                query("UPDATE users SET step_lembur=? WHERE id=?", [session.step, userId], (err) => {
                    if (err) console.error(err);
                    chat.sendMessage('Silakan ulangi input. Masukkan tanggal lembur (YYYY-MM-DD):');
                });
            } else {
                chat.sendMessage('Ketik Ya atau Tidak untuk konfirmasi.');
            }
            break;
        }

        default:
            break;
    }
};
