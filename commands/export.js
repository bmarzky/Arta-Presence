const fs = require('fs');
const path = require('path');
const moment = require('moment');
const generatePDF = require('../utils/pdfGenerator');
const { MessageMedia } = require('whatsapp-web.js');
const { sendTyping } = require('../utils/sendTyping');
const ttdFolder = path.join(__dirname, '../assets/ttd/');

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
    if (!db || !user?.id) return;

    const query = (sql, params = []) =>
        new Promise((res, rej) =>
            db.query(sql, params, (err, result) => err ? rej(err) : res(result))
        );

    try {
        const [dbUser] = await query(`SELECT * FROM users WHERE id=?`, [user.id]);
        if (!dbUser) return;

        user = { ...user, ...dbUser };

        const nama_wa = user.pushname || user.nama_wa || 'Kak';
        const text = pesan.toLowerCase().trim();
        const step = user.step_input;

        /* =============================
           COMMAND /EXPORT
           ❗ TIDAK ADA BLOKIR PENDING
        ============================= */
        if (text === '/export') {
            const [pending] = await query(
                `SELECT id FROM approvals WHERE user_id=? AND status='pending' LIMIT 1`,
                [user.id]
            );

            if (pending) {
                return sendTyping(
                    chat,
                    'Masih ada laporan *menunggu approval*. Tunggu disetujui atau direvisi.'
                );
            }

            if (!user.nama_lengkap) {
                await query(`UPDATE users SET step_input='confirm_name' WHERE id=?`, [user.id]);
                await sendTyping(chat, `Maaf *${nama_wa}*, kami belum memiliki *nama lengkap* kamu.`);
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

            if (!user.template_export) {
                await query(`UPDATE users SET step_input='choose_template' WHERE id=?`, [user.id]);
                return sendTyping(chat, `Mau pakai template apa?\n\n1. KSPS\n2. LMD\n\nBalas *ksps* atau *lmd*`);
            }

            await sendTyping(chat, 'Sedang menyiapkan laporan...', 800);
            return generatePDFandSend(chat, user, db, paramBulan);
        }

        /* =============================
           FLOW INPUT USER
        ============================= */
        if (step === 'confirm_name') {
            if (text === 'iya') {
                await query(
                    `UPDATE users SET nama_lengkap=?, step_input='jabatan' WHERE id=?`,
                    [nama_wa, user.id]
                );
                return sendTyping(chat, 'Silakan isi *Jabatan* kamu:');
            }

            if (text === 'tidak') {
                await query(`UPDATE users SET step_input='nama_lengkap' WHERE id=?`, [user.id]);
                return sendTyping(chat, 'Silakan isi *Nama Lengkap* kamu:');
            }

            return sendTyping(chat, 'Balas *iya* atau *tidak* ya.');
        }

        if (step === 'nama_lengkap') {
            await query(
                `UPDATE users SET nama_lengkap=?, step_input='jabatan' WHERE id=?`,
                [pesan, user.id]
            );
            return sendTyping(chat, 'Silakan isi *Jabatan* kamu:');
        }

        if (step === 'jabatan') {
            await query(
                `UPDATE users SET jabatan=?, step_input='nik' WHERE id=?`,
                [pesan, user.id]
            );
            return sendTyping(chat, 'Silakan isi *NIK* kamu:');
        }

        if (step === 'nik') {
            await query(
                `UPDATE users SET nik=?, step_input='choose_template' WHERE id=?`,
                [pesan, user.id]
            );
            return sendTyping(chat, `Mau pakai template apa?\n\n1. KSPS\n2. LMD\n\nBalas *ksps* atau *lmd*`);
        }

        if (step === 'choose_template') {
            if (!['ksps', 'lmd'].includes(text)) {
                return sendTyping(chat, 'Balas *ksps* atau *lmd* ya.');
            }

            const template = text.toUpperCase();
            await query(
                `UPDATE users SET template_export=?, step_input=NULL WHERE id=?`,
                [template, user.id]
            );

            await sendTyping(chat, 'Sedang menyiapkan templete laporan...', 800);
            return generatePDFandSend(chat, { ...user, template_export: template }, db, paramBulan);
        }

    } catch (err) {
        console.error('EXPORT ERROR:', err);
        return sendTyping(chat, 'Terjadi kesalahan saat memproses export.');
    }
};

/* ======================================================
   GENERATE PDF
   ✅ Simpan HTML juga supaya bisa generate ulang dengan TTD
====================================================== */
async function generatePDFandSend(chat, user, db, paramBulan) {
    const query = (sql, params = []) =>
        new Promise((res, rej) =>
            db.query(sql, params, (err, result) => err ? rej(err) : res(result))
        );

    try {
        const bulanNama = [
            'Januari','Februari','Maret','April','Mei','Juni',
            'Juli','Agustus','September','Oktober','November','Desember'
        ];

        const now = new Date();
        let bulan = now.getMonth();
        let tahun = now.getFullYear();

        if (paramBulan) {
            const idx = bulanNama.findIndex(b => b.toLowerCase() === paramBulan.toLowerCase());
            if (idx !== -1) bulan = idx;
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
            const r = absensi.find(a =>
                moment(a.tanggal).format('YYYY-MM-DD') === dateObj.format('YYYY-MM-DD')
            );

            rows.push(
                user.template_export === 'LMD'
                    ? `<tr style="background-color: ${
                        [0,6].includes(dateObj.day()) ? '#f15a5a' : '#FFFFFF'
                    }">
                        <td>${formatTanggalLMD(dateObj)}</td>
                        <td>${hariIndonesia(dateObj)}</td>
                        <td>${r?.jam_masuk || '-'}</td>
                        <td>${r?.jam_pulang || '-'}</td>
                        <td>${r?.deskripsi || '-'}</td>
                    </tr>`
                    : `<tr style="background-color: ${
                        [0,6].includes(dateObj.day()) ? '#f0f0f0' : '#FFFFFF'
                    }">
                        <td>${i}</td>
                        <td>${r?.jam_masuk || ''}</td>
                        <td>${r?.jam_pulang || ''}</td>
                        <td>${
                            [0,6].includes(dateObj.day()) ? '<b>LIBUR</b>' : (r?.deskripsi || '')
                        }</td>
                        <td></td>
                    </tr>`
            );
        }

        /* =============================
           LOGO → BASE64
        ============================= */
        const logoFile = path.join(
            __dirname,
            `../assets/logo/${user.template_export.toLowerCase()}.png`
        );

        let logoBase64 = '';
        if (fs.existsSync(logoFile)) {
            logoBase64 =
                'data:image/png;base64,' +
                fs.readFileSync(logoFile).toString('base64');
        }

        /* =============================
           TTD USER → BASE64
           ❌ Tetap boleh kosong saat export
        ============================= */
        const ttdPng = path.join(ttdFolder, `${user.wa_number}.png`);
        const ttdJpg = path.join(ttdFolder, `${user.wa_number}.jpg`);
        let ttdUserBase64 = '';
        if (fs.existsSync(ttdPng)) ttdUserBase64 = fs.readFileSync(ttdPng).toString('base64');
        else if (fs.existsSync(ttdJpg)) ttdUserBase64 = fs.readFileSync(ttdJpg).toString('base64');

        const ttdUserHTML = ttdUserBase64
            ? `<img src="data:image/png;base64,${ttdUserBase64}" style="max-width:150px; max-height:80px;" />`
            : '';

        const templatePath = path.join(
            __dirname,
            `../templates/absensi/${user.template_export}.html`
        );

        const template = fs.readFileSync(templatePath, 'utf8');

        const html = template
            .replace(/{{logo}}/g, logoBase64)
            .replace(/{{nama}}/g, user.nama_lengkap)
            .replace(/{{jabatan}}/g, user.jabatan)
            .replace(/{{nik}}/g, user.nik)
            .replace(/{{periode}}/g, periode)
            .replace(/{{rows_absensi}}/g, rows.join(''))
            .replace(/{{ttd_user}}/g, ttdUserHTML);

        const exportsDir = path.join(__dirname, '../exports');
        if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });

        const templateRaw = user.template_export || 'LMD';
        const templateHTML = templateRaw.toUpperCase();

        const pdfFile = path.join(
            exportsDir,
            `ABSENSI-${user.nama_lengkap}-${templateHTML}.pdf`
        );
        const htmlFile = path.join(
            exportsDir,
            `ABSENSI-${user.nama_lengkap}-${templateHTML}.html`
        );

        // simpan HTML supaya bisa generate ulang dengan TTD saat approve
        fs.writeFileSync(htmlFile, html, 'utf8');

        await generatePDF(html, pdfFile);

        const [approver] = await query(
            `SELECT wa_number, nama_lengkap, nik FROM users WHERE jabatan='spv' LIMIT 1`
        );

        await query(
            `INSERT INTO approvals 
            (user_id, approver_wa, file_path, status, ttd_user_at, nama_atasan, nik_atasan)
            VALUES (?, ?, ?, 'pending', NOW(), ?, ?)`,
            [user.id, approver?.wa_number || null, pdfFile, approver?.nama_lengkap || null, approver?.nik || null]
        );

        await chat.sendMessage(MessageMedia.fromFilePath(pdfFile));
        await sendTyping(chat, 'Laporan berhasil dibuat.');

    } catch (err) {
        console.error('PDF ERROR:', err);
        return sendTyping(chat, 'Terjadi kesalahan saat membuat PDF.');
    }
}
