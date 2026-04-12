# CaYaDev OAuth Entegrasyonu

## Genel Bakış

CaYaDev OAuth 2.0 sistemi, kullanıcıların CaYaDev hesaplarıyla uygulamanıza güvenli bir şekilde giriş yapmalarını sağlar. Bu sayede kullanıcı bilgilerini güvenli bir şekilde alabilir, şifreleri yönetme zorunluluğundan kurtulabilirsiniz.

## OAuth 2.0 Avantajları

- Kullanıcılar şifrelerini sizinle paylaşmak zorunda kalmaz.
- Kullanıcılar istediği zaman erişimi iptal edebilir.
- Sadece ihtiyacınız olan verilere erişirsiniz (scope bazlı).
- Token bazlı güvenli kimlik doğrulama.

## Entegrasyon Adımları

### 1. Uygulama Oluşturun

Geliştirici portalında yeni bir uygulama oluşturun ve `client_id` / `client_secret` bilgilerinizi alın.

### 2. Kullanıcıyı Yetkilendirme Sayfasına Yönlendirin

Kullanıcıları aşağıdaki URL'ye yönlendirin:

```text
https://cayadev.com/oauth/authorize?
  client_id=YOUR_CLIENT_ID&
  redirect_uri=YOUR_REDIRECT_URI&
  response_type=code&
  scope=profile:read email:read&
  state=RANDOM_STATE
```

| Parametre | Açıklama |
|---|---|
| `client_id` | Uygulamanızın benzersiz kimliği |
| `redirect_uri` | Yetkilendirme sonrası yönlendirilecek URL |
| `response_type` | Her zaman `code` olmalı |
| `scope` | İstenen izinler (boşlukla ayrılmış) |
| `state` | CSRF koruması için rastgele değer |

### 3. Yetkilendirme Kodunu Alın

Kullanıcı izin verdikten sonra `redirect_uri` adresinize `?code=...` parametresiyle yönlendirilir.

### 4. Access Token Alın

Kodu token'a çevirmek için `POST` isteği yapın:

```http
POST https://cayadev.com/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&
code=AUTH_CODE&
redirect_uri=YOUR_REDIRECT_URI&
client_id=YOUR_CLIENT_ID&
client_secret=YOUR_CLIENT_SECRET
```

### 5. Kullanıcı Bilgilerini Alın

Access token ile kullanıcı bilgilerini çekin:

```http
GET https://cayadev.com/oauth/userinfo
Authorization: Bearer YOUR_ACCESS_TOKEN
```

## Mevcut Scope'lar

| Scope | Açıklama | Dönen Veri |
|---|---|---|
| `profile:read` | Temel profil bilgileri (zorunlu) | `sub`, `username`, `display_name` |
| `email:read` | Kullanıcının email adresi | `email` |
| `avatar:read` | Profil fotoğrafı URL'i | `avatar` (tam URL) |

## Token Yenileme

Access token süresi dolduğunda (1 saat) refresh token ile yeni token alabilirsiniz:

```http
POST https://cayadev.com/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&
refresh_token=YOUR_REFRESH_TOKEN&
client_id=YOUR_CLIENT_ID&
client_secret=YOUR_CLIENT_SECRET
```

> **Not:** Refresh token 30 gün geçerlidir. Token yenilendiğinde yeni refresh token da döner.

## Kod Örnekleri

### Node.js (Express)

```javascript
const express = require('express');
const axios = require('axios');
const app = express();

// Kullanıcıyı yetkilendirme sayfasına yönlendir
app.get('/auth/cayadev', (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    req.session.oauthState = state;
    
    const authUrl = `https://cayadev.com/oauth/authorize?` +
        `client_id=${process.env.CAYADEV_CLIENT_ID}&` +
        `redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&` +
        `response_type=code&` +
        `scope=profile:read email:read&` +
        `state=${state}`;
    
    res.redirect(authUrl);
});

// Callback - Token al ve kullanıcı bilgilerini çek
app.get('/auth/cayadev/callback', async (req, res) => {
    const { code, state } = req.query;
    
    // State doğrulama
    if (state !== req.session.oauthState) {
        return res.status(400).send('Invalid state');
    }
    
    try {
        // Token al
        const tokenRes = await axios.post('https://cayadev.com/oauth/token', 
            new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                redirect_uri: process.env.REDIRECT_URI,
                client_id: process.env.CAYADEV_CLIENT_ID,
                client_secret: process.env.CAYADEV_CLIENT_SECRET
            })
        );
        
        const { access_token, refresh_token } = tokenRes.data;
        
        // Kullanıcı bilgilerini al
        const userRes = await axios.get('https://cayadev.com/oauth/userinfo', {
            headers: { Authorization: `Bearer ${access_token}` }
        });
        
        // Kullanıcıyı kaydet/güncelle ve oturum aç
        req.session.user = userRes.data;
        res.redirect('/dashboard');
        
    } catch (error) {
        console.error('OAuth error:', error.response?.data);
        res.status(500).send('Kimlik doğrulama başarısız');
    }
});
```

### Python (Flask)

```python
from flask import Flask, redirect, request, session
import requests
import secrets
import os

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY')

CLIENT_ID = os.environ.get('CAYADEV_CLIENT_ID')
CLIENT_SECRET = os.environ.get('CAYADEV_CLIENT_SECRET')
REDIRECT_URI = os.environ.get('REDIRECT_URI')

@app.route('/auth/cayadev')
def auth_cayadev():
    state = secrets.token_hex(16)
    session['oauth_state'] = state
    
    auth_url = (
        f"https://cayadev.com/oauth/authorize?"
        f"client_id={CLIENT_ID}&"
        f"redirect_uri={REDIRECT_URI}&"
        f"response_type=code&"
        f"scope=profile:read email:read&"
        f"state={state}"
    )
    return redirect(auth_url)

@app.route('/auth/cayadev/callback')
def auth_callback():
    code = request.args.get('code')
    state = request.args.get('state')
    
    if state != session.get('oauth_state'):
        return 'Invalid state', 400
    
    # Token al
    token_res = requests.post('https://cayadev.com/oauth/token', data={
        'grant_type': 'authorization_code',
        'code': code,
        'redirect_uri': REDIRECT_URI,
        'client_id': CLIENT_ID,
        'client_secret': CLIENT_SECRET
    })
    
    tokens = token_res.json()
    access_token = tokens['access_token']
    
    # Kullanıcı bilgilerini al
    user_res = requests.get('https://cayadev.com/oauth/userinfo',
        headers={'Authorization': f'Bearer {access_token}'})
    
    session['user'] = user_res.json()
    return redirect('/dashboard')
```

### PHP

```php
<?php
session_start();

$clientId = getenv('CAYADEV_CLIENT_ID');
$clientSecret = getenv('CAYADEV_CLIENT_SECRET');
$redirectUri = getenv('REDIRECT_URI');

// Yetkilendirme sayfasına yönlendir
if ($_SERVER['REQUEST_URI'] === '/auth/cayadev') {
    $state = bin2hex(random_bytes(16));
    $_SESSION['oauth_state'] = $state;
    
    $authUrl = "https://cayadev.com/oauth/authorize?" . http_build_query([
        'client_id' => $clientId,
        'redirect_uri' => $redirectUri,
        'response_type' => 'code',
        'scope' => 'profile:read email:read',
        'state' => $state
    ]);
    
    header("Location: $authUrl");
    exit;
}

// Callback
if ($_SERVER['REQUEST_URI'] === '/auth/cayadev/callback') {
    $code = $_GET['code'] ?? '';
    $state = $_GET['state'] ?? '';
    
    if ($state !== $_SESSION['oauth_state']) {
        die('Invalid state');
    }
    
    // Token al
    $ch = curl_init('https://cayadev.com/oauth/token');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => http_build_query([
            'grant_type' => 'authorization_code',
            'code' => $code,
            'redirect_uri' => $redirectUri,
            'client_id' => $clientId,
            'client_secret' => $clientSecret
        ]),
        CURLOPT_RETURNTRANSFER => true
    ]);
    $tokens = json_decode(curl_exec($ch), true);
    curl_close($ch);
    
    // Kullanıcı bilgilerini al
    $ch = curl_init('https://cayadev.com/oauth/userinfo');
    curl_setopt_array($ch, [
        CURLOPT_HTTPHEADER => ["Authorization: Bearer {$tokens['access_token']}"] ,
        CURLOPT_RETURNTRANSFER => true
    ]);
    $user = json_decode(curl_exec($ch), true);
    curl_close($ch);
    
    $_SESSION['user'] = $user;
    header('Location: /dashboard');
}
```

## Örnek Yanıtlar

### Token Yanıtı

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "dGhpcyBpcyBhIHJlZnJlc2ggdG9rZW4...",
  "scope": "profile:read email:read"
}
```

### Kullanıcı Bilgileri Yanıtı

```json
{
  "sub": "123",
  "username": "cayadev_user",
  "display_name": "CaYaDev Kullanıcısı",
  "email": "user@example.com",
  "avatar": "https://cayadev.com/uploads/profile/avatar.jpg"
}
```

## Hata Yanıtları

| HTTP Kodu | Hata | Açıklama |
|---|---|---|
| `400` | `invalid_request` | Eksik veya geçersiz parametre |
| `401` | `invalid_client` | Geçersiz `client_id` veya `client_secret` |
| `401` | `invalid_token` | Access token geçersiz veya süresi dolmuş |
| `403` | `access_denied` | Kullanıcı izni reddetti |
| `429` | `rate_limit_exceeded` | İstek limiti aşıldı |

## Rate Limiting

API istekleriniz aşağıdaki limitlere tabidir:

- Dakika başı: `60` istek
- Günlük: `10.000` istek

Limit aşıldığında `429 Too Many Requests` yanıtı alırsınız. Yanıt header'larında kalan limit bilgisi bulunur:

```http
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1609459200
```

## En İyi Uygulamalar

- **State parametresini kullanın:** CSRF saldırılarını önlemek için her yetkilendirme isteğinde benzersiz state değeri gönderin.
- **Client secret'ı güvende tutun:** Secret'ı asla frontend kodunda veya public repository'de paylaşmayın.
- **Tokenları güvenli saklayın:** Access ve refresh tokenları güvenli session/cookie'lerde saklayın.
- **Token yenilemeyi uygulayın:** Access token süresi dolduğunda refresh token ile otomatik yenileme yapın.
- **Sadece ihtiyacınız olan scope'ları isteyin:** Kullanıcı güvenini korumak için minimum izinle çalışın.
- **Hataları düzgün ele alın:** OAuth hatalarını kullanıcıya anlaşılır şekilde gösterin.

## SSS (Sık Sorulan Sorular)

### Access token ne kadar süre geçerli?

Access token 1 saat (`3600` saniye) geçerlidir. Süre dolduğunda refresh token ile yenileyebilirsiniz.

### Refresh token ne kadar süre geçerli?

Refresh token 30 gün geçerlidir. Her kullanımda yeni bir refresh token döner.

### Kullanıcı izinleri nasıl iptal eder?

Kullanıcılar CaYaDev hesap ayarlarından **"Yetkili Uygulamalar"** bölümünden erişimi iptal edebilir.

### Client secret'ımı kaybettim, ne yapmalıyım?

Geliştirici portalından uygulamanızı seçip **"Secret Yenile"** butonuna tıklayarak yeni secret alabilirsiniz.
