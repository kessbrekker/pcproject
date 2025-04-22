const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
app.use(cors());
// JSON body limiti artırıldı
app.use(bodyParser.json({ limit: '5mb' }));

// MongoDB bağlantısı
mongoose.connect('mongodb://localhost:27017/pixelcar', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => console.log('MongoDB bağlantısı başarılı!'))
.catch((err) => console.error('MongoDB bağlantı hatası:', err));

// Kullanıcı modeli (avatar alanı ekli)
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    email: { type: String },
    tag: { type: String, maxlength: 3 },
    avatar: { type: String } // base64 veya url
});
const User = mongoose.model('User', UserSchema);

// Tek endpoint: Giriş veya kayıt formu gösterme
app.post('/api/login-or-register', async (req, res) => {
    try {
        const { username, password } = req.body;
        let user = await User.findOne({ username });
        if (!user) {
            // Kullanıcı yoksa kayıt formu gösterilsin
            return res.status(404).json({ needRegister: true });
        }
        if (user.password !== password) {
            return res.status(401).json({ error: 'Şifre yanlış.' });
        }
        res.json({ message: 'Giriş başarılı!', user: { username: user.username, email: user.email, tag: user.tag } });
    } catch (err) {
        res.status(500).json({ error: 'İşlem başarısız: ' + err.message });
    }
});

// Ayrıntılı kayıt endpoint'i
app.post('/api/register', async (req, res) => {
    try {
        const { username, password, email, tag } = req.body;
        if (!tag || tag.length > 3) {
            return res.status(400).json({ error: 'Etiket en fazla 3 karakter olmalı!' });
        }
        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(400).json({ error: 'Kullanıcı adı zaten var.' });
        }
        const user = new User({ username, password, email, tag });
        await user.save();
        res.status(201).json({ message: 'Kayıt başarılı!', user: { username: user.username, email: user.email, tag: user.tag } });
    } catch (err) {
        res.status(400).json({ error: 'Kayıt başarısız: ' + err.message });
    }
});

// Kullanıcı avatar güncelleme endpoint'i
app.post('/api/upload-avatar', async (req, res) => {
    try {
        const { username, avatar } = req.body;
        if (!username || !avatar) {
            return res.status(400).json({ error: 'Eksik veri' });
        }
        await User.updateOne({ username }, { $set: { avatar } });
        res.json({ message: 'Avatar kaydedildi' });
    } catch (err) {
        res.status(500).json({ error: 'Avatar kaydedilemedi' });
    }
});

// Basit bir test endpoint'i
app.get('/', (req, res) => {
    res.send('PixelCarProject API çalışıyor!');
});

const PORT = 3001;
app.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});
