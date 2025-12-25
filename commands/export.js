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
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

const hariIndonesia = (date) =>
    moment(date).locale('id').format('dddd');

/* =========================
   MAIN HANDLER
========================= */
module.exports = async function handleExport(chat, user, pesan, db, paramBulan = null) {
    if (!db) return;

    const query = (sql, params) =>
        new Promise((res, rej) =>
            db.query(sql, params, (err, result) => err ? rej(err) : res(result))
        );

    const [dbUser] = await query(`SELECT * FROM users WHERE id=?`, [user.id]);
    if (!dbUser) return;

    user = { ...user, ...dbUser };

    const nama_wa = user.pushname || user.nama_wa || 'Kak';
    const text = pesan.toLowerCase();
    const step = user.step_input;

    /* =============================
       COMMAND /EXPORT
    ============================= */
    if (text === '/export') {

        /* === VALIDASI DATA PROFIL === */
        if (!user.nama_lengkap) {
            await query(`UPDATE users SET step_input='confirm_name' WHERE id=?`, [user.id]);
            await sendTyping(chat, `Maaf *${nama_wa}*, kami belum memiliki *nama lengkap* kamu.`, 800);
            return sendTyping(chat, `Apakah benar nama lengkap kamu *${nama_wa}*? (iya/tidak)`);
        }

        if (!user.jabatan) {
            await query(`UPDATE users SET step_input='jabatan' WHERE id=?`, [user.id]);
            return sendTyping(chat, 'Silakan isi *Jabatan* kamu:');
        }

        if (!user.nik) {
            await query(`UPDATE users SET step_input='nik' WHERE id=?`, [user.id]);
            return sendTyping(chat, 'Silakan isi *NIK* kamu:');
        }

        /* === TEMPLATE BELUM DIPILIH === */
        if (!user.template_export) {
            await query(`UPDATE users SET step_input='choose_template' WHERE id=?`, [user.id]);
            return sendTyping(chat, `Mau pakai template apa?\n\n1. KSPS\n2. LMD\n\nBalas *ksps* atau *lmd*`);
        }

        /* === SEMUA VALID === */
        await sendTyping(chat, 'Sedang membuat laporan PDF...', 800);
        return generatePDFandSend(chat, user, db, paramBulan);
    }

    /* =============================
       CONFIRM NAME
    ============================= */
    if (step === 'confirm_name') {
        if (text === 'iya') {
            await query(`UPDATE users SET nama_lengkap=?, step_input='jabatan' WHERE id=?`, [nama_wa, user.id]);
            return sendTyping(chat, 'Silakan isi *Jabatan* kamu:');
        }

        if (text === 'tidak') {
            await query(`UPDATE users SET step_input='nama_lengkap' WHERE id=?`, [user.id]);
            return sendTyping(chat, 'Silakan isi *Nama Lengkap* kamu:');
        }

        return sendTyping(chat, 'Balas *iya* atau *tidak* ya.');
    }

    /* =============================
       INPUT NAMA LENGKAP
    ============================= */
    if (step === 'nama_lengkap') {
        await query(`UPDATE users SET nama_lengkap=?, step_input='jabatan' WHERE id=?`, [pesan, user.id]);
        return sendTyping(chat, 'Silakan isi *Jabatan* kamu:');
    }

    /* =============================
       INPUT JABATAN
    ============================= */
    if (step === 'jabatan') {
        await query(`UPDATE users SET jabatan=?, step_input='nik' WHERE id=?`, [pesan, user.id]);
        return sendTyping(chat, 'Silakan isi *NIK* kamu:');
    }

    /* =============================
       INPUT NIK
    ============================= */
    if (step === 'nik') {
        await query(`UPDATE users SET nik=?, step_input='choose_template' WHERE id=?`, [pesan, user.id]);
        return sendTyping(chat, `Mau pakai template apa?\n\n1. KSPS\n2. LMD\n\nBalas *ksps* atau *lmd*`);
    }

    /* =============================
       PILIH TEMPLATE
    ============================= */
    if (step === 'choose_template') {
        if (!['ksps', 'lmd'].includes(text)) {
            return sendTyping(chat, 'Balas *ksps* atau *lmd* ya.');
        }

        const template = text.toUpperCase();
        await query(`UPDATE users SET template_export=?, step_input=NULL WHERE id=?`, [template, user.id]);

        await sendTyping(chat, 'Sedang membuat laporan PDF...', 800);
        return generatePDFandSend(chat, { ...user, template_export: template }, db, paramBulan);
    }
};

/* ======================================================
   GENERATE PDF (AMAN TOTAL)
====================================================== */
async function generatePDFandSend(chat, user, db, paramBulan) {
    const nama_wa = user.pushname || user.nama_wa || 'Kak';

    if (!user.nama_lengkap || !user.jabatan || !user.nik || !user.template_export) {
        await sendTyping(chat, 'Maaf, data belum lengkap. Silakan gunakan */export* kembali.');
        return;
    }

    const query = (sql, params) =>
        new Promise((res, rej) =>
            db.query(sql, params, (err, result) => err ? rej(err) : res(result))
        );

    const bulanNama = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
    const now = new Date();
    let bulan = now.getMonth();
    let tahun = now.getFullYear();

    if (paramBulan) {
        const idx = bulanNama.findIndex(b => b.toLowerCase() === paramBulan.toLowerCase());
        if (idx >= 0) bulan = idx;
    }

    const totalHari = new Date(tahun, bulan + 1, 0).getDate();
    const periode = user.template_export === 'LMD'
        ? `${bulanNama[bulan]} ${tahun}`
        : `1 - ${totalHari} ${bulanNama[bulan]} ${tahun}`;

    const absensi = await query(
        `SELECT * FROM absensi WHERE user_id=? AND MONTH(tanggal)=? AND YEAR(tanggal)=? ORDER BY tanggal`,
        [user.id, bulan + 1, tahun]
    );

    const rows = [];
    for (let i = 1; i <= totalHari; i++) {
        const dateObj = moment(`${tahun}-${bulan + 1}-${i}`, 'YYYY-M-D');
        const iso = dateObj.format('YYYY-MM-DD');
        const r = absensi.find(a => moment(a.tanggal).format('YYYY-MM-DD') === iso);

        rows.push(user.template_export === 'LMD'
            ? `<tr>
                <td>${formatTanggalLMD(dateObj)}</td>
                <td>${hariIndonesia(dateObj)}</td>
                <td>${r?.jam_masuk || '-'}</td>
                <td>${r?.jam_pulang || '-'}</td>
                <td>${r?.deskripsi || '-'}</td>
               </tr>`
            : `<tr>
                <td>${i}</td>
                <td>${r?.jam_masuk || ''}</td>
                <td>${r?.jam_pulang || ''}</td>
                <td>${r?.deskripsi || ''}</td>
                <td></td>
               </tr>`);
    }

    const templatePath = path.join(__dirname, `../templates/absensi/${user.template_export}.html`);
    if (!fs.existsSync(templatePath)) {
        await sendTyping(chat, 'Maaf, template laporan tidak ditemukan.');
        return;
    }

    const template = fs.readFileSync(templatePath, 'utf8');
    const logoPath = path.join(__dirname, `../assets/${user.template_export.toLowerCase()}.png`);
    const logo = fs.existsSync(logoPath) ? fs.readFileSync(logoPath, 'base64') : '';

    const html = template
        .replaceAll('{{logo_path}}', logo ? `data:image/png;base64,${logo}` : '')
        .replaceAll('{{nama}}', user.nama_lengkap)
        .replaceAll('{{jabatan}}', user.jabatan)
        .replaceAll('{{nik}}', user.nik)
        .replaceAll('{{divisi}}', 'Regional Operation')
        .replaceAll('{{lokasi}}', 'Aplikanusa Lintasarta Bandung')
        .replaceAll('{{kelompok_kerja}}', 'Central Regional Operation')
        .replaceAll('{{periode}}', periode)
        .replaceAll('{{rows_absensi}}', rows.join(''))
        .replaceAll('{{ttd_atasan}}', '') // akan diisi saat approve
        .replaceAll('{{nama_atasan}}', '')
        .replaceAll('{{nik_atasan}}', '');

    const exportsDir = path.join(__dirname, '../exports');
    if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });

    const timestamp = Date.now();
    const fileName = `${user.nama_lengkap}-${user.template_export}-${bulanNama[bulan]}-${timestamp}.pdf`;
    const output = path.join(exportsDir, fileName);

    await generatePDF(html, output);

    if (!fs.existsSync(output)) {
        await sendTyping(chat, 'Maaf, gagal membuat file PDF.');
        return;
    }

    // ambil approver dari DB
    const [approver] = await query(`SELECT wa_number, nama_lengkap, nik FROM users WHERE jabatan=? LIMIT 1`, ['spv']);
    if (!approver || !approver.wa_number) {
        await sendTyping(chat, 'Maaf, approver belum terdaftar.');
        return;
    }

    await query(
        `INSERT INTO approvals (user_id, approver_wa, file_path, status, ttd_user_at, nama_atasan, nik_atasan)
         VALUES (?, ?, ?, 'pending', NOW(), ?, ?)`,
        [user.id, approver.wa_number, output, approver.nama_lengkap || '', approver.nik || '']
    );

    await chat.sendMessage(MessageMedia.fromFilePath(output));
    await sendTyping(chat, 'Laporan berhasil dibuat', 600);
    await sendTyping(chat, `*${nama_wa}*, kamu bisa langsung approval kepada *${approver.nama_lengkap}* dengan mengetik */approve*`);
}
