//export.js
const fs = require('fs');
const path = require('path');
const moment = require('moment');
const { MessageMedia } = require('whatsapp-web.js');
const { sendTyping } = require('../utils/sendTyping');
const generatePDF = require('../utils/pdfGenerator');
const { getLogoBase64, getTTDHTML } = require('../utils/getAssets');
const ttdFolder = path.join(__dirname, '../assets/ttd/');

const formatTanggalLMD = (date) => {
    const d = new Date(date);
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
};

const hariIndonesia = (date) => moment(date).locale('id').format('dddd');

async function handleExport(chat, user, pesan, db, paramBulan=null) {
    if(!db || !user?.id) return;

    const query = (sql, params=[]) =>
        new Promise((res, rej) =>
            db.query(sql, params, (err, r) => err ? rej(err) : res(r))
        );

    try {
        const [dbUser] = await query(`SELECT * FROM users WHERE id=?`, [user.id]);
        if(!dbUser) return;

        user = { ...user, ...dbUser };

        const nama_wa = user.pushname || user.nama_wa || 'Arta';
        const text = pesan.toLowerCase().trim();

        // Command

        if (text === '/export') {
            await query(`
                UPDATE users 
                SET step_input='start_export',
                    template_export=NULL,
                    export_type=NULL
                WHERE id=?
            `, [user.id]);

            user.step_input = 'start_export';
        }

        // Step: start export
        if (user.step_input === 'start_export') {
            await query(
                `UPDATE users SET step_input='choose_export_type' WHERE id=?`,
                [user.id]
            );

            return sendTyping(
                chat,
                `Halo *${nama_wa}*, mau export *Absensi* atau *Lembur*?`
            );
        }

        // Step: pilih tipe export
        if (user.step_input === 'choose_export_type') {
            if (!['absensi', 'lembur'].includes(text))
                return sendTyping(chat, 'Balas *absensi* atau *lembur* ya.');

            // Cek pending untuk jenis
            const [pendingApproval] = await query(
                `SELECT file_path
                FROM approvals
                WHERE user_id=? 
                AND source='export'
                AND status='pending'
                AND file_path LIKE ?
                ORDER BY created_at DESC
                LIMIT 1`,
                [user.id, text === 'lembur' ? 'LEMBUR-%' : 'ABSENSI-%']
            );

            if (pendingApproval) {
                return sendTyping(
                    chat,
                    `*Laporan ${text} kamu sedang dalam proses approval.*\nSilakan tunggu hingga selesai.`
                );
            }

            // Simpan pilihan dan lanjut ke pilih template
            await query(
                `UPDATE users 
                SET export_type=?, step_input='choose_template' 
                WHERE id=?`,
                [text, user.id]
            );

            return sendTyping(
                chat,
                `Pilih template:\n1. KSPS\n2. LMD\nBalas *ksps* atau *lmd*`
            );
        }


        // Step: pilih template

        if (user.step_input === 'choose_template') {
            if (!['ksps', 'lmd'].includes(text))
                return sendTyping(chat, 'Balas *ksps* atau *lmd* ya.');

            await query(
                `UPDATE users 
                 SET template_export=?, step_input=NULL 
                 WHERE id=?`,
                [text.toUpperCase(), user.id]
            );

            const [freshUser] = await query(
                `SELECT * FROM users WHERE id=?`,
                [user.id]
            );

            if (freshUser.export_type === 'absensi') {
                return generatePDFandSend(chat, freshUser, db, paramBulan);
            } else {
                return generatePDFLembur(chat, freshUser, db);
            }
        }

    } catch (err) {
        console.error(err);
        return sendTyping(chat, 'Terjadi kesalahan saat export.');
    }
}

// Generate pdf absensi
async function generatePDFandSend(chat, user, db, paramBulan){
    const query = (sql, params=[]) =>
        new Promise((res, rej) => db.query(sql, params, (err,r)=>err?rej(err):res(r)));

    try {
        const templateName = user.template_export || 'LMD';
        const templateSafe = templateName.toLowerCase();

        const bulanNama = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
        const now = new Date();
        let bulan = now.getMonth();
        let tahun = now.getFullYear();

        if(paramBulan){
            const idx = bulanNama.findIndex(b=>b.toLowerCase()===paramBulan.toLowerCase());
            if(idx!==-1) bulan=idx;
        }

        const totalHari = new Date(tahun, bulan+1, 0).getDate();
        const periode = templateName === 'LMD'
            ? `${bulanNama[bulan]} ${tahun}`
            : `1 - ${totalHari} ${bulanNama[bulan]} ${tahun}`;

        const absensi = await query(
            `SELECT * FROM absensi WHERE user_id=? AND MONTH(tanggal)=? AND YEAR(tanggal)=? ORDER BY tanggal`,
            [user.id, bulan+1, tahun]
        );

        const rows=[];
        for(let i=1;i<=totalHari;i++){
            const d = moment(`${tahun}-${bulan+1}-${i}`,'YYYY-M-D');
            const r = absensi.find(a=>moment(a.tanggal).format('YYYY-MM-DD')===d.format('YYYY-MM-DD'));
            const libur = [0,6].includes(d.day());

            rows.push(templateName === 'LMD'
                ? `<tr style="background-color:${libur?'#f15a5a':'#FFF'}">
                     <td>${formatTanggalLMD(d)}</td>
                     <td>${hariIndonesia(d)}</td>
                     <td>${r?.jam_masuk||'-'}</td>
                     <td>${r?.jam_pulang||'-'}</td>
                     <td>${r?.deskripsi||'-'}</td>
                   </tr>`
                : `<tr style="background-color:${libur?'#f0f0f0':'#FFF'}">
                     <td>${i}</td>
                     <td>${r?.jam_masuk||''}</td>
                     <td>${r?.jam_pulang||''}</td>
                     <td>${libur?'<b>LIBUR</b>':(r?.deskripsi||'')}</td>
                     <td></td>
                   </tr>`
            );
        }

        // logo
        const logoBase64 = getLogoBase64(templateName);
        // ttd
        const ttdUserHTML = getTTDHTML(user.wa_number);

        const [approver] = await query(
            `SELECT nama_lengkap, nik FROM users WHERE jabatan='Head' LIMIT 1`
        );
        const approverNama = approver?.nama_lengkap || '-';
        const approverNik = approver?.nik || '-';

        const templatePath = path.join(__dirname, `../templates/absensi/${templateName}.html`);
        let html = fs.readFileSync(templatePath,'utf8');

        html = html
            .replace(/{{logo}}/g,logoBase64)
            .replace(/{{nama}}/g,user.nama_lengkap||'-')
            .replace(/{{jabatan}}/g,user.jabatan||'-')
            .replace(/{{nik}}/g,user.nik||'-')
            .replace(/{{periode}}/g,periode)
            .replace(/{{rows_absensi}}/g,rows.join(''))
            .replace(/{{ttd_user}}/g,ttdUserHTML)
            .replace(/{{nama_atasan}}/g,approverNama)
            .replace(/{{nik_atasan}}/g,approverNik);

        const exportsDir = path.join(__dirname,'../exports');
        if(!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir,{recursive:true});

        const pdfFile = path.join(exportsDir, `ABSENSI-${user.nama_lengkap}-${templateName}.pdf`);

        await generatePDF(html,pdfFile);
        await chat.sendMessage(MessageMedia.fromFilePath(pdfFile));
        await sendTyping(chat,'Laporan absensi berhasil dibuat.');

    } catch(err){
        console.error(err);
        return sendTyping(chat,'Terjadi kesalahan saat membuat PDF absensi.');
    }
}

// Generate pdf lembur
async function generatePDFLembur(chat, user, db){
    const query = (sql, params=[]) =>
        new Promise((res, rej) =>
            db.query(sql, params, (err,r)=>err?rej(err):res(r))
        );

    try {
        const templateName = user.template_export || 'LMD';

        // Ambil data + info bulan
        const lemburData = await query(
            `SELECT 
                YEAR(tanggal) AS tahun,
                MONTH(tanggal) AS bulan,
                lembur.*
            FROM lembur
            WHERE user_id=?
            ORDER BY tanggal`,
            [user.id]
        );

        if(!lemburData.length)
            return sendTyping(chat,'Belum ada data lembur.');

        const bulanNama = [
            'Januari','Februari','Maret','April','Mei','Juni',
            'Juli','Agustus','September','Oktober','November','Desember'
        ];

        // logo
        const logoBase64 = getLogoBase64(templateName);
        // ttd
        const ttdUserHTML = getTTDHTML(user.wa_number);
    
        // Group data by bulan
        const grouped = {};
        for(const l of lemburData){
            const key = `${l.tahun}-${l.bulan}`;
            if(!grouped[key]) grouped[key] = [];
            grouped[key].push(l);
        }

        const exportsDir = path.join(__dirname,'../exports');
        if(!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir,{recursive:true});

        // prioritas bulan sekarang
        const now = new Date();
        const currentKey = `${now.getFullYear()}-${now.getMonth() + 1}`;

        let keysToGenerate = [];

        if (grouped[currentKey]) {
            // ada data bulan sekarang
            keysToGenerate = [currentKey];
        } else {
            // tidak ada → ambil bulan terakhir
            const sortedKeys = Object.keys(grouped).sort();
            keysToGenerate = [sortedKeys[sortedKeys.length - 1]];
        }

        // Loop stiap laporan 1 bulan
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

                    rows += `
<tr>
    <td>${i}</td>
    <td>${l?.jam_mulai || ''}</td>
    <td>${l?.jam_selesai || ''}</td>
    <td>${totalJam}</td>
    <td>${l?.deskripsi || ''}</td>
    <td></td>
</tr>`;
                }
            } else {
                for(const l of dataBulan){
                    let jam = 0;
                    if(l.total_lembur){
                        const [h,m=0] = l.total_lembur.includes(':')
                            ? l.total_lembur.split(':').map(Number)
                            : [parseFloat(l.total_lembur),0];

                        jam = h + m/60;
                        totalLemburDecimal += jam;
                    }

                    rows += `
<tr>
    <td>${moment(l.tanggal).format('DD/MM/YYYY')}</td>
    <td>${moment(l.tanggal).locale('id').format('dddd')}</td>
    <td>${l.jam_mulai || '-'}</td>
    <td>${l.jam_selesai || '-'}</td>
    <td>${jam ? (jam % 1 === 0 ? jam : jam.toFixed(1))+' Jam' : '-'}</td>
    <td>${l.deskripsi || '-'}</td>
</tr>`;
                }
            }

            const totalLembur = `${totalLemburDecimal % 1 === 0 ? totalLemburDecimal : totalLemburDecimal.toFixed(1)} Jam`;

            const [approver] = await query(
                `SELECT nama_lengkap, nik FROM users WHERE role='approver' LIMIT 1`
            );
            const approverNama = approver?.nama_lengkap || '-';
            const approverNik = approver?.nik || '-';

            const templatePath = path.join(__dirname, `../templates/lembur/${templateName}.html`);
            let html = fs.readFileSync(templatePath,'utf8');

            html = html
                .replace(/{{logo}}/g, logoBase64)
                .replace(/{{rows_lembur}}/g, rows)
                .replace(/{{periode}}/g, periode)
                .replace(/{{nama}}/g, user.nama_lengkap || '-')
                .replace(/{{jabatan}}/g, user.jabatan || '-')
                .replace(/{{nik}}/g, user.nik || '-')
                .replace(/{{ttd_user}}/g, ttdUserHTML)
                .replace(/{{nama_atasan}}/g, approverNama)
                .replace(/{{nik_atasan}}/g, approverNik)
                .replace(/{{total_lembur}}/g, totalLembur);

            const pdfFile = path.join(
                exportsDir,
                `LEMBUR-${user.nama_lengkap}-${templateName}-${bulanNama[bulanIdx]}-${tahun}.pdf`
            );

            await generatePDF(html, pdfFile);
            await chat.sendMessage(MessageMedia.fromFilePath(pdfFile));
        }

        await sendTyping(chat,'Laporan lembur berhasil dibuat.');

    } catch(err){
        console.error(err);
        return sendTyping(chat,'Terjadi kesalahan saat membuat PDF lembur.');
    }
}


module.exports = {
    handleExport,
    generatePDFandSend,
    generatePDFLembur
};
