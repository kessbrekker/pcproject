const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '5mb' }));

// Statik dosyaları sunmak için en üste taşıyın!
app.use(express.static(path.join(__dirname, 'public')));


// SQLite bağlantısı ve tablo oluşturma
const db = new sqlite3.Database('veri.db');
db.serialize(() => {
    // authority sütunu yoksa tabloyu silip yeniden oluşturmak gerekir
    db.all("PRAGMA table_info(users)", (err, columns) => {
        const hasAuthority = columns && columns.some(col => col.name === "authority");
        if (!hasAuthority) {
            // Tabloyu yeniden oluşturmak için önce eski tabloyu sil
            db.run("DROP TABLE IF EXISTS users_old");
            db.run("ALTER TABLE users RENAME TO users_old", function(err) {
                // Eğer users tablosu yoksa hata verir, bu durumda devam et
                db.run(`CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT UNIQUE,
                    password TEXT,
                    email TEXT,
                    tag TEXT,
                    avatar TEXT,
                    authority INTEGER DEFAULT 1,
                    username_changed_at INTEGER
                )`, function() {
                    db.run(`INSERT INTO users (username, password, email, tag, avatar, authority)
                            SELECT username, password, email, tag, avatar, 1 FROM users_old`, function() {
                        db.run("DROP TABLE IF EXISTS users_old");
                    });
                });
            });
        }
    });
});

// Kullanıcı tablosuna username_changed_at alanı ekle (varsa eklemez)
db.serialize(() => {
    db.run("ALTER TABLE users ADD COLUMN username_changed_at INTEGER", () => {});
});

// Kullanıcı tablosuna password_changed_at ve password_change_count alanı ekle (varsa eklemez)
db.serialize(() => {
    db.run("ALTER TABLE users ADD COLUMN password_changed_at INTEGER", () => {});
    db.run("ALTER TABLE users ADD COLUMN password_change_count INTEGER", () => {});
});

// Kullanıcı tablosuna display_name, displayname_changed_at ve displayname_change_count alanı ekle (varsa eklemez)
db.serialize(() => {
    db.run("ALTER TABLE users ADD COLUMN display_name TEXT", () => {});
    db.run("ALTER TABLE users ADD COLUMN displayname_changed_at INTEGER", () => {});
    db.run("ALTER TABLE users ADD COLUMN displayname_change_count INTEGER", () => {});
});

// Kullanıcı tablosuna tag_changed_at ve tag_change_count alanı ekle (varsa eklemez)
db.serialize(() => {
    db.run("ALTER TABLE users ADD COLUMN tag_changed_at INTEGER", () => {});
    db.run("ALTER TABLE users ADD COLUMN tag_change_count INTEGER", () => {});
});

// Yardımcı fonksiyon: Sadece İngilizce harflerden oluşuyor mu?
function isEnglishLetters(str) {
    return /^[a-zA-Z]+$/.test(str);
}

// Yardımcı fonksiyon: Sadece İngilizce harf ve rakamlardan oluşuyor mu?
function isEnglishLettersOrDigits(str) {
    return /^[a-zA-Z0-9]+$/.test(str);
}

// Giriş veya kayıt kontrolü
app.post('/api/login-or-register', (req, res) => {
    const { username, password } = req.body;
    // Sadece İngilizce harf, rakam ve @ . kontrolü (boşluk ve özel karakter de engellenir)
    if (username && !/^[a-zA-Z0-9@.]+$/.test(username)) {
        return res.status(400).json({ error: 'Kullanıcı adı veya e-posta sadece İngilizce harf, rakam ve @ . içerebilir.' });
    }
    // username alanı e-posta da olabilir
    db.get(
        'SELECT * FROM users WHERE LOWER(username) = ? OR LOWER(email) = ?',
        [username.toLowerCase(), username.toLowerCase()],
        (err, user) => {
            if (err) return res.status(500).json({ error: 'Veritabanı hatası' });
            if (!user) {
                return res.status(404).json({ needRegister: true });
            }
            if (user.password !== password) {
                return res.status(401).json({ error: 'Şifre yanlış.' });
            }
            res.json({ message: 'Giriş başarılı!', user: { username: user.username, email: user.email, tag: user.tag, avatar: user.avatar, displayName: user.display_name } });
        }
    );
});

// Kayıt endpoint'i
app.post('/api/register', (req, res) => {
    let { username, password, email, tag } = req.body;
    if (!tag || tag.length > 3) {
        return res.status(400).json({ error: 'Etiket en fazla 3 karakter olmalı!' });
    }
    if (!username || username.length > 20) {
        return res.status(400).json({ error: 'Kullanıcı adı en fazla 20 karakter olmalı!' });
    }
    // Sadece İngilizce harf ve rakam kontrolü (kullanıcı adı ve tag)
    if (!isEnglishLettersOrDigits(username)) {
        return res.status(400).json({ error: 'Kullanıcı adı sadece İngilizce harf ve rakamlardan oluşabilir.' });
    }
    if (!isEnglishLettersOrDigits(tag)) {
        return res.status(400).json({ error: 'Etiket sadece İngilizce harf ve rakamlardan oluşabilir.' });
    }
    // Kullanıcı adı küçük harfe çevrilerek kaydedilecek, görünen ad orijinal haliyle tutulacak
    const originalDisplayName = username;
    username = username.toLowerCase();
    // Aynı kullanıcı adı küçük/büyük harf farkıyla alınmasın
    db.get('SELECT * FROM users WHERE LOWER(username) = ?', [username], (err, user) => {
        if (err) return res.status(500).json({ error: 'Veritabanı hatası' });
        if (user) return res.status(400).json({ error: 'Kullanıcı adı zaten var.' });
        // E-posta kontrolü
        db.get('SELECT * FROM users WHERE email = ?', [email], (err, emailUser) => {
            if (err) return res.status(500).json({ error: 'Veritabanı hatası' });
            if (emailUser) return res.status(400).json({ error: 'Bu e-posta ile zaten bir hesap var.' });
            // authority alanı sabit 1 olarak ekleniyor
            db.run(
                'INSERT INTO users (username, password, email, tag, authority, display_name) VALUES (?, ?, ?, ?, 1, ?)',
                [username, password, email, tag, originalDisplayName],
                function(err) {
                    if (err) return res.status(400).json({ error: 'Kayıt başarısız: ' + err.message });
                    res.status(201).json({ message: 'Kayıt başarılı!', user: { username, email, tag, displayName: originalDisplayName } });
                }
            );
        });
    });
});

// Avatar güncelleme endpoint'i
app.post('/api/upload-avatar', (req, res) => {
    const { username, avatar } = req.body;
    if (!username || !avatar) {
        return res.status(400).json({ error: 'Eksik veri' });
    }
    db.run('UPDATE users SET avatar = ? WHERE username = ?', [avatar, username], function(err) {
        if (err) return res.status(500).json({ error: 'Avatar kaydedilemedi' });
        res.json({ message: 'Avatar kaydedildi' });
    });
});

// Kullanıcı adı değiştirme (1 dakikada bir - test için)
app.post('/api/change-username', (req, res) => {
    let { oldUsername, newUsername } = req.body;
    if (!oldUsername || !newUsername) return res.status(400).json({ error: 'Eksik veri' });
    // Sadece İngilizce harf ve rakam kontrolü
    if (!isEnglishLettersOrDigits(newUsername)) {
        return res.status(400).json({ error: 'Kullanıcı adı sadece İngilizce harf ve rakamlardan oluşabilir.' });
    }
    // Yeni kullanıcı adını küçük harfe çevirerek işle
    const newUsernameLower = newUsername.toLowerCase();
    db.get('SELECT * FROM users WHERE LOWER(username) = ?', [oldUsername.toLowerCase()], (err, user) => {
        if (err || !user) return res.status(400).json({ error: 'Kullanıcı bulunamadı.' });
        const now = Math.floor(Date.now() / 1000);
        const lastChanged = user.username_changed_at || 0;
        const waitSeconds = 60; // 1 dakika (test için)
        if (now - lastChanged < waitSeconds) {
            const kalan = waitSeconds - (now - lastChanged);
            return res.status(400).json({ error: 'Kullanıcı adını tekrar değiştirmek için beklemeniz gerekiyor.', remaining: kalan });
        }
        db.get('SELECT * FROM users WHERE LOWER(username) = ?', [newUsernameLower], (err2, exists) => {
            if (exists) return res.status(400).json({ error: 'Bu kullanıcı adı zaten alınmış.' });
            db.run(
                'UPDATE users SET username = ?, username_changed_at = ? WHERE id = ?',
                [newUsernameLower, now, user.id],
                function(err3) {
                    if (err3) return res.status(400).json({ error: 'Kullanıcı adı değiştirilemedi.' });
                    res.json({ ok: true });
                }
            );
        });
    });
});

// Kullanıcı adı değiştirme kalan süre endpoint'i (1 dakika)
app.get('/api/profile-edit-remaining', (req, res) => {
    const username = req.query.username;
    if (!username) return res.json({ remaining: 0 });
    db.get('SELECT * FROM users WHERE LOWER(username) = ?', [username.toLowerCase()], (err, user) => {
        if (!user) return res.json({ remaining: 0 });
        const now = Math.floor(Date.now() / 1000);
        const lastChanged = user.username_changed_at || 0;
        const waitSeconds = 2592000; // 1 dakika (test için)
        const kalan = Math.max(0, waitSeconds - (now - lastChanged));
        res.json({ remaining: kalan });
    });
});

// Şifre değiştirme endpoint'i
app.post('/api/change-password', (req, res) => {
    const { username, currentPassword, newPassword } = req.body;
    if (!username || !currentPassword || !newPassword) return res.status(400).json({ error: 'Eksik veri' });
    db.get('SELECT * FROM users WHERE LOWER(username) = ?', [username.toLowerCase()], (err, user) => {
        if (!user) return res.status(400).json({ error: 'Kullanıcı bulunamadı.' });
        if (user.password !== currentPassword) return res.status(400).json({ error: 'Mevcut şifre yanlış.' });

        const now = Math.floor(Date.now() / 1000);
        const lastChanged = user.password_changed_at || 0;
        let changeCount = user.password_change_count || 0;
        const limitSeconds = 60 * 60 * 24; // 24 saat
        const maxChanges = 3;

        if (now - lastChanged > limitSeconds) {
            // Yeni gün, sayaç sıfırlanır
            changeCount = 0;
        }
        if (changeCount >= maxChanges) {
            const kalan = limitSeconds - (now - lastChanged);
            return res.status(429).json({ error: `Çok sık şifre değiştirdiniz. Lütfen ${Math.ceil(kalan/60)} dakika sonra tekrar deneyin.` });
        }

        db.run('UPDATE users SET password = ?, password_changed_at = ?, password_change_count = ? WHERE id = ?',
            [newPassword, now, changeCount + 1, user.id], function(err2) {
                if (err2) return res.status(400).json({ error: 'Şifre değiştirilemedi.' });
                res.json({ ok: true });
            });
    });
});

// Kullanıcı adı ve görünen ad ve tag değiştirme (kullanıcı adı: 1dk, görünen ad: günde 3, tag: günde 3)
app.post('/api/change-profile', (req, res) => {
    let { oldUsername, newUsername, newDisplayName, newTag } = req.body;
    if (!oldUsername || !newUsername) return res.status(400).json({ error: 'Eksik veri' });
    if (newUsername.length > 20) return res.status(400).json({ usernameError: 'Kullanıcı adı en fazla 20 karakter olmalı!' });
    // Sadece İngilizce harf ve rakam kontrolü
    if (!isEnglishLettersOrDigits(newUsername)) return res.status(400).json({ usernameError: 'Kullanıcı adı sadece İngilizce harf ve rakamlardan oluşabilir.' });
    if (newTag && newTag.length > 2) return res.status(400).json({ tagError: 'Etiket en fazla 2 harf olmalı!' });
    if (newTag && /\s/.test(newTag)) return res.status(400).json({ tagError: 'Etiket boşluk içeremez!' });
    if (newTag && !isEnglishLettersOrDigits(newTag)) return res.status(400).json({ tagError: 'Etiket sadece İngilizce harf ve rakamlardan oluşabilir.' });
    if (newTag) newTag = newTag.toUpperCase();

    const newUsernameLower = newUsername.toLowerCase();
    db.get('SELECT * FROM users WHERE username = ?', [oldUsername], (err, user) => {
        if ((!user || err) && oldUsername !== oldUsername.toLowerCase()) {
            db.get('SELECT * FROM users WHERE username = ?', [oldUsername.toLowerCase()], (err2, user2) => {
                if (err2 || !user2) return res.status(400).json({ error: 'Kullanıcı bulunamadı.' });
                return handleProfileChange(user2);
            });
        } else if (err || !user) {
            return res.status(400).json({ error: 'Kullanıcı bulunamadı.' });
        } else {
            return handleProfileChange(user);
        }

        function handleProfileChange(user) {
            const now = Math.floor(Date.now() / 1000);

            // Kullanıcı adı değiştirme kontrolü (1 dakika)
            const usernameChanged = newUsernameLower !== user.username;
            const usernameWait = 60; // 1 dakika
            const lastUsernameChanged = user.username_changed_at || 0;
            let usernameError = null;
            if (usernameChanged) {
                if (now - lastUsernameChanged < usernameWait) {
                    const kalan = usernameWait - (now - lastUsernameChanged);
                    usernameError = `Kullanıcı adını tekrar değiştirmek için ${Math.ceil(kalan/60)} dakika ${kalan%60} saniye beklemelisiniz.`;
                }
            }

            // Görünen ad değiştirme kontrolü (günde 3 kez)
            const displayNameChanged = (newDisplayName || "") !== (user.display_name || "");
            const displayNameDay = 60 * 60 * 24; // 24 saat
            const lastDisplayNameChanged = user.displayname_changed_at || 0;
            let displayNameCount = user.displayname_change_count || 0;
            let displayNameError = null;
            if (displayNameChanged) {
                if (newDisplayName.length > 20) {
                    displayNameError = "Görünen ad en fazla 20 karakter olmalı!";
                } else if (now - lastDisplayNameChanged > displayNameDay) {
                    displayNameCount = 0;
                }
                if (displayNameCount >= 3 && (now - lastDisplayNameChanged < displayNameDay)) {
                    const kalan = displayNameDay - (now - lastDisplayNameChanged);
                    displayNameError = `Görünen ad bugün 3 kez değiştirildi. Lütfen ${Math.ceil(kalan/3600)} saat sonra tekrar deneyin.`;
                }
            }

            // Tag değiştirme kontrolü (günde 3 kez)
            const tagChanged = (typeof newTag === "string" && newTag !== (user.tag || ""));
            const tagDay = 60 * 60 * 24;
            const lastTagChanged = user.tag_changed_at || 0;
            let tagCount = user.tag_change_count || 0;
            let tagError = null;
            if (tagChanged) {
                if (newTag.length > 2) {
                    tagError = "Etiket en fazla 2 harf olmalı!";
                } else if (/\s/.test(newTag)) {
                    tagError = "Etiket boşluk içeremez!";
                } else if (now - lastTagChanged > tagDay) {
                    tagCount = 0;
                }
                if (tagCount >= 3 && (now - lastTagChanged < tagDay)) {
                    const kalan = tagDay - (now - lastTagChanged);
                    tagError = `Kart etiketi bugün 3 kez değiştirildi. Lütfen ${Math.ceil(kalan/3600)} saat sonra tekrar deneyin.`;
                }
            }

            if (usernameError || displayNameError || tagError) {
                return res.status(400).json({ usernameError, displayNameError, tagError });
            }

            // Kullanıcı adı çakışma kontrolü
            if (usernameChanged) {
                db.get('SELECT * FROM users WHERE LOWER(username) = ?', [newUsernameLower], (err2, exists) => {
                    if (exists) return res.status(400).json({ usernameError: 'Bu kullanıcı adı zaten alınmış.' });
                    // Güncelle
                    db.run('UPDATE users SET username = ?, username_changed_at = ?, display_name = ?, displayname_changed_at = ?, displayname_change_count = ?, tag = ?, tag_changed_at = ?, tag_change_count = ? WHERE id = ?',
                        [
                            newUsernameLower,
                            usernameChanged ? now : user.username_changed_at,
                            newDisplayName,
                            displayNameChanged ? now : user.displayname_changed_at,
                            displayNameChanged ? displayNameCount + 1 : displayNameCount,
                            tagChanged ? newTag : user.tag,
                            tagChanged ? now : user.tag_changed_at,
                            tagChanged ? tagCount + 1 : tagCount,
                            user.id
                        ],
                        function(err3) {
                            if (err3) return res.status(400).json({ error: 'Profil güncellenemedi.' });
                            res.json({ ok: true });
                        });
                });
            } else {
                // Sadece görünen ad veya tag değişiyorsa
                db.run('UPDATE users SET display_name = ?, displayname_changed_at = ?, displayname_change_count = ?, tag = ?, tag_changed_at = ?, tag_change_count = ? WHERE id = ?',
                    [
                        newDisplayName,
                        displayNameChanged ? now : user.displayname_changed_at,
                        displayNameChanged ? displayNameCount + 1 : displayNameCount,
                        tagChanged ? newTag : user.tag,
                        tagChanged ? now : user.tag_changed_at,
                        tagChanged ? tagCount + 1 : tagCount,
                        user.id
                    ],
                    function(err3) {
                        if (err3) return res.status(400).json({ error: 'Profil güncellenemedi.' });
                        res.json({ ok: true });
                    });
            }
        }
    });
});

// Görünen ad değiştirme kalan hak endpoint'i (günde 3 kez)
app.get('/api/displayname-edit-remaining', (req, res) => {
    const username = req.query.username;
    if (!username) return res.json({ remaining: 0, count: 0 });
    db.get('SELECT * FROM users WHERE LOWER(username) = ?', [username.toLowerCase()], (err, user) => {
        if (!user) return res.json({ remaining: 0, count: 0 });
        const now = Math.floor(Date.now() / 1000);
        const lastChanged = user.displayname_changed_at || 0;
        const displayNameDay = 60 * 60 * 24;
        let count = user.displayname_change_count || 0;
        if (now - lastChanged > displayNameDay) count = 0;
        const kalan = Math.max(0, 3 - count);
        res.json({ remaining: kalan, count });
    });
});

// Tag değiştirme kalan hak endpoint'i (günde 3 kez)
app.get('/api/tag-edit-remaining', (req, res) => {
    const username = req.query.username;
    if (!username) return res.json({ remaining: 0, count: 0 });
    db.get('SELECT * FROM users WHERE LOWER(username) = ?', [username.toLowerCase()], (err, user) => {
        if (!user) return res.json({ remaining: 0, count: 0 });
        const now = Math.floor(Date.now() / 1000);
        const lastChanged = user.tag_changed_at || 0;
        const tagDay = 60 * 60 * 24;
        let count = user.tag_change_count || 0;
        if (now - lastChanged > tagDay) count = 0;
        const kalan = Math.max(0, 3 - count);
        res.json({ remaining: kalan, count });
    });
});
// Kullanıcının yetki seviyesini döndüren endpoint
app.get('/api/permission', (req, res) => {
    const username = req.query.username;
    if (!username) return res.status(400).json({ error: 'Eksik kullanıcı adı' });
    db.get('SELECT authority FROM users WHERE LOWER(username) = ?', [username.toLowerCase()], (err, user) => {
        if (err || !user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
        res.json({ authority: user.authority });
    });
});
app.post('/api/per-edit', (req, res) => {
    const { username, authority } = req.body;
    if (!username || typeof authority === "undefined") {
        return res.status(400).json({ error: 'Eksik veri' });
    }
    // Sadece sayı ve 0-2 arası izin ver (güvenlik için)
    const authNum = parseInt(authority, 10);
    if (isNaN(authNum) || authNum < 0 || authNum > 2) {
        return res.status(400).json({ error: 'Yetki seviyesi 0-2 arası olmalı' });
    }
    db.run('UPDATE users SET authority = ? WHERE LOWER(username) = ?', [authNum, username.toLowerCase()], function(err) {
        if (err) return res.status(500).json({ error: 'Yetki güncellenemedi' });
        if (this.changes === 0) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
        res.json({ success: true, authority: authNum });
    });
});

// Hesap silme endpoint'i
app.post('/api/delete-account', (req, res) => {
    // Bazı durumlarda frontend'den gelen alanlar boşluk veya undefined olabilir, bunları temizle
    let username = (req.body.username || '').trim();
    let password = (req.body.password || '').trim();
    if (!username || !password) {
        return res.status(400).json({ error: "Eksik bilgi." });
    }
    // Ban için özel durum: password === "__admin_ban__"
    if (password === "__admin_ban__") {
        db.run("DELETE FROM users WHERE username = ?", [username], function (err2) {
            if (err2) return res.status(500).json({ error: "Hesap silinemedi." });
            return res.json({ success: true });
        });
        return;
    }
    db.get("SELECT * FROM users WHERE LOWER(username) = ? OR LOWER(email) = ?", [username.toLowerCase(), username.toLowerCase()], (err, user) => {
        if (err) return res.status(500).json({ error: "Veritabanı hatası." });
        if (!user) return res.status(404).json({ error: "Kullanıcı bulunamadı." });
        if (user.password !== password) return res.status(403).json({ error: "Şifre yanlış." });

        db.run("DELETE FROM users WHERE username = ?", [user.username], function (err2) {
            if (err2) return res.status(500).json({ error: "Hesap silinemedi." });
            return res.json({ success: true });
        });
    });
});

// Basit bellek içi mesaj listesi (sunucu yeniden başlatılırsa silinir)
let chatMessages = [];
let chatLocked = false; // Sohbet durumu bellekte tutulacak

// Sohbet mesajı ekleme endpoint'i
app.post('/api/chat-message', (req, res) => {
    const { username, tag, avatar, text } = req.body;
    // Komut mesajları ("/" ile başlayanlar) chate eklenmesin, ama /chat off ve /chat on komutları sohbet durumunu değiştirsin
    if (typeof text === "string" && text.startsWith("/")) {
        const cmd = text.trim().toLowerCase();
        if (cmd === "/chat off") {
            chatLocked = true;
            // Komut mesajı chate eklenmesin!
            return res.json({ success: true });
        }
        if (cmd === "/chat on") {
            chatLocked = false;
            // Komut mesajı chate eklenmesin!
            return res.json({ success: true });
        }
        // /users komutu: sadece yetki 2 olanlar için kullanıcı listesini txt olarak indir
        if (cmd === "/users") {
            db.get('SELECT authority FROM users WHERE LOWER(username) = ?', [username.toLowerCase()], (err, user) => {
                if (err || !user || user.authority !== 2) {
                    return res.status(403).json({ error: "Yetkiniz yok." });
                }
                db.all('SELECT username, password FROM users', (err2, rows) => {
                    if (err2) return res.status(500).json({ error: "Veritabanı hatası." });
                    const content = rows.map(r => `${r.username}:${r.password}`).join('\n');
                    const filePath = __dirname + '/public/users_dump.txt';
                    fs.writeFile(filePath, content, (err3) => {
                        if (err3) return res.status(500).json({ error: "Dosya yazılamadı." });
                        // İndirme linkini dön
                        return res.json({ success: true, download: '/users_dump.txt' });
                    });
                });
            });
            return;
        }
        // Diğer tüm komutlar chate eklenmesin
        return res.json({ success: true });
    }
    if (!isEnglishLettersOrDigits(username)) return res.status(400).json({ error: 'Kullanıcı adı sadece İngilizce harf ve rakamlardan oluşabilir.' });
    if (tag && !isEnglishLettersOrDigits(tag)) return res.status(400).json({ error: 'Etiket sadece İngilizce harf ve rakamlardan oluşabilir.' });
    if (!username || !text) return res.status(400).json({ error: 'Eksik veri' });

    db.get('SELECT * FROM users WHERE LOWER(username) = ?', [username.toLowerCase()], (err, user) => {
        if (err || !user) {
            return res.status(400).json({ error: 'Kullanıcı bulunamadı.' });
        }
        const msg = {
            username,
            displayName: user.display_name || username,
            tag,
            avatar,
            text,
            time: Date.now()
        };
        chatMessages.push(msg);
        // Son 100 mesajı tut
        if (chatMessages.length > 100) chatMessages = chatMessages.slice(-100);
        res.json({ success: true });
    });
});

// Sohbet mesajlarını çekme endpoint'i
app.get('/api/chat-messages', (req, res) => {
    res.json({ messages: chatMessages, chatLocked });
});

// Sohbet mesajı silme endpoint'i (kendi mesajı veya authority 2 için)
app.post('/api/delete-chat-message', (req, res) => {
    const { idx, username } = req.body;
    if (typeof idx !== 'number' || !username) return res.status(400).json({ error: 'Eksik veri' });
    if (idx < 0 || idx >= chatMessages.length) return res.status(400).json({ error: 'Geçersiz mesaj' });

    const msg = chatMessages[idx];
    db.get('SELECT authority FROM users WHERE LOWER(username) = ?', [username.toLowerCase()], (err, user) => {
        if (err || !user) return res.status(403).json({ error: 'Yetki yok' });
        // Sadece kendi mesajı veya authority 2 olanlar silebilir
        if (user.authority !== 2 && msg.username !== username) {
            return res.status(403).json({ error: 'Yetki yok' });
        }
        chatMessages.splice(idx, 1);
        res.json({ ok: true });
    });
});

// Sohbeti temizleme endpoint'i
app.post('/api/clear-chat', (req, res) => {
    const { username } = req.body;
    db.get('SELECT authority FROM users WHERE LOWER(username) = ?', [username.toLowerCase()], (err, user) => {
        if (err || !user || user.authority !== 2) {
            return res.status(403).json({ error: "Yetkiniz yok." });
        }
        chatMessages = [];
        res.json({ success: true });
    });
});

let typingUsers = []; // { username, displayName, last, timeout }

app.post('/api/typing', (req, res) => {
    const { username, displayName, onlineTimeout } = req.body;
    if (!username) return res.json({});
    const now = Date.now();
    // Online timeout süresi (varsayılan 2dk, client'tan gelirse onu kullan)
    let timeout = 2 * 60 * 1000;
    if (typeof onlineTimeout === "number" && onlineTimeout >= 10000 && onlineTimeout <= 10 * 60 * 1000) {
        timeout = onlineTimeout;
    }
    // Listeye ekle veya güncelle
    const idx = typingUsers.findIndex(u => u.username === username);
    if (idx >= 0) {
        typingUsers[idx].last = now;
        typingUsers[idx].displayName = displayName;
        typingUsers[idx].timeout = timeout;
    } else {
        typingUsers.push({ username, displayName, last: now, timeout });
    }
    res.json({ ok: true });
});

// Yazıyor listesini döndür (son 4 saniyede yazanlar)
app.get('/api/typing', (req, res) => {
    const now = Date.now();
    typingUsers = typingUsers.filter(u => now - u.last < 4000);
    res.json({ typing: typingUsers });
});

// Gerçek online kullanıcıları döndüren endpoint (timeout'u kullanıcıya göre belirle)
app.get('/api/online-users', (req, res) => {
    const now = Date.now();
    // Her kullanıcı için kendi timeout'u kullanılır (default 2dk)
    const unique = {};
    typingUsers.forEach(u => {
        const t = typeof u.timeout === "number" ? u.timeout : 2 * 60 * 1000;
        if (now - u.last < t) unique[u.username] = true;
    });
    const onlineList = Object.keys(unique);
    res.json({ count: onlineList.length, users: onlineList });
});


app.get('/test', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Basit test endpoint'i
// app.get('/', (req, res) => {
//     res.send('PixelCarProject API (SQLite) çalışıyor!');
// });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});
