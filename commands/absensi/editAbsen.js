const { sendTyping } = require('../../utils/sendTyping');
const moment = require('moment');

const editSessions = {};

// ===============================
// HITUNG TOTAL LEMBUR
// ===============================
function hitungTotalLembur(jamMulai, jamSelesai) {
    const start = moment(jamMulai, 'HH:mm');
    let end = moment(jamSelesai, 'HH:mm');

    if (end.isBefore(start)) {
        end.add(1, 'day');
    }

    const durasi = moment.duration(end.diff(start));
    const jam = Math.floor(durasi.asHours());
    const menit = durasi.minutes();

    return `${String(jam).padStart(2, '0')}:${String(menit).padStart(2, '0')}`;
}

module.exports = async function handleEdit(chat, user, pesan, query) {
    const wa = user.wa_number;
    const text = pesan.trim();
    const lower = text.toLowerCase();

    // ===============================
    // RESET TOTAL SETIAP /edit
    // ===============================
    if (lower === '/edit') {
        editSessions[wa] = { step: 'choose_type' };
        return sendTyping(chat, 'Mau edit *absen* atau *lembur*?');
    }

    if (lower.startsWith('/')) return;

    if (!editSessions[wa]) {
        editSessions[wa] = { step: 'choose_type' };
        return sendTyping(chat, 'Mau edit *absen* atau *lembur*?');
    }

    const session = editSessions[wa];

    // ===============================
    // STEP 1: PILIH TIPE
    // ===============================
    if (session.step === 'choose_type') {
        if (!['absen', 'lembur'].includes(lower)) {
            return sendTyping(chat, 'Balas dengan *absen* atau *lembur*.');
        }

        session.type = lower;
        session.step = 'choose_date';
        return sendTyping(chat, `Mau edit ${lower} tanggal berapa? (YYYY-MM-DD)`);
    }

    // ===============================
    // STEP 2: PILIH TANGGAL
    // ===============================
    if (session.step === 'choose_date') {

        if (!moment(text, 'YYYY-MM-DD', true).isValid()) {
            return sendTyping(chat, 'Format tanggal salah. Contoh: 2025-12-14');
        }

        const table = session.type === 'absen' ? 'absensi' : 'lembur';

        try {
            const rows = await query(
                `SELECT * FROM ${table} WHERE user_id=? AND tanggal=?`,
                [user.id, text]
            );

            if (!rows.length) {
                delete editSessions[wa];
                return sendTyping(
                    chat,
                    `Tidak ada data *${session.type}* pada tanggal ${text}.\nKetik */edit* untuk ulang.`
                );
            }

            session.old = rows[0];
            session.step = 'input_new';

            let msg = '*Data lama:*\n';
            if (session.type === 'absen') {
                msg += `Jam Masuk  : ${rows[0].jam_masuk || '-'}\n`;
                msg += `Jam Pulang : ${rows[0].jam_pulang || '-'}\n`;
            } else {
                msg += `Jam Mulai  : ${rows[0].jam_mulai}\n`;
                msg += `Jam Selesai: ${rows[0].jam_selesai}\n`;
                msg += `Total      : ${rows[0].total_lembur || '-'}\n`;
            }
            msg += `Deskripsi  : ${rows[0].deskripsi || '-'}\n\n`;
            msg += 'Kirim data baru:\n';
            msg += session.type === 'absen'
                ? '`jam_masuk,jam_pulang,deskripsi`'
                : '`jam_mulai,jam_selesai,deskripsi`';

            return sendTyping(chat, msg);

        } catch (err) {
            console.error(err);
            delete editSessions[wa];
            return sendTyping(chat, 'Terjadi kesalahan saat mengambil data.');
        }
    }

    // ===============================
    // STEP 3: INPUT DATA BARU
    // ===============================
    if (session.step === 'input_new') {
        const parts = text.split(',');
        if (parts.length < 3) {
            return sendTyping(chat, 'Format salah. Kirim ulang sesuai format.');
        }

        session.new = session.type === 'absen'
            ? {
                jam_masuk: parts[0].trim(),
                jam_pulang: parts[1].trim(),
                deskripsi: parts[2].trim()
            }
            : {
                jam_mulai: parts[0].trim(),
                jam_selesai: parts[1].trim(),
                deskripsi: parts[2].trim()
            };

        // HITUNG TOTAL LEMBUR
        if (session.type === 'lembur') {
            session.new.total_lembur = hitungTotalLembur(
                session.new.jam_mulai,
                session.new.jam_selesai
            );
        }

        session.step = 'confirm';

        let msg = '*Konfirmasi Perubahan*\n\n*Data lama:*\n';
        for (const k in session.new) {
            msg += `${k}: ${session.old[k] || '-'}\n`;
        }

        msg += '\n*Data baru:*\n';
        for (const k in session.new) {
            msg += `${k}: ${session.new[k]}\n`;
        }

        msg += '\nSimpan perubahan? (ya/tidak)';
        return sendTyping(chat, msg);
    }

    // ===============================
    // STEP 4: KONFIRMASI
    // ===============================
    if (session.step === 'confirm') {
        if (lower === 'ya') {
            const table = session.type === 'absen' ? 'absensi' : 'lembur';
            const fields = Object.keys(session.new).map(k => `${k}=?`).join(',');

            await query(
                `UPDATE ${table} SET ${fields} WHERE id=?`,
                [...Object.values(session.new), session.old.id]
            );

            delete editSessions[wa];
            return sendTyping(chat, 'Perubahan berhasil disimpan.');
        }

        if (lower === 'tidak') {
            delete editSessions[wa];
            return sendTyping(chat, 'Perubahan dibatalkan.');
        }

        return sendTyping(chat, 'Balas dengan *ya* atau *tidak*.');
    }
};

module.exports.isEditing = (wa) => {
    return !!editSessions[wa];
};
