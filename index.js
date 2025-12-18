// index.js
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');
const mysql = require('mysql2');
const commands = require('./commands'); // otomatis ambil index.js di folder commands
const moment = require('moment');

// --- Database Config ---
const db = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "",
    database: "bot"
});

// Cek koneksi database
db.connect(err => {
  if(err) {
    console.error('DB connection error:', err);
    process.exit(1);
  } else {
    console.log('Database connected!');
    startWhatsAppBot();
  }
});


// --- Client WA ---
const client = new Client({
    authStrategy: new LocalAuth({ clientId: "bot1", dataPath: './sessions' })
});

// Tampilkan QR Code saat pertama kali login
client.on('qr', qr => {
    console.log("Scan QR Code untuk login:");
    qrcode.generate(qr, { small: true });
});

// Event saat bot siap
client.on('ready', () => {
    console.log('Bot WhatsApp ON!');
});

// --- Simpan atau update user di database ---
function saveOrUpdateUser(wa_number, nama_wa) {
    db.query(
        `INSERT INTO users (wa_number, nama_wa)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE
           nama_wa = VALUES(nama_wa),
           updated_at = CURRENT_TIMESTAMP`,
        [wa_number, nama_wa],
        (err) => {
            if (err) console.error("Error saveOrUpdateUser:", err);
        }
    );
}

// --- Event pesan masuk ---
client.on('message', async msg => {
    try {
        const chat = await msg.getChat();
        const wa_number = msg.from.replace('@c.us','');
        const nama = msg._data.notifyName || "User";
        const pesan = msg.body.trim();

        // Simpan atau update user
        saveOrUpdateUser(wa_number, nama);

        // Jalankan command sesuai pesan
        if (commands.message) {
            await commands.message(chat, wa_number, nama, db, pesan);
        } else if (commands.default) {
            await commands.default(chat, nama);
        }
    } catch (err) {
        console.error("Error handling message:", err);
    }
});

// --- Jalankan client ---
client.initialize();
