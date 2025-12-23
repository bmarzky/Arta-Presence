const fs = require('fs');
const path = require('path');
const moment = require('moment');
const generatePDF = require('../utils/pdfGenerator');
const { MessageMedia } = require('whatsapp-web.js');
const { sendTyping } = require('../utils/sendTyping');

/* =========================
   HELPER
========================= */
const formatTanggalLMD = (date) => {
    const d = new Date(date);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
};

const hariIndonesia = (date) => {
    return moment(date).locale('id').format('dddd');
};

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
    // RESET STATE SAAT /EXPORT
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
            `Apakah benar nama kamu *${user.nama_wa}*? (iya/tidak)`
        );
    }

    if (stepNow === 'confirm_name') {
        const jawab = pesan.toLowerCase();
        if (jawab === 'iya') {
            await query(
                `UPDATE users SET nama_lengkap=?, step_input=NULL WHERE id=?`,
                [user.nama_wa, user.id]
            );
            user.nama_lengkap = user.nama_wa;
        } else if (jawab === 'tidak') {
            await query(
                `UPDATE users SET step_input='nama_lengkap' WHERE id=?`,
                [user.id]
            );
            return sendTyping(chat, `Silakan isi ${labels.nama_lengkap}:`);
        } else {
            return sendTyping(chat, 'Balas *iya* atau *tidak* ya.');
        }
    }

    // =============================
    // STEP 2: CEK DATA KOSONG
    // =============================
    const missing = fields.find(f => !user[f]);
    if (missing && !user.step_input) {
        await query(
            `UPDATE users SET step_input=? WHERE id=?`,
            [missing, user.id]
        );
        return sendTyping(chat, `Silakan isi ${labels[missing]}:`);
    }

    // =============================
    // STEP 3: INPUT DATA
    // =============================
    if (user.step_input && fields.includes(user.step_input)) {
        await query(
            `UPDATE users SET ${user.step_input}=?, step_input=NULL WHERE id=?`,
            [pesan, user.id]
        );
        user[user.step_input] = pesan;
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
            `Mau pakai template apa?\n\n1. KSPS\n2. LMD\n\nBalas *ksps* atau *lmd*`
        );
    }

    if (stepNow === 'choose_template') {
        const tpl = pesan.toLowerCase();
        if (!['ksps', 'lmd'].includes(tpl)) {
            return sendTyping(chat, 'Balas *ksps* atau *lmd* ya.');
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

/* ======================================================
   GENERATE PDF
====================================================== */
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

    /* =============================
       BUILD ROWS (KSPS & LMD)
    ============================= */
    const rows = [];

    for (let i = 1; i <= totalHari; i++) {
        const dateObj = moment(`${tahun}-${bulan + 1}-${i}`, 'YYYY-M-D');
        const iso = dateObj.format('YYYY-MM-DD');

        const r = absensi.find(a =>
            moment(a.tanggal).format('YYYY-MM-DD') === iso
        );

        // ===== LMD =====
        if (user.template_export === 'LMD') {
            rows.push(`
                <tr>
                    <td>${formatTanggalLMD(dateObj)}</td>
                    <td>${hariIndonesia(dateObj)}</td>
                    <td>${r?.jam_masuk || '-'}</td>
                    <td>${r?.jam_pulang || '-'}</td>
                    <td>${r?.deskripsi || '-'}</td>
                </tr>
            `);
        }

        // ===== KSPS (TIDAK DIUBAH) =====
        else {
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
    }

    /* =============================
       LOAD TEMPLATE & LOGO
    ============================= */
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

    return sendTyping(chat, 'Laporan berhasil dibuat');
}
