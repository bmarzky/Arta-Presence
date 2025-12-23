const fs = require('fs');
const path = require('path');
const moment = require('moment');
const generatePDF = require('../utils/pdfGenerator');
const { MessageMedia } = require('whatsapp-web.js');
const { sendTyping } = require('../utils/sendTyping');

module.exports = async function handleExport(chat, user, pesan, db, paramBulan = null) {
    if (!db) return chat.sendMessage('Database tidak tersedia.');

    const query = (sql, params) =>
        new Promise((res, rej) =>
            db.query(sql, params, (err, result) => err ? rej(err) : res(result))
        );

    // =============================
    // AMBIL DATA USER TERBARU
    // =============================
    const userData = await query(`SELECT * FROM users WHERE id=?`, [user.id]);
    if (!userData.length) {
        return sendTyping(chat, 'Data user tidak ditemukan.');
    }

    user = { ...user, ...userData[0] };

    // =============================
    // RESET STATE JIKA /EXPORT
    // =============================
    if (pesan.toLowerCase().startsWith('/export')) {
        await query(
            `UPDATE users 
             SET step_input=NULL, template_export=NULL, has_done_export=0 
             WHERE id=?`,
            [user.id]
        );

        user.step_input = null;
        user.template_export = null;
        user.has_done_export = 0;

        await sendTyping(chat, 'Menyiapkan laporan absensi...', 800);
    }

    const fields = ['nama_lengkap', 'jabatan', 'divisi', 'nik'];
    const labels = {
        nama_lengkap: 'Nama lengkap',
        jabatan: 'Jabatan',
        divisi: 'Divisi',
        nik: 'NIK'
    };

    let stepNow = user.step_input;

    // =============================
    // STEP 1: KONFIRMASI NAMA
    // =============================
    if (!user.nama_lengkap && !stepNow) {
        await query(
            `UPDATE users SET step_input='confirm_name' WHERE id=?`,
            [user.id]
        );
        return sendTyping(
            chat,
            `Untuk membuat laporan PDF, aku perlu beberapa data ya.\n\n` +
            `Apakah benar nama kamu *${user.nama_wa}*? (iya/tidak)`
        );
    }

    if (stepNow === 'confirm_name') {
        const jawab = pesan.toLowerCase();

        if (jawab === 'iya' || jawab === 'benar') {
            await query(
                `UPDATE users SET nama_lengkap=?, step_input=NULL WHERE id=?`,
                [user.nama_wa, user.id]
            );
            user.nama_lengkap = user.nama_wa;
            stepNow = null;
        } else if (jawab === 'tidak') {
            await query(
                `UPDATE users SET step_input='nama_lengkap' WHERE id=?`,
                [user.id]
            );
            return sendTyping(chat, `Silakan isi ${labels.nama_lengkap}:`);
        } else {
            return sendTyping(chat, 'Balas dengan *iya* atau *tidak* ya.');
        }
    }

    // =============================
    // STEP 2: CEK DATA KOSONG
    // =============================
    const missingFields = fields.filter(f => !user[f]);
    if (missingFields.length && !stepNow) {
        await query(
            `UPDATE users SET step_input=? WHERE id=?`,
            [missingFields[0], user.id]
        );
        await sendTyping(chat, 'Datamu masih ada yang kurang 🙏', 600);
        return sendTyping(chat, `Silakan isi ${labels[missingFields[0]]}:`);
    }

    // =============================
    // STEP 3: INPUT DATA
    // =============================
    if (stepNow && fields.includes(stepNow)) {
        await query(
            `UPDATE users SET ${stepNow}=?, step_input=NULL WHERE id=?`,
            [pesan, user.id]
        );
        user[stepNow] = pesan;

        const next = fields.find(f => !user[f]);
        if (next) {
            await query(
                `UPDATE users SET step_input=? WHERE id=?`,
                [next, user.id]
            );
            return sendTyping(chat, `Silakan isi ${labels[next]}:`);
        }
    }

    // =============================
    // STEP 4: PILIH TEMPLATE
    // =============================
    if (fields.every(f => user[f]) && !user.template_export && !user.step_input) {
        await query(
            `UPDATE users SET step_input='choose_template' WHERE id=?`,
            [user.id]
        );
        return sendTyping(
            chat,
            `Mau pakai template apa?\n\n` +
            `1️⃣ KSPS\n2️⃣ LMD\n\n` +
            `Balas *ksps* atau *lmd*`
        );
    }

    if (stepNow === 'choose_template') {
        const tpl = pesan.toLowerCase();
        if (!['ksps', 'lmd'].includes(tpl)) {
            return sendTyping(chat, 'Pilihan tidak valid. Balas *ksps* atau *lmd*');
        }

        await query(
            `UPDATE users SET template_export=?, step_input=NULL WHERE id=?`,
            [tpl.toUpperCase(), user.id]
        );

        user.template_export = tpl.toUpperCase();
    }

    // =============================
    // STEP 5: GENERATE PDF
    // =============================
    if (fields.every(f => user[f]) && user.template_export) {
        await sendTyping(chat, 'Sedang membuat laporan PDF...', 1000);
        return generatePDFandSend(chat, user, db, paramBulan);
    }
};

// ======================================================
// GENERATE PDF
// ======================================================
async function generatePDFandSend(chat, user, db, paramBulan) {
    const query = (sql, params) =>
        new Promise((res, rej) =>
            db.query(sql, params, (err, result) => err ? rej(err) : res(result))
        );

    const bulanNama = [
        'Januari','Februari','Maret','April','Mei','Juni',
        'Juli','Agustus','September','Oktober','November','Desember'
    ];

    const now = new Date();
    let bulan = now.getMonth();
    let tahun = now.getFullYear();

    if (paramBulan) {
        const idx = bulanNama.findIndex(
            b => b.toLowerCase() === paramBulan.toLowerCase()
        );
        if (idx >= 0) bulan = idx;
    }

    const totalHari = new Date(tahun, bulan + 1, 0).getDate();
    user.periode = `1 - ${totalHari} ${bulanNama[bulan]} ${tahun}`;

    const absensi = await query(
        `SELECT * FROM absensi 
         WHERE user_id=? AND MONTH(tanggal)=? AND YEAR(tanggal)=?
         ORDER BY tanggal`,
        [user.id, bulan + 1, tahun]
    );

    const rows = [];
    for (let i = 1; i <= totalHari; i++) {
        const tgl = moment(`${tahun}-${bulan + 1}-${i}`, 'YYYY-M-D')
            .format('YYYY-MM-DD');
        const r = absensi.find(a =>
            moment(a.tanggal).format('YYYY-MM-DD') === tgl
        );
        rows.push(`
            <tr>
                <td>${i}</td>
                <td>${r?.jam_masuk || ''}</td>
                <td>${r?.jam_pulang || ''}</td>
                <td>${r?.deskripsi || ''}</td>
                <td></td>
            </tr>
        `);
    }

    const templateName = user.template_export;
    const template = fs.readFileSync(
        path.join(__dirname, `../templates/${templateName}.html`),
        'utf8'
    );

    const logo = fs.readFileSync(
        path.join(__dirname, `../assets/${templateName.toLowerCase()}.png`),
        'base64'
    );

    const html = template
        .replaceAll('{{logo_path}}', `data:image/png;base64,${logo}`)
        .replaceAll('{{nama}}', user.nama_lengkap)
        .replaceAll('{{jabatan}}', user.jabatan)
        .replaceAll('{{divisi}}', user.divisi)
        .replaceAll('{{nik}}', user.nik)
        .replaceAll('{{periode}}', user.periode)
        .replaceAll('{{rows_absensi}}', rows.join(''));

    const fileName = `${user.nama_lengkap}-${templateName}-${bulanNama[bulan]}.pdf`;
    const output = path.join(__dirname, '../exports', fileName);

    if (fs.existsSync(output)) fs.unlinkSync(output);

    await generatePDF(html, output);

    const media = MessageMedia.fromFilePath(output);
    await chat.sendMessage(media);

    return sendTyping(chat, 'Laporan berhasil dibuat ✅');
}
