const fs = require('fs');
const path = require('path');
const moment = require('moment');
const generatePDF = require('../utils/pdfGenerator');
const { MessageMedia } = require('whatsapp-web.js');
const { sendTyping } = require('../utils/sendTyping');

module.exports = async function handleExport(chat, user, pesan, db, paramBulan = null) {
    if (!db) return chat.sendMessage('Database tidak tersedia.');

    const query = (sql, params) => new Promise((res, rej) => {
        db.query(sql, params, (err, result) => err ? rej(err) : res(result));
    });

    // Ambil data user terbaru
    const userData = await query(`SELECT * FROM users WHERE id=?`, [user.id]);
    if (!userData || userData.length === 0)
        return sendTyping(chat, 'Data user tidak ditemukan.');

    user = { ...user, ...userData[0] };

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
    if (!user.nama_lengkap && !stepNow && !user.has_done_export) {
        await query(`UPDATE users SET step_input='confirm_name' WHERE id=?`, [user.id]);
        return sendTyping(
            chat,
            `Untuk membuat laporan PDF, aku perlu beberapa data ya.\n\n` +
            `Apakah benar nama kamu *${user.nama_wa}*? (iya/tidak)`
        );
    }

    if (stepNow === 'confirm_name' && pesan) {
        const jawab = pesan.toLowerCase();

        if (jawab === 'iya' || jawab === 'benar') {
            await query(
                `UPDATE users SET nama_lengkap=?, step_input=NULL WHERE id=?`,
                [user.nama_wa, user.id]
            );
            user.nama_lengkap = user.nama_wa;
            stepNow = null;
        } else if (jawab === 'tidak') {
            await query(`UPDATE users SET step_input='nama_lengkap' WHERE id=?`, [user.id]);
            return sendTyping(chat, `Silakan isi ${labels.nama_lengkap}:`);
        } else {
            return sendTyping(chat, `Balas dengan *iya* atau *tidak* ya.`);
        }
    }

    // =============================
    // STEP 2: CEK DATA KOSONG
    // =============================
    const missingFields = fields.filter(f => !user[f]);
    if (missingFields.length > 0 && !stepNow) {
        await query(
            `UPDATE users SET step_input=? WHERE id=?`,
            [missingFields[0], user.id]
        );
        await sendTyping(chat, `Datamu masih ada yang kurang 🙏`, 800);
        return sendTyping(chat, `Silakan isi ${labels[missingFields[0]]}:`);
    }

    // =============================
    // STEP 3: INPUT DATA SATU-SATU
    // =============================
    if (stepNow && fields.includes(stepNow) && pesan) {
        await query(
            `UPDATE users SET ${stepNow}=? WHERE id=?`,
            [pesan, user.id]
        );
        user[stepNow] = pesan;

        const nextStep = fields.find(f => !user[f]);
        if (nextStep) {
            await query(
                `UPDATE users SET step_input=? WHERE id=?`,
                [nextStep, user.id]
            );
            return sendTyping(chat, `Silakan isi ${labels[nextStep]}:`);
        }

        await query(`UPDATE users SET step_input=NULL WHERE id=?`, [user.id]);
        stepNow = null;
    }

    // =============================
    // STEP 4: PILIH TEMPLATE
    // =============================
    if (fields.every(f => user[f]) && !user.template_export && !stepNow) {
        await query(
            `UPDATE users SET step_input='choose_template' WHERE id=?`,
            [user.id]
        );
        return sendTyping(
            chat,
            `Mau pakai template apa untuk laporan?\n\n` +
            `1️⃣ KSPS\n2️⃣ LMD\n\n` +
            `Balas dengan *ksps* atau *lmd*`
        );
    }

    if (stepNow === 'choose_template' && pesan) {
        const tpl = pesan.toLowerCase();

        if (tpl !== 'ksps' && tpl !== 'lmd') {
            return sendTyping(chat, `Pilihan tidak valid.\nBalas *ksps* atau *lmd*`);
        }

        await query(
            `UPDATE users SET template_export=?, step_input=NULL WHERE id=?`,
            [tpl.toUpperCase(), user.id]
        );

        user.template_export = tpl.toUpperCase();
        return generatePDFandSend(chat, user, db, paramBulan);
    }

    // =============================
    // STEP 5: LANGSUNG GENERATE
    // =============================
    if (fields.every(f => user[f]) && user.template_export) {
        return generatePDFandSend(chat, user, db, paramBulan);
    }
};

// ======================================================
// FUNGSI GENERATE PDF SESUAI TEMPLATE
// ======================================================
async function generatePDFandSend(chat, user, db, paramBulan = null) {
    const namaBulanArr = [
        'Januari','Februari','Maret','April','Mei','Juni',
        'Juli','Agustus','September','Oktober','November','Desember'
    ];

    const now = new Date();
    let bulan = now.getMonth();
    let tahun = now.getFullYear();

    if (paramBulan) {
        const idx = namaBulanArr.findIndex(
            b => b.toLowerCase() === paramBulan.toLowerCase()
        );
        if (idx >= 0) bulan = idx;
    }

    const jumlahHari = new Date(tahun, bulan + 1, 0).getDate();
    user.periode = `1 - ${jumlahHari} ${namaBulanArr[bulan]} ${tahun}`;

    const query = (sql, params) => new Promise((res, rej) => {
        db.query(sql, params, (err, result) => err ? rej(err) : res(result));
    });

    const absensiData = await query(
        `SELECT * FROM absensi 
         WHERE user_id=? AND MONTH(tanggal)=? AND YEAR(tanggal)=?
         ORDER BY tanggal`,
        [user.id, bulan + 1, tahun]
    );

    const absensiByDate = [];
    for (let i = 1; i <= jumlahHari; i++) {
        const tgl = moment(`${tahun}-${bulan + 1}-${i}`, 'YYYY-M-D')
            .format('YYYY-MM-DD');

        const record = absensiData.find(
            a => moment(a.tanggal).format('YYYY-MM-DD') === tgl
        );

        absensiByDate.push({
            tanggal: tgl,
            jam_masuk: record?.jam_masuk || '',
            jam_pulang: record?.jam_pulang || '',
            deskripsi: record?.deskripsi || ''
        });
    }

    const rows_absensi = absensiByDate.map(a => `
        <tr>
            <td>${moment(a.tanggal).format('DD')}</td>
            <td>${a.jam_masuk}</td>
            <td>${a.jam_pulang}</td>
            <td>${a.deskripsi}</td>
            <td></td>
        </tr>
    `).join('');

    const templateName = user.template_export === 'LMD' ? 'LMD' : 'KSPS';

    const template = fs.readFileSync(
        path.join(__dirname, `../templates/${templateName}.html`),
        'utf8'
    );

    const logoBase64 = fs.readFileSync(
        path.join(__dirname, `../assets/${templateName.toLowerCase()}.png`),
        'base64'
    );

    const html = template
        .replaceAll('{{logo_path}}', `data:image/png;base64,${logoBase64}`)
        .replaceAll('{{nama}}', user.nama_lengkap)
        .replaceAll('{{jabatan}}', user.jabatan)
        .replaceAll('{{divisi}}', user.divisi)
        .replaceAll('{{nik}}', user.nik)
        .replaceAll('{{periode}}', user.periode)
        .replaceAll('{{rows_absensi}}', rows_absensi);

    await sendTyping(chat, 'File sedang disiapkan...', 1500);

    const fileName = `${user.nama_lengkap}-${templateName}-${namaBulanArr[bulan]}.pdf`;
    const outputPath = path.join(__dirname, '../exports', fileName);

    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);

    await generatePDF(html, outputPath);

    const media = MessageMedia.fromFilePath(outputPath);
    await chat.sendMessage(media);

    await query(`UPDATE users SET has_done_export=1 WHERE id=?`, [user.id]);

    return sendTyping(chat, `Laporan berhasil dibuat`);
}
