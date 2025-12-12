// index.js 
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');
const mysql = require('mysql');
const commands = require('./commands/commands');
const moment = require('moment');

// --- Database Config ---
const db = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "",
    database: "bot"
});

// --- Client WA ---
const client = new Client({
    authStrategy: new LocalAuth({ clientId: "bot1", dataPath: './sessions' })
});

client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('Bot WhatsApp ON!');
});

// --- Fungsi simpan/ubah user di database ---
function saveOrUpdateUser(wa_number, nama) {
    const now = moment().format('YYYY-MM-DD HH:mm:ss');
    db.query("SELECT * FROM users WHERE wa_number=?", [wa_number], (err, result) => {
        if(err) throw err;
        if(result.length > 0){
            // Update last_seen
            db.query("UPDATE users SET last_seen=? WHERE wa_number=?", [now, wa_number]);
        } else {
            // Insert user baru
            db.query("INSERT INTO users (wa_number, nama, last_seen) VALUES (?,?,?)", [wa_number, nama, now]);
        }
    });
}

// --- Event pesan masuk ---
client.on('message', async msg => {
    const chat = await msg.getChat();
    const wa_number = msg.from.replace('@c.us','');
    const nama = msg._data.notifyName || "User";
    const pesan = msg.body.toLowerCase();

    // Simpan atau update user di database
    saveOrUpdateUser(wa_number, nama);

    // Balas perintah
    if(commands['message']){
        commands['message'](chat, wa_number, nama, db, pesan);
    } else {
        commands['default'](chat, nama);
    }
});

// Jalankan client
client.initialize();
