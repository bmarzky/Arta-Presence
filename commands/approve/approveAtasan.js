// approveAtasan.js
const { MessageMedia } = require('whatsapp-web.js');
const { sendTyping } = require('../../utils/sendTyping');
const path = require('path');
const fs = require('fs');
const moment = require('moment');
const generatePDF = require('../../utils/pdfGenerator');

module.exports = async function approveAtasan(chat, user, pesan, db) {
    const query = (sql, params = []) =>
        new Promise((resolve, reject) => db.query(sql, params, (err, res) => err ? reject(err) : resolve(res)));

    const rawText = pesan || '';
    const text = rawText.trim().toLowerCase();

    try {
        // Data Atasan
        const [atasan] = await query(`SELECT * FROM users WHERE wa_number=? LIMIT 1`, [user.wa_number]);
        if (!atasan) return sendTyping(chat, 'Data atasan tidak ditemukan.');

        // Daftar approval pending/revised
        const approvals = await query(`
            SELECT a.*,
                   u.wa_number AS user_wa,
                   u.nama_lengkap AS user_nama,
                   u.nik AS user_nik,
                   u.jabatan AS user_jabatan,
                   u.template_export,
                   u.export_type
            FROM approvals a
            JOIN users u ON u.id = a.user_id
            WHERE a.approver_wa=? 
              AND a.status IN ('pending','revised')
            ORDER BY a.created_at ASC
        `, [user.wa_number]);

        if (!approvals.length) return sendTyping(chat, 'Tidak ada laporan yang menunggu approval.');

        // Jika user ingin melihat status
        if (text === 'status') {
            let msg = '*Daftar Laporan Pending / Revisi:*\n\n';
            approvals.forEach((a, i) => {
                msg += `${i+1}. ${a.user_nama} (${a.export_type}) - Status: ${a.status}\n`;
            });
            return sendTyping(chat, msg);
        }

        // parsing format
        const match = rawText.trim().match(/^(approve|revisi)\s+([^-]+)-(.+)$/i);

        let action, export_type, namaUser, approval;
        if (match) {
                    action = match[1].toLowerCase();
                    export_type = match[2].trim().toLowerCase();
                    namaUser = match[3].trim().toLowerCase();

            // cari approval sesuai export_type + nama user
                    approval = approvals.find(a =>
                        a.export_type.toLowerCase() === export_type &&
                        a.user_nama.toLowerCase() === namaUser
                    );

            if (!approval)
                return sendTyping(chat, `Tidak ditemukan laporan ${export_type}-${namaUser} yang menunggu approval/revisi.`);

            // update userWA sesuai approval terpilih
            var userWA = approval.user_wa.includes('@') ? approval.user_wa : approval.user_wa + '@c.us';
        } else {
            return sendTyping(chat, 'Format salah. Contoh:\napprove lembur-Bima Rizki\nrevisi absensi-Asep');
        }

        // ====== REVISI (alasan_revisi) ======
        if (approval.step_input === 'alasan_revisi') {
            if (approval.status !== 'revised')
                return sendTyping(chat, 'Status laporan tidak valid untuk revisi.');

            if (rawText.trim().length < 3)
                return sendTyping(chat, 'Silakan ketik *alasan revisi* yang jelas.');

            await query(`UPDATE approvals SET revisi_catatan=?, step_input=NULL WHERE id=?`,
                        [rawText.trim(), approval.id]);

            await chat.client.sendMessage(
                userWA,
                `*LAPORAN PERLU REVISI*\n\n` +
                `Approval: *${atasan.nama_lengkap}*\n\n` +
                `*Catatan revisi:*\n${rawText.trim()}\n\n` +
                `Silakan perbaiki dan lakukan */export* ulang.`
            );

            return sendTyping(chat, 'Revisi berhasil dikirim.');
        }

        // ====== MULAI REVISI ======
        if (action === 'revisi') {
            if (approval.status !== 'pending')
                return sendTyping(chat, 'Laporan sudah direvisi atau tidak bisa direvisi lagi.');

            await query(`UPDATE approvals SET status='revised', step_input='alasan_revisi' WHERE id=?`, [approval.id]);
            return sendTyping(chat, `Silakan ketik *alasan revisi* untuk ${export_type}-${namaUser}.`);
        }

        // ====== APPROVE ======
        if (action === 'approve') {
            if (approval.status !== 'pending')
                return sendTyping(chat, 'Laporan ini tidak bisa di-approve karena sudah direvisi.');

            // Normalisasi template
            const templateRaw = approval.template_export || 'LMD';
            const templateName = templateRaw.toUpperCase();
            const templateLogo = templateRaw.toLowerCase();

            // Logo
            let logoBase64 = '';
            let logoPath = path.join(__dirname, '../../assets/logo', `${templateLogo}.png`);
            if (!fs.existsSync(logoPath)) logoPath = path.join(__dirname, '../../assets/logo/default.png');
            if (fs.existsSync(logoPath)) logoBase64 = fs.readFileSync(logoPath, 'base64');

            // TTD atasan
            let ttdAtasanBase64 = '';
            const ttdPng = path.join(__dirname, '../../assets/ttd', `${atasan.wa_number}.png`);
            const ttdJpg = path.join(__dirname, '../../assets/ttd', `${atasan.wa_number}.jpg`);
            if (fs.existsSync(ttdPng)) ttdAtasanBase64 = fs.readFileSync(ttdPng, 'base64');
            else if (fs.existsSync(ttdJpg)) ttdAtasanBase64 = fs.readFileSync(ttdJpg, 'base64');

            if (!ttdAtasanBase64 && approval.step_input !== 'ttd_atasan') {
                await sendTyping(chat, 'Silakan kirim foto TTD kamu untuk approve laporan ini.');
                await query(`UPDATE approvals SET step_input='ttd_atasan' WHERE id=?`, [approval.id]);
                return;
            }

            if (ttdAtasanBase64 && approval.step_input === 'ttd_atasan') {
                await query(`UPDATE approvals SET step_input=NULL WHERE id=?`, [approval.id]);
            }

            // TTD User
            let ttdUserBase64 = '';
            const ttdUserPng = path.join(__dirname, '../../assets/ttd', `${approval.user_wa}.png`);
            const ttdUserJpg = path.join(__dirname, '../../assets/ttd', `${approval.user_wa}.jpg`);
            if (fs.existsSync(ttdUserPng)) ttdUserBase64 = fs.readFileSync(ttdUserPng, 'base64');
            else if (fs.existsSync(ttdUserJpg)) ttdUserBase64 = fs.readFileSync(ttdUserJpg, 'base64');

            // Generate PDF
            let outputPath;
            if (approval.export_type === 'lembur') {
                outputPath = await generatePDFLemburForAtasan(approval, db, ttdAtasanBase64, ttdUserBase64);
            } else {
                outputPath = await generatePDFForAtasan(approval, db, ttdAtasanBase64, ttdUserBase64);
            }

            // Update status approved
            await query(`UPDATE approvals SET status='approved', file_path=? WHERE id=?`, [outputPath, approval.id]);

            await chat.client.sendMessage(userWA, MessageMedia.fromFilePath(outputPath));
            await chat.client.sendMessage(userWA,
                `*Laporan ${approval.export_type.toUpperCase()} Berhasil Di-Approve*\n\n` +
                `Halo *${approval.user_nama}*,\n` +
                `Laporan kamu telah *DISETUJUI* oleh *${atasan.nama_lengkap}*.\n\n` +
                `Terima kasih.`
            );

            return sendTyping(chat, `Approval berhasil dikirim ke *${approval.user_nama}*.`);
        }

    } catch (err) {
        console.error(err);
        return sendTyping(chat, 'Terjadi error pada sistem approval.');
    }
};


// Fungsi generate PDF untuk atasan - absensi
async function generatePDFForAtasan(approval, db, ttdAtasanBase64, ttdUserBase64) {
    const fs = require('fs');
    const path = require('path');
    const generatePDF = require('../../utils/pdfGenerator');
    const moment = require('moment');

    const templateName = approval.template_export;

    // helper query
    const query = (sql, params = []) =>
        new Promise((res, rej) => db.query(sql, params, (err, r) => err ? rej(err) : res(r)));

    // ambil absensi
    const now = new Date();
    const bulan = now.getMonth() + 1;
    const tahun = now.getFullYear();
    const totalHari = new Date(tahun, bulan, 0).getDate();

    const absensi = await query(
        `SELECT * FROM absensi WHERE user_id=? AND MONTH(tanggal)=? AND YEAR(tanggal)=? ORDER BY tanggal`,
        [approval.user_id, bulan, tahun]
    );

    // template HTML
    const templatePath = path.join(__dirname, `../../templates/absensi/${templateName}.html`);
    if (!fs.existsSync(templatePath)) throw new Error(`Template ${templateName}.html tidak ditemukan.`);
    let html = fs.readFileSync(templatePath, 'utf8');

    // rows absensi
    const rows = [];
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
    const ttdUserHTML = ttdUserBase64
        ? `<img src="data:image/png;base64,${ttdUserBase64}" style="max-width:150px; max-height:150px;" />`
        : '';

    // TTD atasan
    const ttdAtasanHTML = `<img src="data:image/png;base64,${ttdAtasanBase64}" style="max-width:150px; max-height:150px;" />`;

    html = html.replace(/{{logo}}/g, logoBase64)
               .replace(/{{nama}}/g, approval.user_nama)
               .replace(/{{jabatan}}/g, approval.user_jabatan || '')
               .replace(/{{nik}}/g, approval.user_nik || '')
               .replace(/{{periode}}/g, `${1}-${totalHari} ${moment().format('MMMM YYYY')}`)
               .replace(/{{rows_absensi}}/g, rows.join(''))
               .replace(/{{ttd_user}}/g, ttdUserHTML)
               .replace(/{{ttd_atasan}}/g, ttdAtasanHTML)
               .replace(/{{nama_atasan}}/g, approval.nama_atasan || 'Atasan')
               .replace(/{{nik_atasan}}/g, approval.nik_atasan || '');

    // export PDF
    const exportsDir = path.join(__dirname, '../../exports');
    if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });
    const outputPath = path.join(exportsDir, `ABSENSI-${approval.user_nama}-${templateName}-Approve.pdf`);

    await generatePDF(html, outputPath);
    return outputPath;
}

// Fungsi generate PDF untuk atasan - lembur
async function generatePDFLemburForAtasan(chat, approval, db, ttdAtasanBase64, ttdUserBase64) {
    const fs = require('fs');
    const path = require('path');
    const generatePDF = require('../../utils/pdfGenerator');
    const moment = require('moment');

    const templateName = approval.template_export || 'LMD';
    const bulanNama = [
        'Januari','Februari','Maret','April','Mei','Juni',
        'Juli','Agustus','September','Oktober','November','Desember'
    ];

    // Ambil semua data lembur user
    const lemburData = await new Promise((resolve, reject) =>
        db.query(
            `SELECT YEAR(tanggal) AS tahun, MONTH(tanggal) AS bulan, * 
             FROM lembur WHERE user_id=? ORDER BY tanggal`,
            [approval.user_id],
            (err, res) => err ? reject(err) : resolve(res)
        )
    );
    if (!lemburData.length) throw new Error('Belum ada data lembur.');

    // Ambil info atasan (jika belum tersedia di approval)
    let approverNama = approval.nama_atasan || '-';
    let approverNik  = approval.nik_atasan || '-';
    let approverWA   = null;

    if(!approval.nama_atasan){
        const [approver] = await new Promise((resolve, reject) =>
            db.query(`SELECT * FROM users WHERE jabatan='Head' LIMIT 1`,
            (err,res)=>err?reject(err):resolve(res))
        );
        approverNama = approver?.nama_lengkap || '-';
        approverNik  = approver?.nik || '-';
        approverWA   = approver?.wa_number || null;
    }

    // TTD User & Atasan
    const ttdUserHTML = ttdUserBase64
        ? `<img src="data:image/png;base64,${ttdUserBase64}" style="max-width:150px;max-height:150px;">`
        : '';
    const ttdAtasanHTML = ttdAtasanBase64
        ? `<img src="data:image/png;base64,${ttdAtasanBase64}" style="max-width:150px;max-height:150px;">`
        : '';

    // Logo
    const logoFile = path.join(__dirname, `../../assets/logo/${templateName.toLowerCase()}.png`);
    const logoBase64 = fs.existsSync(logoFile) 
        ? 'data:image/png;base64,' + fs.readFileSync(logoFile).toString('base64')
        : '';

    // Group data by bulan
    const grouped = {};
    for(const l of lemburData){
        const key = `${l.tahun}-${l.bulan}`;
        if(!grouped[key]) grouped[key] = [];
        grouped[key].push(l);
    }

    // Prioritas bulan sekarang
    const now = new Date();
    const currentKey = `${now.getFullYear()}-${now.getMonth() + 1}`;
    const keysToGenerate = grouped[currentKey]
        ? [currentKey]
        : Object.keys(grouped).sort().slice(-1); // ambil bulan terakhir jika bulan sekarang kosong

    const exportsDir = path.join(__dirname, '../../exports');
    if(!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir,{recursive:true});

    // Loop per bulan untuk generate PDF
    for(const key of keysToGenerate){
        const dataBulan = grouped[key];
        const sample = dataBulan[0];
        const bulanIdx = sample.bulan - 1;
        const tahun = sample.tahun;

        const periode = templateName === 'LMD'
            ? `${bulanNama[bulanIdx]} ${tahun}`
            : `1 - ${new Date(tahun, bulanIdx+1, 0).getDate()} ${bulanNama[bulanIdx]} ${tahun}`;

        let rows = '';
        let totalLemburDecimal = 0;

        if(templateName === 'KSPS'){
            const totalHari = new Date(tahun, bulanIdx+1, 0).getDate();
            for(let i=1;i<=totalHari;i++){
                const dateObj = moment(`${tahun}-${bulanIdx+1}-${i}`, 'YYYY-M-D');
                const l = dataBulan.find(x =>
                    moment(x.tanggal).format('YYYY-MM-DD') === dateObj.format('YYYY-MM-DD')
                );

                let totalJam = '';
                if(l?.total_lembur){
                    const [h,m=0] = l.total_lembur.includes(':')
                        ? l.total_lembur.split(':').map(Number)
                        : [parseFloat(l.total_lembur),0];

                    const jam = h + m/60;
                    totalLemburDecimal += jam;
                    totalJam = `${jam % 1 === 0 ? jam : jam.toFixed(1)} Jam`;
                }

                rows += `<tr>
<td>${i}</td>
<td>${l?.jam_mulai||''}</td>
<td>${l?.jam_selesai||''}</td>
<td>${totalJam}</td>
<td>${l?.deskripsi||''}</td>
<td></td>
</tr>`;
            }
        } else { // LMD
            for(const l of dataBulan){
                let jam = 0;
                if(l.total_lembur){
                    const [h,m=0] = l.total_lembur.includes(':')
                        ? l.total_lembur.split(':').map(Number)
                        : [parseFloat(l.total_lembur),0];

                    jam = h + m/60;
                    totalLemburDecimal += jam;
                }

                rows += `<tr>
<td>${moment(l.tanggal).format('DD/MM/YYYY')}</td>
<td>${moment(l.tanggal).locale('id').format('dddd')}</td>
<td>${l.jam_mulai||'-'}</td>
<td>${l.jam_selesai||'-'}</td>
<td>${jam ? (jam % 1 === 0 ? jam : jam.toFixed(1))+' Jam' : '-'}</td>
<td>${l.deskripsi||'-'}</td>
</tr>`;
            }
        }

        const totalLembur = `${totalLemburDecimal % 1 === 0 ? totalLemburDecimal : totalLemburDecimal.toFixed(1)} Jam`;

        // Generate HTML
        const templatePath = path.join(__dirname, `../../templates/lembur/${templateName}.html`);
        if(!fs.existsSync(templatePath)) throw new Error(`Template ${templateName}.html tidak ditemukan`);
        let html = fs.readFileSync(templatePath,'utf8');

        html = html
            .replace(/{{logo}}/g, logoBase64)
            .replace(/{{rows_lembur}}/g, rows)
            .replace(/{{periode}}/g, periode)
            .replace(/{{nama}}/g, approval.user_nama || '-')
            .replace(/{{jabatan}}/g, approval.user_jabatan || '-')
            .replace(/{{nik}}/g, approval.user_nik || '-')
            .replace(/{{ttd_user}}/g, ttdUserHTML)
            .replace(/{{ttd_atasan}}/g, ttdAtasanHTML)
            .replace(/{{nama_atasan}}/g, approverNama)
            .replace(/{{nik_atasan}}/g, approverNik)
            .replace(/{{total_lembur}}/g, totalLembur);

        const pdfFile = path.join(exportsDir, `LEMBUR-${approval.user_nama}-${templateName}-${bulanNama[bulanIdx]}-${tahun}.pdf`);
        await generatePDF(html, pdfFile);
    }

    return `PDF lembur untuk ${approval.user_nama} berhasil dibuat per bulan.`;
}
