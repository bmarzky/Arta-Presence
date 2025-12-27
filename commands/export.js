const fs = require('fs');
const path = require('path');
const moment = require('moment');
const { MessageMedia } = require('whatsapp-web.js');
const { sendTyping } = require('../utils/sendTyping');
const generatePDF = require('../utils/pdfGenerator');

const ttdFolder = path.join(__dirname, '../assets/ttd/');

const formatTanggalLMD = (date) => {
    const d = new Date(date);
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
};

const hariIndonesia = (date) => moment(date).locale('id').format('dddd');

async function handleExport(chat, user, pesan, db, paramBulan=null) {
    if(!db || !user?.id) return;

    const query = (sql, params=[]) => new Promise((res, rej) =>
        db.query(sql, params, (err, result) => err ? rej(err) : res(result))
    );

    try {
        const [dbUser] = await query(`SELECT * FROM users WHERE id=?`, [user.id]);
        if(!dbUser) return;
        user = { ...user, ...dbUser };
        const nama_wa = user.pushname || user.nama_wa || 'Kak';
        const text = pesan.toLowerCase().trim();

        // Reset step saat /export
        if(text === '/export') {
            await query(`
                UPDATE users 
                SET step_input='start_export', template_export=NULL, export_type=NULL 
                WHERE id=?
            `, [user.id]);
            user.step_input = 'start_export';
            user.template_export = null;
            user.export_type = null;
        }

        // STEP 1: Pilih Jenis Export
        if(user.step_input === 'start_export') {
            await query(`UPDATE users SET step_input='choose_export_type' WHERE id=?`, [user.id]);
            user.step_input = 'choose_export_type';
            return sendTyping(chat,
                `Halo *${nama_wa}*, mau export *Absensi* atau *Lembur*?\nBalas *absensi* atau *lembur*`
            );
        }

        if(user.step_input === 'choose_export_type') {
            if(!['absensi','lembur'].includes(text)){
                return sendTyping(chat, 'Balas *absensi* atau *lembur* ya.');
            }

            await query(`UPDATE users SET step_input='choose_template', export_type=? WHERE id=?`, [text, user.id]);
            user.step_input = 'choose_template';
            user.export_type = text;

            return sendTyping(chat,
                `Pilih template untuk *${text.charAt(0).toUpperCase() + text.slice(1)}*:\n1. KSPS\n2. LMD\nBalas *ksps* atau *lmd*`
            );
        }

        // STEP 2: Pilih Template
        if(user.step_input === 'choose_template') {
            if(!['ksps','lmd'].includes(text)){
                return sendTyping(chat, 'Balas *ksps* atau *lmd* ya.');
            }

            await query(`UPDATE users SET template_export=? , step_input=NULL WHERE id=?`, [text.toUpperCase(), user.id]);
            user.template_export = text.toUpperCase();
            user.step_input = null;

            if(user.export_type === 'absensi'){
                await sendTyping(chat, `Sedang menyiapkan laporan absensi...`, 800);
                return generatePDFandSend(chat, user, db, paramBulan);
            } else {
                await sendTyping(chat, `Sedang menyiapkan laporan lembur...`, 800);
                return generatePDFLembur(chat, user, db);
            }
        }

    } catch(err) {
        console.error('EXPORT ERROR:', err);
        return sendTyping(chat, 'Terjadi kesalahan saat memproses export.');
    }
}

/* ==============================
   GENERATE PDF ABSENSI
============================== */
async function generatePDFandSend(chat, user, db, paramBulan){
    const query = (sql, params=[]) => new Promise((res, rej) => db.query(sql, params, (err,result)=>err?rej(err):res(result)));
    try{
        const bulanNama = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
        const now = new Date();
        let bulan = now.getMonth();
        let tahun = now.getFullYear();
        if(paramBulan){
            const idx = bulanNama.findIndex(b => b.toLowerCase() === paramBulan.toLowerCase());
            if(idx !== -1) bulan = idx;
        }

        const totalHari = new Date(tahun, bulan+1, 0).getDate();
        const periode = user.template_export === 'LMD' ? `${bulanNama[bulan]} ${tahun}` : `1 - ${totalHari} ${bulanNama[bulan]} ${tahun}`;

        const absensi = await query(`SELECT * FROM absensi WHERE user_id=? AND MONTH(tanggal)=? AND YEAR(tanggal)=? ORDER BY tanggal`, [user.id, bulan+1, tahun]);

        const rows = [];
        for(let i=1; i<=totalHari; i++){
            const dateObj = moment(`${tahun}-${bulan+1}-${i}`, 'YYYY-M-D');
            const r = absensi.find(a => moment(a.tanggal).format('YYYY-MM-DD') === dateObj.format('YYYY-MM-DD'));
            const isWeekend = [0,6].includes(dateObj.day());

            if(user.template_export === 'LMD'){
                rows.push(`<tr style="background-color:${isWeekend ? '#f15a5a' : '#FFFFFF'}">
                    <td>${formatTanggalLMD(dateObj)}</td>
                    <td>${hariIndonesia(dateObj)}</td>
                    <td>${r?.jam_masuk || '-'}</td>
                    <td>${r?.jam_pulang || '-'}</td>
                    <td>${r?.deskripsi || '-'}</td>
                </tr>`);
            } else {
                rows.push(`<tr style="background-color:${isWeekend ? '#f0f0f0' : '#FFFFFF'}">
                    <td>${i}</td>
                    <td>${r?.jam_masuk || ''}</td>
                    <td>${r?.jam_pulang || ''}</td>
                    <td>${isWeekend ? '<b>LIBUR</b>' : (r?.deskripsi || '')}</td>
                    <td></td>
                </tr>`);
            }
        }

        const logoFile = path.join(__dirname, `../assets/logo/${user.template_export.toLowerCase()}.png`);
        let logoBase64 = fs.existsSync(logoFile) ? 'data:image/png;base64,' + fs.readFileSync(logoFile).toString('base64') : '';

        const ttdPng = path.join(ttdFolder, `${user.wa_number}.png`);
        const ttdJpg = path.join(ttdFolder, `${user.wa_number}.jpg`);
        let ttdUserBase64 = '';
        if(fs.existsSync(ttdPng)) ttdUserBase64 = fs.readFileSync(ttdPng).toString('base64');
        else if(fs.existsSync(ttdJpg)) ttdUserBase64 = fs.readFileSync(ttdJpg).toString('base64');
        const ttdUserHTML = ttdUserBase64 ? `<img src="data:image/png;base64,${ttdUserBase64}" style="max-width:150px; max-height:80px;" />` : '';

        const templatePath = path.join(__dirname, `../templates/absensi/${user.template_export}.html`);
        const template = fs.readFileSync(templatePath,'utf8');

        const html = template
            .replace(/{{logo}}/g, logoBase64)
            .replace(/{{nama}}/g, user.nama_lengkap || '-')
            .replace(/{{jabatan}}/g, user.jabatan || '-')
            .replace(/{{nik}}/g, user.nik || '-')
            .replace(/{{periode}}/g, periode)
            .replace(/{{rows_absensi}}/g, rows.join(''))
            .replace(/{{ttd_user}}/g, ttdUserHTML);

        const exportsDir = path.join(__dirname,'../exports');
        if(!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir,{recursive:true});

        const pdfFile = path.join(exportsDir, `ABSENSI-${user.nama_lengkap}-${user.template_export}.pdf`);
        const htmlFile = path.join(exportsDir, `ABSENSI-${user.nama_lengkap}-${user.template_export}.html`);
        fs.writeFileSync(htmlFile, html, 'utf8');

        await generatePDF(html, pdfFile);
        await chat.sendMessage(MessageMedia.fromFilePath(pdfFile));
        await sendTyping(chat, 'Laporan absensi berhasil dibuat.');

        const [approver] = await query(`SELECT wa_number FROM users WHERE jabatan='Head' LIMIT 1`);
        const approverWA = approver?.wa_number || null;

        await query(
            `INSERT INTO approvals 
                (user_id, approver_wa, file_path, template_export, status, created_at, ttd_user_at, user_nama, user_nik, user_jabatan)
            VALUES (?, ?, ?, ?, 'pending', NOW(), NOW(), ?, ?, ?)`,
            [user.id, approverWA, path.basename(pdfFile), user.template_export, user.nama_lengkap, user.nik, user.jabatan]
        );

    } catch(err){
        console.error('PDF ABSENSI ERROR:', err);
        return sendTyping(chat, 'Terjadi kesalahan saat membuat PDF absensi.');
    }
}

/* ==============================
   GENERATE PDF LEMBUR
============================== */
async function generatePDFLembur(chat, user, db){
    const query = (sql, params=[]) => new Promise((res, rej) => db.query(sql, params, (err,result)=>err?rej(err):res(result)));
    try{
        const lemburData = await query(`SELECT * FROM lembur WHERE user_id=? ORDER BY tanggal`, [user.id]);
        if(!lemburData.length) return sendTyping(chat, 'Belum ada data lembur untuk dibuat PDF.');

        const bulanNama = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
        const firstTanggal = new Date(lemburData[0].tanggal);
        const lastTanggal = new Date(lemburData[lemburData.length-1].tanggal);

        const periode = user.template_export === 'LMD' ? 
            `${bulanNama[firstTanggal.getMonth()]} ${firstTanggal.getFullYear()}` : 
            `${formatTanggalLMD(firstTanggal)} - ${formatTanggalLMD(lastTanggal)}`;

        const rows = [];
        if(user.template_export === 'LMD'){
            for(const l of lemburData){
                const tgl = moment(l.tanggal).format('DD/MM/YYYY');
                const hari = moment(l.tanggal).locale('id').format('dddd');
                rows.push(`<tr>
                    <td>${tgl}</td>
                    <td>${hari}</td>
                    <td>${l.jam_mulai || '-'}</td>
                    <td>${l.jam_selesai || '-'}</td>
                    <td>${l.total_lembur || '-'}</td>
                    <td>${l.deskripsi || '-'}</td>
                </tr>`);
            }
        } else {
            const totalHari = new Date(firstTanggal.getFullYear(), firstTanggal.getMonth()+1,0).getDate();
            for(let i=1; i<=totalHari; i++){
                const dateObj = moment(`${firstTanggal.getFullYear()}-${firstTanggal.getMonth()+1}-${i}`, 'YYYY-M-D');
                const r = lemburData.find(l => moment(l.tanggal).format('YYYY-MM-DD') === dateObj.format('YYYY-MM-DD'));
                rows.push(`<tr>
                    <td>${i}</td>
                    <td>${r?.jam_mulai || ''}</td>
                    <td>${r?.jam_selesai || ''}</td>
                    <td>${r?.total_lembur || ''}</td>
                    <td>${r?.deskripsi || ''}</td>
                    <td></td>
                </tr>`);
            }
        }

        const logoFile = path.join(__dirname, `../assets/logo/${user.template_export.toLowerCase()}.png`);
        let logoBase64 = fs.existsSync(logoFile) ? 'data:image/png;base64,' + fs.readFileSync(logoFile).toString('base64') : '';

        const ttdPng = path.join(ttdFolder, `${user.wa_number}.png`);
        const ttdJpg = path.join(ttdFolder, `${user.wa_number}.jpg`);
        let ttdUserBase64 = '';
        if(fs.existsSync(ttdPng)) ttdUserBase64 = fs.readFileSync(ttdPng).toString('base64');
        else if(fs.existsSync(ttdJpg)) ttdUserBase64 = fs.readFileSync(ttdJpg).toString('base64');
        const ttdUserHTML = ttdUserBase64 ? `<img src="data:image/png;base64,${ttdUserBase64}" style="max-width:150px; max-height:80px;" />` : '';

        const templatePath = path.join(__dirname, `../templates/lembur/${user.template_export}.html`);
        const htmlTemplate = fs.readFileSync(templatePath,'utf8');

        const html = htmlTemplate
            .replace(/{{rows_lembur}}/g, rows.join(''))
            .replace(/{{nama}}/g, user.nama_lengkap || '-')
            .replace(/{{jabatan}}/g, user.jabatan || '-')
            .replace(/{{nik}}/g, user.nik || '-')
            .replace(/{{periode}}/g, periode)
            .replace(/{{logo}}/g, logoBase64)
            .replace(/{{ttd_user}}/g, ttdUserHTML)
            .replace(/{{ttd_atasan}}/g, '')
            .replace(/{{nama_atasan}}/g, '')
            .replace(/{{nik_atasan}}/g, '');

        const exportsDir = path.join(__dirname,'../exports');
        if(!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir,{recursive:true});

        const pdfFile = path.join(exportsDir, `LEMBUR-${user.nama_lengkap}-${user.template_export}.pdf`);
        fs.writeFileSync(path.join(exportsDir, `LEMBUR-${user.nama_lengkap}-${user.template_export}.html`), html, 'utf8');

        await generatePDF(html, pdfFile);
        await chat.sendMessage(MessageMedia.fromFilePath(pdfFile));
        await sendTyping(chat, 'PDF lembur berhasil dibuat');

        const [approver] = await query(`SELECT wa_number FROM users WHERE jabatan='Head' LIMIT 1`);
        const approverWA = approver?.wa_number || null;

        await query(
            `INSERT INTO approvals 
                (user_id, approver_wa, file_path, template_export, status, created_at, ttd_user_at, user_nama, user_nik, user_jabatan)
            VALUES (?, ?, ?, ?, 'pending', NOW(), NOW(), ?, ?, ?)`,
            [user.id, approverWA, path.basename(pdfFile), user.template_export, user.nama_lengkap, user.nik, user.jabatan]
        );

    } catch(err){
        console.error('PDF LEMBUR ERROR:', err);
        return sendTyping(chat, 'Terjadi kesalahan saat membuat PDF lembur.');
    }
}

module.exports = {
    handleExport,
    generatePDFandSend,
    generatePDFLembur
};
