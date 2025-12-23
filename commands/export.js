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

    /* =============================
       AMBIL DATA USER
    ============================= */
    const userData = await query(`SELECT * FROM users WHERE id=?`, [user.id]);
    if (!userData.length) {
        return sendTyping(chat, 'Data user tidak ditemukan.');
    }
    user = { ...user, ...userData[0] };

    /* =============================
       RESET SAAT /EXPORT
    ============================= */
    if (pesan.toLowerCase().startsWith('/export')) {
        await query(
            `UPDATE users 
             SET step_input=NULL, template_export=NULL 
             WHERE id=?`,
            [user.id]
        );

        user.step_input = null;
        user.template_export = null;

        await sendTyping(chat, 'Menyiapkan laporan absensi...', 800);
    }

    let stepNow = user.step_input;

    /* =============================
       STEP 1: KONFIRMASI NAMA
    ============================= */
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
                `UPDATE users 
                 SET nama_lengkap=?, step_input='jabatan' 
                 WHERE id=?`,
                [user.nama_wa, user.id]
            );
            return sendTyping(chat, 'Silakan isi *Jabatan* kamu:');
        }

        if (jawab === 'tidak') {
            await query(
                `UPDATE users SET step_input='nama_lengkap' WHERE id=?`,
                [user.id]
            );
            return sendTyping(chat, 'Silakan isi *Nama Lengkap* kamu:');
        }

        return sendTyping(chat, 'Balas *iya* atau *tidak* ya.');
    }

    /* =============================
       STEP 2: INPUT NAMA
    ============================= */
    if (stepNow === 'nama_lengkap') {
        await query(
            `UPDATE users 
             SET nama_lengkap=?, step_input='jabatan' 
             WHERE id=?`,
            [pesan, user.id]
        );
        return sendTyping(chat, 'Silakan isi *Jabatan* kamu:');
    }

    /* =============================
       STEP 3: INPUT JABATAN
    ============================= */
    if (stepNow === 'jabatan') {
        await query(
            `UPDATE users 
             SET jabatan=?, step_input='nik' 
             WHERE id=?`,
            [pesan, user.id]
        );
        return sendTyping(chat, 'Silakan isi *NIK* kamu:');
    }

    /* =============================
       STEP 4: INPUT NIK (WAJIB)
    ============================= */
    if (stepNow === 'nik') {
        await query(
            `UPDATE users 
             SET nik=?, step_input=NULL 
             WHERE id=?`,
            [pesan, user.id]
        );
        user.nik = pesan;
    }

    /* =============================
       STEP 5: PILIH TEMPLATE
    ============================= */
    if (
        user.nama_lengkap &&
        user.jabatan &&
        user.nik &&
        !user.template_export &&
        !user.step_input
    ) {
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

    /* =============================
       STEP 6: GENERATE PDF
    ============================= */
    if (user.nama_lengkap && user.jabatan && user.nik && user.template_export) {
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

    const formatPeriodeLMD = (bulan, tahun, bulanNama) => {
    return `${bulanNama[bulan]} ${tahun}`;
    };
    
    const totalHari = new Date(tahun, bulan + 1, 0).getDate();

    // Periode beda antara KSPS & LMD
    if (user.template_export === 'LMD') {
        // LMD → Nama Bulan Tahun
        user.periode = `${bulanNama[bulan]} ${tahun}`;
    } else {
        // KSPS → 1 - akhir bulan
        user.periode = `1 - ${totalHari} ${bulanNama[bulan]} ${tahun}`;
    }

    const absensi = await query(
        `SELECT * FROM absensi
         WHERE user_id=? AND MONTH(tanggal)=? AND YEAR(tanggal)=?
         ORDER BY tanggal`,
        [user.id, bulan + 1, tahun]
    );

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
        // ===== KSPS (AS IS) =====
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
        .replaceAll('{{nik}}', user.nik)
        .replaceAll('{{divisi}}', 'Regional Operation')
        .replaceAll('{{lokasi}}', 'Aplikanusa Lintasarta Bandung')
        .replaceAll('{{kelompok_kerja}}', 'Central Regional Operation')
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
