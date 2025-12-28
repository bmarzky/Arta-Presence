// approveUser.js
const { MessageMedia } = require('whatsapp-web.js');
const { sendTyping } = require('../../utils/sendTyping');
const getGreeting = require('../../data/greetingTime');
const fs = require('fs');
const path = require('path');
const generatePDF = require('../../utils/pdfGenerator');
const moment = require('moment');

// folder TTD
const ttdFolder = path.join(__dirname, '../../assets/ttd/');
if (!fs.existsSync(ttdFolder)) fs.mkdirSync(ttdFolder, { recursive: true });

module.exports = async function approveUser(chat, user, db) {
    const query = (sql, params = []) =>
        new Promise((res, rej) =>
            db.query(sql, params, (e, r) => (e ? rej(e) : res(r)))
        );

    const nama_user = user.pushname || user.nama_wa || 'Arta';
    const user_id = user.id;
    const wa_number = user.wa_number;

    if (!user_id)
        return sendTyping(chat, 'ID user tidak tersedia.');

    try {
        // Ambil approval terakhir
        const [approval] = await query(
            `SELECT * FROM approvals WHERE user_id=? ORDER BY created_at DESC LIMIT 1`,
            [user_id]
        );

        if (!approval || !approval.file_path)
            return sendTyping(chat, 'Kamu belum menyiapkan laporan. Silakan ketik */export* terlebih dahulu.');

        if (approval.status === 'revised')
            return sendTyping(chat, 'Laporan perlu revisi. Silakan export ulang.');
        if (approval.status === 'approved')
            return sendTyping(chat, 'Laporan bulan ini sudah disetujui.');
        if (approval.status !== 'pending')
            return sendTyping(chat, 'Laporan tidak dalam status pending approval.');

        // cek TTD user
        const ttdPng = path.join(ttdFolder, `${wa_number}.png`);
        const ttdJpg = path.join(ttdFolder, `${wa_number}.jpg`);
        let ttdFile = '';
        if (fs.existsSync(ttdPng)) ttdFile = ttdPng;
        else if (fs.existsSync(ttdJpg)) ttdFile = ttdJpg;

        if (!ttdFile)
            return sendTyping(chat, `Kamu belum mengirim tanda tangan.`);

        // Ambil data atasan untuk dimasukkan ke PDF
        const nama_atasan = approval.nama_atasan || 'Atasan';
        const nik_atasan = approval.nik_atasan || '';

        // generate ulang PDF dari DB + template
        let updatedFilePath;
        if (user.export_type === 'lembur') {
            updatedFilePath = await generatePDFLemburwithTTD(user, db, ttdFile, approval.template_export, nama_atasan, nik_atasan);
        } else {
            updatedFilePath = await generatePDFwithTTD(user, db, ttdFile, approval.template_export, nama_atasan, nik_atasan);
        }

        // kirim ke atasan
        let approverWA = approval.approver_wa;
        if (!approverWA) return sendTyping(chat, 'Nomor approver belum disetel.');
        if (!approverWA.includes('@')) approverWA += '@c.us';

        const media = MessageMedia.fromFilePath(updatedFilePath);
        const greeting = getGreeting() || '';
        const jenis_laporan = approval.export_type === 'lembur' ? 'Lembur' : 'Absensi';

        await chat.client.sendMessage(
            approverWA,
            `*Permintaan Approval Laporan ${jenis_laporan}*\n\n${greeting} *${nama_atasan}*\n\n` +
            `*${nama_user}* meminta permohonan approval untuk laporan ${jenis_laporan.toLowerCase()}.\nMohon untuk diperiksa.`
        );
        await chat.client.sendMessage(approverWA, media);
        await chat.client.sendMessage(
            approverWA,
            `Silakan ketik:\n• *approve*\n• *revisi*`
        );

        return sendTyping(chat, `*${nama_user}*, laporan berhasil dikirim ke *${nama_atasan}* untuk proses approval.`);

    } catch (err) {
        console.error('Gagal kirim approval:', err);
        return sendTyping(chat, 'Terjadi kesalahan saat mengirim approval.');
    }
};

// pdf absensi
async function generatePDFwithTTD(user, db, ttdFile, templateName, namaAtasan='Atasan', nikAtasan='') {
    const query = (sql, params = []) =>
        new Promise((res, rej) => db.query(sql, params, (err, r) => err ? rej(err) : res(r)));

    // ambil absensi
    const now = new Date();
    const bulan = now.getMonth() + 1;
    const tahun = now.getFullYear();
    const absensi = await query(
        `SELECT * FROM absensi WHERE user_id=? AND MONTH(tanggal)=? AND YEAR(tanggal)=? ORDER BY tanggal`,
        [user.id, bulan, tahun]
    );

    // template HTML
    const templatePath = path.join(__dirname, `../../templates/absensi/${templateName}.html`);
    let html = fs.readFileSync(templatePath, 'utf8');

    // rows absensi
    const rows = [];
    const totalHari = new Date(tahun, bulan, 0).getDate();
    for (let i = 1; i <= totalHari; i++) {
        const dateObj = moment(`${tahun}-${bulan}-${i}`, 'YYYY-M-D');
        const r = absensi.find(a => moment(a.tanggal).format('YYYY-MM-DD') === dateObj.format('YYYY-MM-DD'));
        rows.push(
            templateName === 'LMD'
                ? `<tr style="background-color:${[0,6].includes(dateObj.day())?'#f15a5a':'#FFF'}">
                     <td>${dateObj.format('DD/MM/YYYY')}</td>
                     <td>${dateObj.format('dddd')}</td>
                     <td>${r?.jam_masuk||'-'}</td>
                     <td>${r?.jam_pulang||'-'}</td>
                     <td>${r?.deskripsi||'-'}</td>
                   </tr>`
                : `<tr style="background-color:${[0,6].includes(dateObj.day())?'#f0f0f0':'#FFF'}">
                     <td>${i}</td>
                     <td>${r?.jam_masuk||''}</td>
                     <td>${r?.jam_pulang||''}</td>
                     <td>${[0,6].includes(dateObj.day())?'<b>LIBUR</b>':(r?.deskripsi||'')}</td>
                     <td></td>
                   </tr>`
        );
    }

    // logo
    const logoFile = path.join(__dirname, `../../assets/logo/${templateName.toLowerCase()}.png`);
    const logoBase64 = fs.existsSync(logoFile)
        ? 'data:image/png;base64,' + fs.readFileSync(logoFile).toString('base64')
        : '';

    // TTD user
    const ttdBase64 = fs.readFileSync(ttdFile).toString('base64');
    const ttdHTML = `<img src="data:image/png;base64,${ttdBase64}" style="max-width:150px; max-height:150px;" />`;

    html = html.replace(/{{logo}}/g, logoBase64)
               .replace(/{{nama}}/g, user.nama_lengkap)
               .replace(/{{jabatan}}/g, user.jabatan)
               .replace(/{{nik}}/g, user.nik)
               .replace(/{{periode}}/g, `${1}-${totalHari} ${moment().format('MMMM YYYY')}`)
               .replace(/{{rows_absensi}}/g, rows.join(''))
               .replace(/{{ttd_user}}/g, ttdHTML)
               .replace(/{{nama_atasan}}/g, namaAtasan)
               .replace(/{{nik_atasan}}/g, nikAtasan);

    // export PDF
    const exportsDir = path.join(__dirname, '../../exports');
    if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });
    const output = path.join(exportsDir, `ABSENSI-${user.nama_lengkap}-${templateName}.pdf`);

    await generatePDF(html, output);
    return output;
}

// pdf lembur
async function generatePDFLemburwithTTD(user, db, ttdFile, templateName, namaAtasan='Atasan', nikAtasan='') {
    const query = (sql, params = []) =>
        new Promise((res, rej) => db.query(sql, params, (err, r) => err ? rej(err) : res(r)));

    const lemburData = await query(`SELECT * FROM lembur WHERE user_id=? ORDER BY tanggal`, [user.id]);
    if (!lemburData.length) throw new Error('Belum ada data lembur untuk dibuat PDF.');

    const bulanNama = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

    const firstTanggal = new Date(lemburData[0].tanggal);

    let periode = '';
    if(templateName === 'LMD'){
        periode = `${bulanNama[firstTanggal.getMonth()]} ${firstTanggal.getFullYear()}`;
    } else {
        const totalHari = new Date(firstTanggal.getFullYear(), firstTanggal.getMonth() + 1, 0).getDate();
        periode = `1 - ${totalHari} ${bulanNama[firstTanggal.getMonth()]} ${firstTanggal.getFullYear()}`;
    }

    // Generate rows lembur dengan format total_lembur decimal + " Jam"
    const rows = [];
    let totalLemburDecimal = 0;

    if(templateName === 'LMD'){
        for(const l of lemburData){
            let jamDecimal = 0;
            if(l.total_lembur){
                if(l.total_lembur.includes(':')){
                    const [h,m] = l.total_lembur.split(':').map(Number);
                    jamDecimal = h + m/60;
                } else {
                    jamDecimal = parseFloat(l.total_lembur);
                }
                totalLemburDecimal += jamDecimal;
                l.total_lembur = `${Number.isInteger(jamDecimal) ? jamDecimal : jamDecimal.toFixed(1)} Jam`;
            }

            rows.push(`<tr>
                <td>${moment(l.tanggal).format('DD/MM/YYYY')}</td>
                <td>${moment(l.tanggal).locale('id').format('dddd')}</td>
                <td>${l.jam_mulai || '-'}</td>
                <td>${l.jam_selesai || '-'}</td>
                <td>${l.total_lembur || '-'}</td>
                <td>${l.deskripsi || '-'}</td>
            </tr>`);
        }
    } else { // KSPS
        const totalHari = new Date(firstTanggal.getFullYear(), firstTanggal.getMonth() + 1, 0).getDate();
        for(let i=1;i<=totalHari;i++){
            const dateObj = moment(`${firstTanggal.getFullYear()}-${firstTanggal.getMonth()+1}-${i}`, 'YYYY-M-D');
            const l = lemburData.find(l => moment(l.tanggal).format('YYYY-MM-DD') === dateObj.format('YYYY-MM-DD'));

            let totalJam = '';
            if(l?.total_lembur){
                let jamDecimal = 0;
                if(l.total_lembur.includes(':')){
                    const [h,m] = l.total_lembur.split(':').map(Number);
                    jamDecimal = h + m/60;
                } else {
                    jamDecimal = parseFloat(l.total_lembur);
                }
                totalLemburDecimal += jamDecimal;
                totalJam = `${Number.isInteger(jamDecimal) ? jamDecimal : jamDecimal.toFixed(1)} Jam`;
            }

            rows.push(`<tr>
                <td>${i}</td>
                <td>${l?.jam_mulai || ''}</td>
                <td>${l?.jam_selesai || ''}</td>
                <td>${totalJam}</td>
                <td>${l?.deskripsi || ''}</td>
                <td></td>
            </tr>`);
        }
    }

    const totalLemburKeseluruhan = `${Number.isInteger(totalLemburDecimal) ? totalLemburDecimal : totalLemburDecimal.toFixed(1)} Jam`;

    // Logo
    const logoFile = path.join(__dirname, `../../assets/logo/${templateName.toLowerCase()}.png`);
    const logoBase64 = fs.existsSync(logoFile)
        ? 'data:image/png;base64,' + fs.readFileSync(logoFile).toString('base64')
        : '';

    // TTD user
    const ttdBase64 = fs.readFileSync(ttdFile).toString('base64');
    const ttdHTML = `<img src="data:image/png;base64,${ttdBase64}" style="max-width:150px; max-height:150px;" />`;

    // Template HTML
    const templatePath = path.join(__dirname, `../../templates/lembur/${templateName}.html`);
    let htmlTemplate = fs.readFileSync(templatePath,'utf8');

    const html = htmlTemplate
        .replace(/{{rows_lembur}}/g, rows.join(''))
        .replace(/{{nama}}/g, user.nama_lengkap || '-')
        .replace(/{{jabatan}}/g, user.jabatan || '-')
        .replace(/{{nik}}/g, user.nik || '-')
        .replace(/{{periode}}/g, periode)
        .replace(/{{logo}}/g, logoBase64)
        .replace(/{{ttd_user}}/g, ttdHTML)
        .replace(/{{nama_atasan}}/g, namaAtasan)
        .replace(/{{nik_atasan}}/g, nikAtasan)
        .replace(/{{total_lembur}}/g, totalLemburKeseluruhan)
        .replace(/{{ttd_atasan}}/g, ''); // tetap kosong, TTD atasan ditambahkan saat approve

    // export PDF
    const exportsDir = path.join(__dirname,'../../exports');
    if(!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir,{recursive:true});
    const pdfFile = path.join(exportsDir, `LEMBUR-${user.nama_lengkap}-${templateName}.pdf`);
    fs.writeFileSync(path.join(exportsDir, `LEMBUR-${user.nama_lengkap}-${templateName}.html`), html, 'utf8');

    await generatePDF(html, pdfFile);
    return pdfFile;
}

